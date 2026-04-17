from __future__ import annotations

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def _auth_or_ip_key(request: Request) -> str:
    """Rate limit key: user id if authenticated, otherwise client IP."""
    user = getattr(request.state, "user", None)
    if user and getattr(user, "id", None):
        return f"user:{user.id}"
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(
    key_func=_auth_or_ip_key,
    default_limits=["60/minute"],
    headers_enabled=True,
)


def exempt_paths() -> set[str]:
    return {"/health", "/metrics", "/docs", "/openapi.json", "/redoc"}
