"""OpenAPI helpers shared across API routers."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from pydantic import BaseModel


class ErrorResponse(BaseModel):
    detail: str


class ValidationErrorItem(BaseModel):
    loc: list[str | int]
    msg: str
    type: str


class ValidationErrorResponse(BaseModel):
    detail: list[ValidationErrorItem]


_BASE_ERROR_RESPONSES: dict[int, dict[str, Any]] = {
    422: {
        "model": ValidationErrorResponse,
        "description": "The request payload or parameters failed validation.",
    },
    429: {
        "model": ErrorResponse,
        "description": "Too many requests. Retry after the rate limit window resets.",
    },
    500: {
        "model": ErrorResponse,
        "description": "The server could not complete the request due to an internal error.",
    },
}


def build_error_responses(
    *,
    bad_request: str | None = None,
    unauthorized: str | None = None,
    not_found: str | None = None,
    extra: dict[int, str] | None = None,
) -> dict[int, dict[str, Any]]:
    responses = deepcopy(_BASE_ERROR_RESPONSES)

    if bad_request:
        responses[400] = {
            "model": ErrorResponse,
            "description": bad_request,
        }

    if unauthorized:
        responses[401] = {
            "model": ErrorResponse,
            "description": unauthorized,
        }

    if not_found:
        responses[404] = {
            "model": ErrorResponse,
            "description": not_found,
        }

    if extra:
        for status_code, description in extra.items():
            responses[status_code] = {
                "model": ErrorResponse,
                "description": description,
            }

    return responses
