from __future__ import annotations

import asyncio
import logging
from collections import defaultdict, deque
from pathlib import Path
from time import monotonic

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


def get_client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()

    if request.client and request.client.host:
        return request.client.host

    return "unknown"


setup_logging(settings.LOG_LEVEL)
request_logger = logging.getLogger("app.request")
health_logger = logging.getLogger("app.health")
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
