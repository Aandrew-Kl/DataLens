from types import SimpleNamespace

import pandas as pd

from app.services.analytics_service import ab_test, churn_predict, cohort_analysis, forecast


def test_ab_test(ab_test_data: list[dict[str, object]]) -> None:
    frame = pd.DataFrame(ab_test_data)
    request = SimpleNamespace(
        group_column="variant",
        metric_column="metric",
        variant_a="A",
        variant_b="B",
        metric_type="continuous",
        confidence_level=0.95,
    )
    result = ab_test(frame, request)

    assert "p_value" in result
    assert "confidence_interval" in result
    assert "effect_size" in result


def test_churn_predict(classification_data: list[dict[str, object]]) -> None:
    request = SimpleNamespace(
        feature_columns=["feature_a", "feature_b", "plan"],
        target_column="churned",
        test_size=0.25,
    )
    result = churn_predict(pd.DataFrame(classification_data), request)

    assert "risk_scores" in result
    assert "feature_importance" in result
    assert isinstance(result["risk_scores"], list)
    assert isinstance(result["feature_importance"], dict)


def test_cohort_analysis(cohort_data: list[dict[str, object]]) -> None:
    request = SimpleNamespace(
        entity_id_column="user_id",
        signup_date_column="signup_date",
        activity_date_column="activity_date",
        frequency="monthly",
    )
    result = cohort_analysis(pd.DataFrame(cohort_data), request)

    assert "summaries" in result
    assert isinstance(result["summaries"], list)
    cohorts = {row["cohort_period"]: row for row in result["summaries"]}
    assert isinstance(cohorts, dict)
    assert all(isinstance(value, dict) for value in cohorts.values())


def test_forecast(forecast_data: list[dict[str, object]]) -> None:
    frame = pd.DataFrame(forecast_data)
    result = forecast(frame, date_column="event_date", value_column="value", periods=7, method="holt")

    predictions = result["forecast_points"]
    assert isinstance(predictions, list)
    assert len(predictions) == 7
    assert all("forecast" in item for item in predictions)
