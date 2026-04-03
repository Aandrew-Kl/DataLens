"""Time-series forecasting implementations using statsmodels."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from statsmodels.tsa.arima.model import ARIMA
from statsmodels.tsa.holtwinters import ExponentialSmoothing

from app.services.data_service import ensure_columns_exist, to_native


def _prepare_series(frame: pd.DataFrame, date_column: str, value_column: str) -> pd.Series:
    """Prepare a clean time series indexed by date."""

    ensure_columns_exist(frame, [date_column, value_column])
    working = frame[[date_column, value_column]].copy()
    working[date_column] = pd.to_datetime(working[date_column], errors="coerce")
    working[value_column] = pd.to_numeric(working[value_column], errors="coerce")
    working = working.dropna().sort_values(date_column)
    if working.empty:
        raise ValueError("No valid rows were available for forecasting.")

    series = working.groupby(date_column)[value_column].mean().sort_index()
    inferred_frequency = pd.infer_freq(series.index)
    if inferred_frequency is None:
        inferred_frequency = "D"
    series = series.asfreq(inferred_frequency)
    series = series.interpolate(method="linear").ffill().bfill()
    if len(series) < 8:
        raise ValueError("At least 8 chronological observations are required for forecasting.")
    return series


def _forecast_holt_winters(train: pd.Series, steps: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Fit Holt-Winters and generate mean forecast plus confidence bounds."""

    model = ExponentialSmoothing(train, trend="add", seasonal=None, initialization_method="estimated")
    fitted = model.fit(optimized=True)
    holdout_pred = fitted.forecast(steps=steps)
    residual_std = float(np.std(fitted.resid, ddof=1)) if len(fitted.resid) > 1 else 0.0
    interval = 1.96 * residual_std
    lower = holdout_pred - interval
    upper = holdout_pred + interval
    return (
        np.asarray(holdout_pred),
        np.asarray(lower),
        np.asarray(upper),
        np.asarray(fitted.fittedvalues),
    )


def forecast(frame: pd.DataFrame, date_column: str, value_column: str, periods: int, method: str) -> dict:
    """Forecast future values with ARIMA or Holt-Winters."""

    series = _prepare_series(frame, date_column, value_column)
    holdout = max(2, min(periods, max(2, len(series) // 5)))
    train = series.iloc[:-holdout]
    test = series.iloc[-holdout:]

    if method == "arima":
        eval_model = ARIMA(train, order=(1, 1, 1)).fit()
        eval_forecast = eval_model.get_forecast(steps=holdout)
        predicted = np.asarray(eval_forecast.predicted_mean)
        conf_int = eval_forecast.conf_int(alpha=0.05)
        lower = np.asarray(conf_int.iloc[:, 0])
        upper = np.asarray(conf_int.iloc[:, 1])
        full_model = ARIMA(series, order=(1, 1, 1)).fit()
        full_forecast = full_model.get_forecast(steps=periods)
        full_predicted = np.asarray(full_forecast.predicted_mean)
        full_conf_int = full_forecast.conf_int(alpha=0.05)
        future_lower = np.asarray(full_conf_int.iloc[:, 0])
        future_upper = np.asarray(full_conf_int.iloc[:, 1])
        fitted_values = np.asarray(full_model.fittedvalues)
    else:
        predicted, lower, upper, _ = _forecast_holt_winters(train, holdout)
        full_predicted, future_lower, future_upper, fitted_values = _forecast_holt_winters(series, periods)

    future_index = pd.date_range(
        start=series.index[-1],
        periods=periods + 1,
        freq=series.index.freq or pd.infer_freq(series.index) or "D",
    )[1:]

    rmse = float(np.sqrt(np.mean((predicted - test.to_numpy()) ** 2)))
    mae = float(np.mean(np.abs(predicted - test.to_numpy())))
    mape = float(np.mean(np.abs((test.to_numpy() - predicted) / np.maximum(np.abs(test.to_numpy()), 1e-9))) * 100)

    forecast_points = []
    for idx, value, lower_bound, upper_bound in zip(
        future_index,
        full_predicted,
        future_lower,
        future_upper,
        strict=False,
    ):
        forecast_points.append(
            {
                "date": idx.isoformat(),
                "forecast": float(value),
                "lower": float(lower_bound),
                "upper": float(upper_bound),
            }
        )

    return {
        "method": method,
        "history_points": int(len(series)),
        "forecast_points": forecast_points,
        "metrics": to_native(
            {
                "rmse": rmse,
                "mae": mae,
                "mape": mape if not math.isinf(mape) else None,
                "last_actual": float(series.iloc[-1]),
                "last_fitted": float(np.ravel(fitted_values)[-1]),
            }
        ),
    }
