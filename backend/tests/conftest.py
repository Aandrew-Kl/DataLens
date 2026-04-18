import sys
from uuid import uuid4
from pathlib import Path

import numpy as np
import pytest
import pytest_asyncio
from datetime import datetime, timedelta
from httpx import AsyncClient


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _migrate_once_for_tests():
    """Run Alembic migrations once per session so tests that use their own
    TestClient (not the async `client` fixture) still find the schema in place.
    Without this, the lifespan's migration guard is skipped in those tests
    and the in-memory SQLite stays empty."""
    from app.alembic_utils import downgrade_database, upgrade_database
    from app.database import engine

    async with engine.begin() as conn:
        await conn.run_sync(upgrade_database)
    yield


@pytest.fixture
def regression_data() -> list[dict[str, object]]:
    rng = np.random.default_rng(12)
    x1 = rng.normal(0.0, 1.0, 120)
    x2 = rng.normal(1.0, 0.8, 120)
    noise = rng.normal(0.0, 0.05, 120)
    return [
        {
            "feature_a": float(feature_one),
            "feature_b": float(feature_two),
            "feature_c": float(feature_one * 0.2 + feature_two * 0.7),
            "target": float(5.0 * feature_one - 2.5 * feature_two + noise_value),
            "text": "premium retention cohort growth" if index % 2 == 0 else "stable monthly benchmark",
            "label": "churned" if (feature_one - feature_two + noise_value) < 0 else "active",
            "salary": float(40_000 + (index * 250.0) + (noise_value * 1_000)),
            "cohort_user": f"user-{index % 16}",
            "signup_date": f"2024-{(index % 12) + 1:02d}-{(index % 28) + 1:02d}",
            "activity_date": f"2024-{((index + 1) % 12) + 1:02d}-{((index + 2) % 28) + 1:02d}",
        }
        for index, (feature_one, feature_two, noise_value) in enumerate(zip(x1, x2, noise, strict=False))
    ]


@pytest.fixture
def cluster_data() -> list[dict[str, object]]:
    rng = np.random.default_rng(9)
    cluster_left = rng.normal(loc=(0.0, 0.0), scale=0.35, size=(40, 2))
    cluster_right = rng.normal(loc=(6.0, 6.0), scale=0.35, size=(40, 2))
    combined = np.vstack([cluster_left, cluster_right])
    labels = ["alpha"] * 40 + ["beta"] * 40
    return [
        {
            "feature_a": float(row[0]),
            "feature_b": float(row[1]),
            "text": f"cluster-{label}",
        }
        for row, label in zip(combined, labels, strict=False)
    ]


@pytest.fixture
def classification_data() -> list[dict[str, object]]:
    rng = np.random.default_rng(27)
    feature_a = rng.normal(0.0, 1.0, 120)
    feature_b = rng.normal(0.5, 1.2, 120)
    return [
        {
            "feature_a": float(value_a),
            "feature_b": float(value_b),
            "target": "positive" if (value_a + value_b) > 0 else "negative",
            "text": "likely converted customer" if (value_a + value_b) > 0 else "low intent customer",
            "churned": "yes" if (value_a * value_b) < 0 else "no",
            "plan": "pro" if index % 3 == 0 else "basic",
        }
        for index, (value_a, value_b) in enumerate(zip(feature_a, feature_b, strict=False))
    ]


@pytest.fixture
def ab_test_data() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for value in (12, 11, 10, 11, 13, 12, 14, 10, 11, 13):
        rows.append({"variant": "A", "metric": float(value)})
    for value in (14, 15, 13, 16, 14, 15, 17, 16, 15, 14):
        rows.append({"variant": "B", "metric": float(value)})
    return rows


@pytest.fixture
def cohort_data() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for index in range(80):
        signup = datetime(2024, 1, 1) + timedelta(days=index % 60)
        user = f"user-{index // 3}"
        activity_days = index + (index % 5) * 3
        activity = signup + timedelta(days=activity_days)
        rows.append(
            {
                "user_id": user,
                "signup_date": signup.strftime("%Y-%m-%d"),
                "activity_date": activity.strftime("%Y-%m-%d"),
            }
        )
    return rows


@pytest.fixture
def forecast_data() -> list[dict[str, object]]:
    base = datetime(2024, 1, 1)
    return [
        {
            "event_date": (base + timedelta(days=day)).strftime("%Y-%m-%d"),
            "value": float(100 + (day * 2.2) + (day % 7)),
        }
        for day in range(1, 36)
    ]


@pytest.fixture
def sentiment_texts() -> list[str]:
    return [
        "I absolutely love this product. It works beautifully.",
        "This is the worst customer experience I have had in months.",
        "The release shipped today.",
    ]


@pytest_asyncio.fixture
async def client():
    """Async HTTP client wired to the FastAPI application."""
    from httpx import ASGITransport, AsyncClient
    from app.alembic_utils import downgrade_database, upgrade_database
    from app.api.auth import _login_attempts
    from app.main import app, rate_limiter, request_metrics
    from app.database import engine
    from app.middleware.rate_limit import limiter

    limiter.reset()
    rate_limiter.clear()
    _login_attempts.clear()

    async with engine.begin() as conn:
        await conn.run_sync(downgrade_database)
        await conn.run_sync(upgrade_database)

    # Do not enter lifespan_context here: the tests rely on caplog capturing
    # request_logger output through pytest's stdlib logging plumbing, and the
    # ASGI lifespan context reconfigures handlers in a way that breaks caplog.
    # The explicit migration above stands in for the startup path; the
    # lifespan's engine.dispose() at exit would also drop the in-memory
    # SQLite schema mid-teardown.
    await request_metrics.reset()
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test/api") as ac:
        yield ac

    limiter.reset()
    rate_limiter.clear()
    _login_attempts.clear()
    await request_metrics.reset()

    # Re-migrate instead of drop: we're on a StaticPool in-memory SQLite and
    # other sync-TestClient tests later in the session rely on the schema
    # staying in place. A full downgrade→upgrade cycle reimposes a clean
    # state without leaving the next test with an empty DB.
    async with engine.begin() as conn:
        await conn.run_sync(downgrade_database)
        await conn.run_sync(upgrade_database)


@pytest_asyncio.fixture
async def auth_headers(client: AsyncClient) -> dict[str, str]:
    """Register a user and return Authorization headers for authenticated requests."""
    email = f"test-{uuid4()}@example.com"
    password = "TestPassword123"

    register_response = await client.post(
        "/auth/register",
        json={"email": email, "password": password},
    )
    assert register_response.status_code == 201

    login_response = await client.post(
        "/auth/login",
        json={"email": email, "password": password},
    )
    assert login_response.status_code == 200

    access_token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {access_token}"}
