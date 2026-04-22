from __future__ import annotations

import asyncio
import logging
import uuid
from collections import defaultdict, deque
from pathlib import Path
from time import monotonic, time
from urllib.parse import urlsplit

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from app.api.router import api_router
from app.config import settings
from app.database import Base, engine
from app.logging_config import setup_logging
from app.middleware.rate_limit import exempt_paths, limiter
from app.models import analysis, bookmark, dataset, pipeline, query_history, user  # noqa: F401


API_PATH_PREFIX = "/api"
# Aligned with slowapi's default_limits=["60/minute"] in app.middleware.rate_limit
RATE_LIMIT_MAX_REQUESTS = 60
RATE_LIMIT_WINDOW_SECONDS = 60
HSTS_HEADER_VALUE = "max-age=63072000; includeSubDomains; preload"
LOCALHOST_HOSTNAMES = {"localhost", "127.0.0.1", "::1", "test", "testserver"}


class RequestMetrics:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self.started_at = monotonic()
        self.total_requests = 0
        self.active_connections = 0
        self.status_codes = {"2xx": 0, "4xx": 0, "5xx": 0}

    async def increment_active_connections(self) -> None:
        async with self._lock:
            self.active_connections += 1

    async def record_response(self, status_code: int) -> None:
        async with self._lock:
            self.total_requests += 1
            self.active_connections = max(0, self.active_connections - 1)

            if 200 <= status_code < 300:
                self.status_codes["2xx"] += 1
            elif 400 <= status_code < 500:
                self.status_codes["4xx"] += 1
            elif 500 <= status_code < 600:
                self.status_codes["5xx"] += 1

    async def reset(self) -> None:
        async with self._lock:
            self.started_at = monotonic()
            self.total_requests = 0
            self.active_connections = 0
            self.status_codes = {"2xx": 0, "4xx": 0, "5xx": 0}

    async def snapshot(self) -> dict[str, object]:
        async with self._lock:
            return {
                "total_requests": self.total_requests,
                "status_codes": dict(self.status_codes),
                "uptime_seconds": int(monotonic() - self.started_at),
            }


class InMemoryRateLimiter:
    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._requests: defaultdict[str, deque[float]] = defaultdict(deque)
        self._lock = asyncio.Lock()

    async def allow_request(self, client_key: str) -> tuple[bool, int, int]:
        current_time = monotonic()
        window_start = current_time - self.window_seconds

        async with self._lock:
            request_window = self._requests[client_key]
            while request_window and request_window[0] <= window_start:
                request_window.popleft()

            if len(request_window) >= self.max_requests:
                remaining = 0
                reset_time = self._get_reset_time(current_time, request_window)
                return False, remaining, reset_time

            request_window.append(current_time)
            remaining = self.max_requests - len(request_window)
            reset_time = self._get_reset_time(current_time, request_window)
            return True, remaining, reset_time

    def _get_reset_time(self, current_time: float, request_window: deque[float]) -> int:
        if not request_window:
            return int(time()) + self.window_seconds

        reset_after_seconds = max(0.0, (request_window[0] + self.window_seconds) - current_time)
        return int(time() + reset_after_seconds)

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


setup_logging(settings.LOG_LEVEL, environment=settings.ENVIRONMENT)
request_logger = logging.getLogger("app.request")
health_logger = logging.getLogger("app.health")
error_logger = logging.getLogger("app.error")
rate_limiter = InMemoryRateLimiter(
    max_requests=RATE_LIMIT_MAX_REQUESTS,
    window_seconds=RATE_LIMIT_WINDOW_SECONDS,
)
request_metrics = RequestMetrics()

app = FastAPI(
    title="DataLens Backend",
    description="AI-powered data exploration and analysis API",
    version=settings.APP_VERSION,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)
app.state.limiter = limiter
app.state.rate_limit_exempt_paths = exempt_paths() | {
    "/api/docs",
    "/api/redoc",
    "/api/v1/health",
    "/api/metrics",
    "/health/metrics",
}
async def _rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Return structured 429 with headers so clients can back off cleanly.

    slowapi's default handler returns plain text without the rate-limit headers,
    which breaks standard client behavior. We emit both a machine-readable body
    (`error` key) and the full X-RateLimit-* / Retry-After headers.
    """
    limit_str = getattr(getattr(exc, "limit", None), "limit", None)
    amount = getattr(limit_str, "amount", None) or 60
    window = getattr(limit_str, "per", None) or 60
    reset_epoch = int(time()) + int(window)

    return JSONResponse(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        content={"error": f"Rate limit exceeded: {exc!s}"},
        headers={
            "X-RateLimit-Limit": str(amount),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": str(reset_epoch),
            "Retry-After": str(int(window)),
        },
    )


app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix=API_PATH_PREFIX)


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
async def rate_limit_middleware(request: Request, call_next):
    if not request.url.path.startswith(API_PATH_PREFIX):
        return await call_next(request)

    # Paths that are explicitly exempt from the default global limit
    # (decorators via @limiter.limit still apply their own limits).
    if request.url.path in app.state.rate_limit_exempt_paths:
        return await call_next(request)

    client_ip = get_client_ip(request)
    allowed, remaining, reset_time = await rate_limiter.allow_request(client_ip)

    if not allowed:
        response = JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            content={"error": "Rate limit exceeded. Please retry later."},
            headers={"Retry-After": str(RATE_LIMIT_WINDOW_SECONDS)},
        )
    else:
        response = await call_next(request)

    response.headers["X-RateLimit-Limit"] = str(rate_limiter.max_requests)
    response.headers["X-RateLimit-Remaining"] = str(remaining)
    response.headers["X-RateLimit-Reset"] = str(reset_time)
    return response


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    start_time = monotonic()
    status_code = status.HTTP_500_INTERNAL_SERVER_ERROR

    try:
        response = await call_next(request)
        status_code = response.status_code
        response.headers["X-Request-ID"] = request_id
        return response
    finally:
        duration_ms = (monotonic() - start_time) * 1000
        request_logger.info(
            "request_id=%s method=%s path=%s status_code=%s duration_ms=%.2f",
            request_id,
            request.method,
            request.url.path,
            status_code,
            duration_ms,
        )


# Swagger UI and ReDoc serve HTML pages that load inline bootstrap scripts and
# styles. Those routes need a relaxed CSP so the docs stay functional, while
# the default CSP for API responses can stay strict. We key off URL paths
# rather than content-type so /api/openapi.json (fetched by the doc pages) is
# covered too.
_DOC_PATHS: frozenset[str] = frozenset({"/api/docs", "/api/redoc", "/api/openapi.json"})


def _is_docs_path(path: str) -> bool:
    return path in _DOC_PATHS or path.startswith("/api/docs/") or path.startswith("/api/redoc/")


def build_csp_header(path: str, environment: str) -> str:
    """Return the CSP string for a given request path.

    API/JSON responses get the strict policy (no 'unsafe-inline', no
    'unsafe-eval'). Swagger UI / ReDoc routes get a narrowly scoped relaxed
    policy that permits the inline scripts/styles FastAPI's bundled docs need.
    'unsafe-eval' is only allowed in development (e.g. for tooling) and never
    in production.
    """
    is_dev = environment.strip().lower() == "development"
    if _is_docs_path(path):
        script_src = "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net"
        if is_dev:
            script_src += " 'unsafe-eval'"
        return (
            "default-src 'self'; "
            f"{script_src}; "
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; "
            "img-src 'self' data: blob: https://fastapi.tiangolo.com; "
            "font-src 'self' data:; "
            "connect-src 'self'; "
            "frame-ancestors 'none'"
        )

    # Strict default for API responses — JSON can't execute scripts, so there
    # is no legitimate reason to relax script-src on these paths in any
    # environment (including development).
    return (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self'; "
        "img-src 'self' data: blob:; "
        "font-src 'self' data:; "
        "connect-src 'self' ws: wss:; "
        "frame-ancestors 'none'"
    )


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = build_csp_header(
        request.url.path, settings.ENVIRONMENT
    )
    if should_set_hsts(request):
        response.headers["Strict-Transport-Security"] = HSTS_HEADER_VALUE
    return response


@app.middleware("http")
async def request_metrics_middleware(request: Request, call_next):
    await request_metrics.increment_active_connections()
    status_code = status.HTTP_500_INTERNAL_SERVER_ERROR

    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        await request_metrics.record_response(status_code)


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
    await request_metrics.reset()
    Path(settings.UPLOADS_DIR).mkdir(parents=True, exist_ok=True)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


@app.on_event("shutdown")
async def on_shutdown() -> None:
    await engine.dispose()


@app.get("/docs", include_in_schema=False)
async def legacy_docs_redirect() -> RedirectResponse:
    return RedirectResponse(url="/api/docs")


@app.get("/redoc", include_in_schema=False)
async def legacy_redoc_redirect() -> RedirectResponse:
    return RedirectResponse(url="/api/redoc")


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


@app.get("/metrics", response_model=None)
@app.get("/api/metrics", response_model=None)
@app.get("/health/metrics", response_model=None)
async def metrics() -> dict[str, object]:
    return await request_metrics.snapshot()


for route in app.routes:
    if getattr(route, "path", None) in app.state.rate_limit_exempt_paths and hasattr(route, "endpoint"):
        limiter.exempt(route.endpoint)
