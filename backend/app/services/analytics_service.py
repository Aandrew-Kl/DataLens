"""Analytics service functions for churn, cohorts, and A/B testing."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy.stats import chi2_contingency, t, ttest_ind
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline

from app.schemas.analytics import AbTestRequest, ChurnPredictRequest, CohortRequest
from app.services import forecast_service
from app.services.data_service import ensure_columns_exist, to_native
from app.services.ml_service import _build_preprocessor, _require_rows


def churn_predict(frame: pd.DataFrame, request: ChurnPredictRequest) -> dict:
    """Train a gradient-boosted churn model and return risk scores."""

    ensure_columns_exist(frame, request.feature_columns + [request.target_column])
    working = frame[request.feature_columns + [request.target_column]].dropna(subset=[request.target_column]).copy()
    _require_rows(working, minimum=20)
    y = working[request.target_column].astype(str)
    if y.nunique() < 2:
        raise ValueError("Churn prediction requires at least two target classes.")

    preprocessor = _build_preprocessor(working, request.feature_columns, scale_numeric=False)
    model = GradientBoostingClassifier(random_state=42)
    pipeline = Pipeline([("preprocessor", preprocessor), ("model", model)])

    stratify = y if y.value_counts().min() > 1 else None
    X_train, X_test, y_train, y_test = train_test_split(
        working[request.feature_columns],
        y,
        test_size=request.test_size,
        random_state=42,
        stratify=stratify,
    )
    pipeline.fit(X_train, y_train)
    predictions = pipeline.predict(X_test)
    probabilities = pipeline.predict_proba(working[request.feature_columns])

    classes = [str(label) for label in pipeline.named_steps["model"].classes_]
    positive_index = next(
        (index for index, label in enumerate(classes) if label.lower() in {"1", "true", "yes", "churn", "churned"}),
        len(classes) - 1,
    )

    fitted_preprocessor = pipeline.named_steps["preprocessor"]
    feature_names = fitted_preprocessor.get_feature_names_out()
    feature_importance = {
        str(name): float(score)
        for name, score in zip(feature_names, pipeline.named_steps["model"].feature_importances_, strict=False)
        if float(score) > 0
    }

    metrics = {
        "accuracy": float(accuracy_score(y_test, predictions)),
        "precision": float(precision_score(y_test, predictions, average="weighted", zero_division=0)),
        "recall": float(recall_score(y_test, predictions, average="weighted", zero_division=0)),
        "f1": float(f1_score(y_test, predictions, average="weighted", zero_division=0)),
    }
    if len(classes) == 2:
        y_binary = (y_test == classes[positive_index]).astype(int)
        metrics["roc_auc"] = float(
            roc_auc_score(y_binary, pipeline.predict_proba(X_test)[:, positive_index])
        )

    return {
        "row_count": int(len(working)),
        "metrics": metrics,
        "feature_importance": feature_importance,
        "risk_scores": to_native((probabilities[:, positive_index] * 100).tolist()),
        "predictions": pipeline.predict(working[request.feature_columns]).tolist(),
    }


def cohort_analysis(frame: pd.DataFrame, request: CohortRequest) -> dict:
    """Build cohort retention outputs grouped by signup period."""

    ensure_columns_exist(
        frame,
        [request.entity_id_column, request.signup_date_column, request.activity_date_column],
    )
    working = frame[
        [request.entity_id_column, request.signup_date_column, request.activity_date_column]
    ].copy()
    working[request.signup_date_column] = pd.to_datetime(working[request.signup_date_column], errors="coerce")
    working[request.activity_date_column] = pd.to_datetime(working[request.activity_date_column], errors="coerce")
    working = working.dropna()
    if working.empty:
        raise ValueError("No valid rows were available for cohort analysis.")

    def bucket(series: pd.Series) -> pd.Series:
        if request.frequency == "weekly":
            return series.dt.to_period("W")
        return series.dt.to_period("M")

    users = (
        working.groupby(request.entity_id_column)[request.signup_date_column]
        .min()
        .rename("signup_date")
        .reset_index()
    )
    users["cohort_period"] = bucket(users["signup_date"])
    activities = working[[request.entity_id_column, request.activity_date_column]].drop_duplicates().copy()
    activities["activity_period"] = bucket(activities[request.activity_date_column])

    merged = activities.merge(users[[request.entity_id_column, "cohort_period"]], on=request.entity_id_column, how="inner")
    if request.frequency == "weekly":
        offsets = (
            merged["activity_period"].dt.start_time - merged["cohort_period"].dt.start_time
        ).dt.days // 7
    else:
        offsets = (
            (merged["activity_period"].dt.year - merged["cohort_period"].dt.year) * 12
            + merged["activity_period"].dt.month
            - merged["cohort_period"].dt.month
        )
    merged["period_index"] = offsets
    merged = merged[merged["period_index"] >= 0]

    cohort_sizes = users.groupby("cohort_period")[request.entity_id_column].nunique()
    retention = (
        merged.groupby(["cohort_period", "period_index"])[request.entity_id_column]
        .nunique()
        .rename("retained_users")
        .reset_index()
    )
    retention["cohort_size"] = retention["cohort_period"].map(cohort_sizes)
    retention["retention_rate"] = retention["retained_users"] / retention["cohort_size"] * 100
    retention["cohort_label"] = retention["cohort_period"].astype(str)

    rows = [
        {
            "cohort_period": str(row.cohort_period),
            "period_index": int(row.period_index),
            "cohort_size": int(row.cohort_size),
            "retained_users": int(row.retained_users),
            "retention_rate": round(float(row.retention_rate), 4),
        }
        for row in retention.itertuples(index=False)
    ]

    summaries = []
    for cohort_period, group in retention.groupby("cohort_period"):
        second_period = group[group["period_index"] == 1]["retention_rate"]
        summaries.append(
            {
                "cohort_period": str(cohort_period),
                "cohort_size": int(group["cohort_size"].iloc[0]),
                "max_period_index": int(group["period_index"].max()),
                "first_period_retention": round(float(second_period.iloc[0]), 4) if not second_period.empty else None,
            }
        )

    return {
        "total_users": int(users[request.entity_id_column].nunique()),
        "cohort_count": int(users["cohort_period"].nunique()),
        "retention_rows": rows,
        "summaries": summaries,
    }


def _cohens_d(a: np.ndarray, b: np.ndarray) -> float:
    """Compute Cohen's d for two independent samples."""

    pooled = np.sqrt(((len(a) - 1) * np.var(a, ddof=1) + (len(b) - 1) * np.var(b, ddof=1)) / (len(a) + len(b) - 2))
    if pooled == 0:
        return 0.0
    return float((np.mean(a) - np.mean(b)) / pooled)


def ab_test(frame: pd.DataFrame, request: AbTestRequest) -> dict:
    """Run a continuous or binary A/B test."""

    ensure_columns_exist(frame, [request.group_column, request.metric_column])
    working = frame[[request.group_column, request.metric_column]].dropna().copy()
    group_a = working.loc[working[request.group_column].astype(str) == request.variant_a, request.metric_column]
    group_b = working.loc[working[request.group_column].astype(str) == request.variant_b, request.metric_column]
    if group_a.empty or group_b.empty:
        raise ValueError("Both A/B variants must have at least one observation.")

    alpha = 1 - request.confidence_level
    significant = False
    summary: dict[str, float | int] = {
        "variant_a_count": int(group_a.shape[0]),
        "variant_b_count": int(group_b.shape[0]),
    }

    if request.metric_type == "binary":
        binary_a = group_a.astype(str).str.lower().isin({"1", "true", "yes", "converted"}).astype(int)
        binary_b = group_b.astype(str).str.lower().isin({"1", "true", "yes", "converted"}).astype(int)
        contingency = np.array(
            [
                [int(binary_a.sum()), int((1 - binary_a).sum())],
                [int(binary_b.sum()), int((1 - binary_b).sum())],
            ]
        )
        statistic, p_value, _, _ = chi2_contingency(contingency, correction=False)
        rate_a = float(binary_a.mean())
        rate_b = float(binary_b.mean())
        diff = rate_b - rate_a
        se = math.sqrt(
            (rate_a * (1 - rate_a) / max(len(binary_a), 1))
            + (rate_b * (1 - rate_b) / max(len(binary_b), 1))
        )
        z = 1.96
        confidence_interval = [diff - z * se, diff + z * se]
        effect_size = diff
        significant = bool(p_value < alpha)
        summary.update(
            {
                "variant_a_rate": rate_a,
                "variant_b_rate": rate_b,
                "uplift": diff,
            }
        )
        test_used = "chi2_contingency"
    else:
        continuous_a = pd.to_numeric(group_a, errors="coerce").dropna().to_numpy()
        continuous_b = pd.to_numeric(group_b, errors="coerce").dropna().to_numpy()
        if len(continuous_a) < 2 or len(continuous_b) < 2:
            raise ValueError("Continuous A/B tests require at least two numeric observations per variant.")
        statistic, p_value = ttest_ind(continuous_a, continuous_b, equal_var=False)
        diff = float(np.mean(continuous_b) - np.mean(continuous_a))
        se = math.sqrt(np.var(continuous_a, ddof=1) / len(continuous_a) + np.var(continuous_b, ddof=1) / len(continuous_b))
        dof = len(continuous_a) + len(continuous_b) - 2
        t_crit = float(t.ppf(1 - alpha / 2, dof))
        confidence_interval = [diff - t_crit * se, diff + t_crit * se]
        effect_size = _cohens_d(continuous_a, continuous_b)
        significant = bool(p_value < alpha)
        summary.update(
            {
                "variant_a_mean": float(np.mean(continuous_a)),
                "variant_b_mean": float(np.mean(continuous_b)),
                "uplift": diff,
            }
        )
        test_used = "ttest_ind"

    return {
        "test_used": test_used,
        "p_value": float(p_value),
        "statistic": float(statistic),
        "confidence_interval": to_native(confidence_interval),
        "effect_size": float(effect_size),
        "significant": significant,
        "summary": summary,
    }


def forecast(frame: pd.DataFrame, date_column: str, value_column: str, periods: int, method: str) -> dict:
    """Delegate time-series forecasting to the forecast service."""

    return forecast_service.forecast(frame, date_column=date_column, value_column=value_column, periods=periods, method=method)
