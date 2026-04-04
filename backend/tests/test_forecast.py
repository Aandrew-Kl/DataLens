import pandas as pd

import pytest

from app.services.forecast_service import forecast


def test_forecast_holt_winters(forecast_data: list[dict[str, object]]) -> None:
    frame = pd.DataFrame(forecast_data)
    result = forecast(frame, date_column="event_date", value_column="value", periods=5, method="holt")

    assert result["method"] == "holt"
    assert result["history_points"] > 0
    assert len(result["forecast_points"]) == 5
    assert all("forecast" in point for point in result["forecast_points"])
    assert all("lower" in point for point in result["forecast_points"])
    assert all("upper" in point for point in result["forecast_points"])
    assert "metrics" in result
    assert "rmse" in result["metrics"]


def test_forecast_arima(forecast_data: list[dict[str, object]]) -> None:
    frame = pd.DataFrame(forecast_data)
    result = forecast(frame, date_column="event_date", value_column="value", periods=3, method="arima")

    assert result["method"] == "arima"
    assert len(result["forecast_points"]) == 3


def test_forecast_too_few_rows() -> None:
    frame = pd.DataFrame(
        {
            "date": ["2024-01-01", "2024-01-02", "2024-01-03"],
            "value": [10, 20, 30],
        }
    )
    with pytest.raises(ValueError, match="at least 8"):
        forecast(frame, date_column="date", value_column="value", periods=5, method="holt")
