"""Contract drift test — asserts that every endpoint the frontend calls
is actually served by the FastAPI app.

Expected paths are harvested from src/lib/api/*.ts. Keep this list in sync
when adding a new FE call. A CI failure here means the backend shape
drifted from the client; fix one side before merging.

This catches the /api vs /api/v1 class of bug that shipped in PR #13.
"""

from __future__ import annotations

import pytest

from app.main import app


# Paths the frontend client calls (src/lib/api/{auth,ai,ml,analytics}.ts).
# Update this list when a new FE-BE contract is added.
EXPECTED_FE_PATHS: list[tuple[str, str]] = [
    # auth
    ("POST", "/api/auth/register"),
    ("POST", "/api/auth/login"),
    ("GET", "/api/auth/me"),
    # persistence
    ("GET", "/api/bookmarks"),
    ("POST", "/api/bookmarks"),
    ("DELETE", "/api/bookmarks/{bookmark_id}"),
    ("GET", "/api/pipelines"),
    ("POST", "/api/pipelines"),
    ("DELETE", "/api/pipelines/{pipeline_id}"),
    ("GET", "/api/history"),
    ("POST", "/api/history"),
    ("DELETE", "/api/history/{history_id}"),
    # AI
    ("POST", "/api/ai/sentiment"),
    ("POST", "/api/ai/summarize"),
    ("POST", "/api/ai/generate-query"),
    # ML
    ("POST", "/api/ml/regression"),
    ("POST", "/api/ml/cluster"),
    ("POST", "/api/ml/classify"),
    ("POST", "/api/ml/anomaly-detect"),
    ("POST", "/api/ml/pca"),
    # analytics
    ("POST", "/api/analytics/churn-predict"),
    ("POST", "/api/analytics/cohort"),
    ("POST", "/api/analytics/ab-test"),
    ("POST", "/api/analytics/forecast"),
]


@pytest.fixture(scope="module")
def openapi_schema() -> dict:
    return app.openapi()


def test_every_fe_path_is_served(openapi_schema: dict) -> None:
    served_paths = openapi_schema.get("paths", {})
    missing: list[str] = []

    for method, path in EXPECTED_FE_PATHS:
        path_entry = served_paths.get(path)
        if path_entry is None:
            missing.append(f"{method} {path} (path not mounted)")
            continue
        if method.lower() not in path_entry:
            served_methods = ",".join(sorted(path_entry.keys()))
            missing.append(
                f"{method} {path} (path exists but only serves {served_methods})"
            )

    assert not missing, (
        "Frontend calls paths the backend does not serve. "
        "This is the /api vs /api/v1 drift bug class. "
        "Fix either the FE client or add the BE route:\n  - "
        + "\n  - ".join(missing)
    )


def test_register_response_includes_access_token(openapi_schema: dict) -> None:
    """AuthProvider will 401 on first getMe() unless /register returns
    an access_token. Regression guard for PR #13 (task C1).
    """
    register = openapi_schema["paths"]["/api/auth/register"]["post"]
    response_ref = (
        register["responses"]["201"]["content"]["application/json"]["schema"]["$ref"]
    )
    schema_name = response_ref.rsplit("/", 1)[-1]
    schema = openapi_schema["components"]["schemas"][schema_name]
    assert "access_token" in schema.get("properties", {}), (
        f"/auth/register response ({schema_name}) must include access_token "
        "so the frontend AuthProvider can bootstrap without a second login"
    )
