"""Tests for shared OpenAPI response helpers."""

from __future__ import annotations

from app.api.docs import ErrorResponse, ValidationErrorResponse, build_error_responses


def _assert_response_models(responses: dict[int, dict[str, object]]) -> None:
    allowed_models = {ErrorResponse, ValidationErrorResponse}
    assert all(response["model"] in allowed_models for response in responses.values())


def test_build_error_responses_includes_base_responses() -> None:
    responses = build_error_responses()

    assert {422, 429, 500}.issubset(responses)
    assert responses[422]["model"] is ValidationErrorResponse
    assert responses[429]["model"] is ErrorResponse
    assert responses[500]["model"] is ErrorResponse
    _assert_response_models(responses)


def test_build_error_responses_adds_bad_request_response() -> None:
    responses = build_error_responses(bad_request="The request body is invalid.")

    assert responses[400] == {
        "model": ErrorResponse,
        "description": "The request body is invalid.",
    }
    _assert_response_models(responses)


def test_build_error_responses_adds_unauthorized_response() -> None:
    responses = build_error_responses(unauthorized="Authentication is required.")

    assert responses[401] == {
        "model": ErrorResponse,
        "description": "Authentication is required.",
    }
    _assert_response_models(responses)


def test_build_error_responses_adds_not_found_response() -> None:
    responses = build_error_responses(not_found="The dataset does not exist.")

    assert responses[404] == {
        "model": ErrorResponse,
        "description": "The dataset does not exist.",
    }
    _assert_response_models(responses)


def test_build_error_responses_adds_extra_status_codes() -> None:
    responses = build_error_responses(extra={409: "Conflict.", 503: "Service unavailable."})

    assert responses[409] == {"model": ErrorResponse, "description": "Conflict."}
    assert responses[503] == {"model": ErrorResponse, "description": "Service unavailable."}
    _assert_response_models(responses)


def test_build_error_responses_combines_optional_parameters() -> None:
    responses = build_error_responses(
        bad_request="Bad request.",
        unauthorized="Unauthorized.",
        not_found="Not found.",
        extra={409: "Conflict."},
    )

    assert set(responses) == {400, 401, 404, 409, 422, 429, 500}
    assert responses[400]["description"] == "Bad request."
    assert responses[401]["description"] == "Unauthorized."
    assert responses[404]["description"] == "Not found."
    assert responses[409]["description"] == "Conflict."
    _assert_response_models(responses)
