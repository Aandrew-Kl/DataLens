from __future__ import annotations

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def _auth_or_ip_key(request: Request) -> str:
    """Rate limit key: user id if authenticated, otherwise client IP.

    Respects `x-forwarded-for` so the first hop is used when the app is
    behind a reverse proxy (also makes test fixtures addressable).
    """
    user = getattr(request.state, "user", None)
    if user and getattr(user, "id", None):
        return f"user:{user.id}"

    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        client_ip = forwarded_for.split(",")[0].strip()
        if client_ip:
            return f"ip:{client_ip}"

    return f"ip:{get_remote_address(request)}"


limiter = Limiter(
    key_func=_auth_or_ip_key,
    default_limits=["60/minute"],
    # headers_enabled is False — slowapi emits X-RateLimit-Reset as a float
    # timestamp which breaks client back-off logic. We emit integer-second
    # headers ourselves in the custom 429 handler in app.main.
    headers_enabled=False,
)


def exempt_paths() -> set[str]:
    return {"/health", "/metrics", "/docs", "/openapi.json", "/redoc"}
