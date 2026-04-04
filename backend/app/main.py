from __future__ import annotations

import asyncio
import logging
from collections import defaultdict, deque
from pathlib import Path
from time import monotonic
from urllib.parse import urlsplit

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.router import api_router
from app.config import settings
from app.database import Base, engine
from app.logging_config import setup_logging
from app.models import analysis, dataset, query_history, user  # noqa: F401


API_PATH_PREFIX = "/api"
RATE_LIMIT_MAX_REQUESTS = 100
RATE_LIMIT_WINDOW_SECONDS = 60
HSTS_HEADER_VALUE = "max-age=63072000; includeSubDomains; preload"
LOCALHOST_HOSTNAMES = {"localhost", "127.0.0.1", "::1", "test", "testserver"}


class InMemoryRateLimiter:
    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: defaultdict[str, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def allow_request(self, client_key: str) -> bool:
        current_time = monotonic()
        window_start = current_time - self.window_seconds

        async with self._lock:
            request_window = self._requests[client_key]
            while request_window and request_window[0] <= window_start:
                request_window.popleft()

            if len(request_window) >= self.max_requests:
                return False

            request_window.append(current_time)
            return True

    def clear(self) -> None:
        self._requests.clear()


class RequestEntityTooLargeError(Exception):
    pass


def get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()

    if request.client and request.client.host:
        return request.client.host

    return "unknown"


def get_request_hostname(request: Request) -> str:
    forwarded_host = request.headers.get("x-forwarded-host")
    raw_host = forwarded_host.split(",")[0].strip() if forwarded_host else request.headers.get("host", "")
    hostname = urlsplit(f"//{raw_host}").hostname if raw_host else request.url.hostname
    return (hostname or "").lower()


def should_set_hsts(request: Request) -> bool:
    return get_request_hostname(request) not in LOCALHOST_HOSTNAMES


setup_logging(settings.LOG_LEVEL)
request_logger = logging.getLogger("app.request")
health_logger = logging.getLogger("app.health")
error_logger = logging.getLogger("app.error")
rate_limiter = InMemoryRateLimiter(
    max_requests=RATE_LIMIT_MAX_REQUESTS,
    window_seconds=RATE_LIMIT_WINDOW_SECONDS,
)

app = FastAPI(title="DataLens Backend", version=settings.APP_VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix=API_PATH_PREFIX)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if request.url.path.startswith(API_PATH_PREFIX):
        client_ip = get_client_ip(request)
        if not await rate_limiter.allow_request(client_ip):
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={"detail": "Rate limit exceeded. Please retry later."},
            )

    return await call_next(request)


@app.middleware("http")
async def request_size_limit_middleware(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > settings.MAX_UPLOAD_SIZE:
                return JSONResponse(status_code=413, content={"detail": "Request body too large."})
        except ValueError:
            request_logger.warning("invalid content-length header for path=%s", request.url.path)

    received_bytes = 0
    original_receive = request._receive

    async def receive():
        nonlocal received_bytes
        message = await original_receive()
        if message["type"] == "http.request":
            received_bytes += len(message.get("body", b""))
            if received_bytes > settings.MAX_UPLOAD_SIZE:
                raise RequestEntityTooLargeError
        return message

    request._receive = receive

    try:
        return await call_next(request)
    except RequestEntityTooLargeError:
        return JSONResponse(status_code=413, content={"detail": "Request body too large."})


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    start_time = monotonic()
    status_code = status.HTTP_500_INTERNAL_SERVER_ERROR

    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        duration_ms = (monotonic() - start_time) * 1000
        request_logger.info(
            "method=%s path=%s status_code=%s duration_ms=%.2f",
            request.method,
            request.url.path,
            status_code,
            duration_ms,
        )


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if should_set_hsts(request):
        response.headers["Strict-Transport-Security"] = HSTS_HEADER_VALUE
    return response


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    error_logger.error(
        "unhandled exception for method=%s path=%s",
        request.method,
        request.url.path,
        exc_info=(type(exc), exc, exc.__traceback__),
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error"},
    )


@app.on_event("startup")
async def on_startup() -> None:
    Path(settings.UPLOADS_DIR).mkdir(parents=True, exist_ok=True)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


@app.get("/health", response_model=None)
@app.get("/api/v1/health", response_model=None)
async def healthcheck() -> dict[str, object] | JSONResponse:
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
    except Exception:
        health_logger.warning("database connectivity check failed during healthcheck", exc_info=True)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "status": "degraded",
                "version": settings.APP_VERSION,
                "database": {"status": "error"},
            },
        )

    return {
        "status": "ok",
        "version": settings.APP_VERSION,
        "database": {"status": "ok"},
    }
