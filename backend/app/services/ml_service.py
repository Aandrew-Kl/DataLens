"""Real machine-learning service implementations backed by scikit-learn."""

from __future__ import annotations

import logging
from typing import Any

import numpy as np
import pandas as pd
from sklearn.cluster import AgglomerativeClustering, DBSCAN, KMeans
from sklearn.compose import ColumnTransformer
from sklearn.decomposition import PCA
from sklearn.ensemble import GradientBoostingClassifier, IsolationForest, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Lasso, LinearRegression, Ridge
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score, mean_squared_error, precision_score, r2_score, recall_score, silhouette_score
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.neighbors import LocalOutlierFactor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier, export_text

from app.schemas.ml import AnomalyRequest, ClassificationRequest, ClusterRequest, DecisionTreeRequest, PCARequest, RegressionRequest
from app.services.data_service import ensure_columns_exist, to_native

logger = logging.getLogger(__name__)


def _require_rows(frame: pd.DataFrame, minimum: int = 8) -> None:
    """Raise when a dataframe is too small for robust modelling."""

    if frame.shape[0] < minimum:
        raise ValueError(f"At least {minimum} rows are required for this analysis.")


def _numeric_matrix(frame: pd.DataFrame, feature_columns: list[str]) -> pd.DataFrame:
    """Return a numeric feature matrix with validated columns."""

    ensure_columns_exist(frame, feature_columns)
    matrix = frame[feature_columns].apply(pd.to_numeric, errors="coerce")
    if matrix.dropna(how="all").empty:
        raise ValueError("Selected feature columns do not contain usable numeric data.")
    return matrix


def _build_preprocessor(frame: pd.DataFrame, feature_columns: list[str], scale_numeric: bool = False) -> ColumnTransformer:
    """Build a mixed-type feature preprocessor."""

    ensure_columns_exist(frame, feature_columns)
    feature_frame = frame[feature_columns].copy()
    numeric_columns = [
        column
        for column in feature_columns
        if pd.api.types.is_numeric_dtype(feature_frame[column])
    ]
    categorical_columns = [column for column in feature_columns if column not in numeric_columns]
    transformers: list[tuple[str, Pipeline, list[str]]] = []

    if numeric_columns:
        numeric_steps: list[tuple[str, Any]] = [("imputer", SimpleImputer(strategy="median"))]
        if scale_numeric:
            numeric_steps.append(("scaler", StandardScaler()))
        transformers.append(("num", Pipeline(numeric_steps), numeric_columns))

    if categorical_columns:
        transformers.append(
            (
                "cat",
                Pipeline(
                    [
                        ("imputer", SimpleImputer(strategy="most_frequent")),
                        ("encoder", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
                    ]
                ),
                categorical_columns,
            )
        )

    if not transformers:
        raise ValueError("No usable feature columns were supplied.")

    return ColumnTransformer(transformers=transformers, remainder="drop")


def regression(frame: pd.DataFrame, request: RegressionRequest) -> dict:
    """Run linear, ridge, or lasso regression with evaluation metrics."""

    logger.info("Running %s with %d rows, features=%s", request.algorithm, frame.shape[0], request.feature_columns)

    features = _numeric_matrix(frame, request.feature_columns)
    ensure_columns_exist(frame, [request.target_column])
    target = pd.to_numeric(frame[request.target_column], errors="coerce")
    working = pd.concat([features, target.rename(request.target_column)], axis=1).dropna(subset=[request.target_column])
    _require_rows(working, minimum=max(request.cv_folds + 1, 10))

    X = working[request.feature_columns]
    y = working[request.target_column]

    if request.algorithm == "linear":
        estimator = LinearRegression()
        pipeline = Pipeline([("imputer", SimpleImputer(strategy="median")), ("model", estimator)])
    elif request.algorithm == "ridge":
        estimator = Ridge(alpha=request.alpha, random_state=42)
        pipeline = Pipeline(
            [
                ("imputer", SimpleImputer(strategy="median")),
                ("scaler", StandardScaler()),
                ("model", estimator),
            ]
        )
    else:
        estimator = Lasso(alpha=request.alpha, random_state=42, max_iter=5000)
        pipeline = Pipeline(
            [
                ("imputer", SimpleImputer(strategy="median")),
                ("scaler", StandardScaler()),
                ("model", estimator),
            ]
        )

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=request.test_size,
        random_state=42,
    )
    pipeline.fit(X_train, y_train)
    predictions = pipeline.predict(X_test)
    cv_folds = min(request.cv_folds, len(X))
    cv_scores = cross_val_score(pipeline, X, y, cv=cv_folds, scoring="r2")
    fitted_model = pipeline.named_steps["model"]

    return {
        "algorithm": request.algorithm,
        "row_count": int(len(X)),
        "metrics": {
            "r2": float(r2_score(y_test, predictions)),
            "rmse": float(np.sqrt(mean_squared_error(y_test, predictions))),
            "cv_scores": to_native(cv_scores),
            "cv_mean": float(np.mean(cv_scores)),
            "cv_std": float(np.std(cv_scores)),
        },
        "coefficients": {
            column: float(coefficient)
            for column, coefficient in zip(request.feature_columns, np.ravel(fitted_model.coef_), strict=False)
        },
        "intercept": float(np.ravel(np.array([fitted_model.intercept_]))[0]),
        "residuals": to_native((y_test - predictions).tolist()),
        "predictions": to_native(predictions.tolist()),
    }


def cluster(frame: pd.DataFrame, request: ClusterRequest) -> dict:
    """Cluster observations using KMeans, DBSCAN, or agglomerative clustering."""

    logger.info("Running %s with %d rows, features=%s", request.algorithm, frame.shape[0], request.feature_columns)

    features = _numeric_matrix(frame, request.feature_columns)
    _require_rows(features, minimum=6)

    imputer = SimpleImputer(strategy="median")
    scaler = StandardScaler()
    X_imputed = imputer.fit_transform(features)
    X_scaled = scaler.fit_transform(X_imputed)

    if request.algorithm == "kmeans":
        estimator = KMeans(n_clusters=request.n_clusters, n_init=20, random_state=42)
        labels = estimator.fit_predict(X_scaled)
        centers = scaler.inverse_transform(estimator.cluster_centers_)
    elif request.algorithm == "dbscan":
        estimator = DBSCAN(eps=request.eps, min_samples=request.min_samples)
        labels = estimator.fit_predict(X_scaled)
        centers = []
    else:
        estimator = AgglomerativeClustering(n_clusters=request.n_clusters, linkage=request.linkage)
        labels = estimator.fit_predict(X_scaled)
        centers = []

    center_rows: list[dict[str, float]] = []
    unique_labels = sorted({int(label) for label in labels})
    for label in unique_labels:
        if label == -1:
            continue
        if request.algorithm == "kmeans":
            index = unique_labels.index(label) if request.algorithm != "kmeans" else label
            vector = centers[index]
        else:
            vector = X_imputed[np.array(labels) == label].mean(axis=0)
        center_rows.append(
            {column: float(value) for column, value in zip(request.feature_columns, vector, strict=False)}
        )

    usable_mask = np.array(labels) != -1
    silhouette = None
    usable_labels = np.array(labels)[usable_mask]
    if usable_mask.sum() > 2 and len(np.unique(usable_labels)) > 1:
        silhouette = float(silhouette_score(X_scaled[usable_mask], usable_labels))

    cluster_sizes = {
        str(label): int((np.array(labels) == label).sum())
        for label in unique_labels
    }

    return {
        "algorithm": request.algorithm,
        "row_count": int(features.shape[0]),
        "labels": to_native(labels.tolist()),
        "silhouette_score": silhouette,
        "cluster_centers": center_rows,
        "cluster_sizes": cluster_sizes,
    }


def classify(frame: pd.DataFrame, request: ClassificationRequest) -> dict:
    """Run a supervised classification model and return evaluation metrics."""

    logger.info("Running %s with %d rows, features=%s", request.algorithm, frame.shape[0], request.feature_columns)

    ensure_columns_exist(frame, request.feature_columns + [request.target_column])
    working = frame[request.feature_columns + [request.target_column]].dropna(subset=[request.target_column]).copy()
    _require_rows(working, minimum=20)
    y = working[request.target_column].astype(str)

    preprocessor = _build_preprocessor(working, request.feature_columns, scale_numeric=request.algorithm == "svm")
    if request.algorithm == "random_forest":
        model = RandomForestClassifier(n_estimators=250, random_state=42)
    elif request.algorithm == "gradient_boosting":
        model = GradientBoostingClassifier(random_state=42)
    else:
        model = SVC(probability=True, random_state=42)

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
    labels = sorted(y.unique().tolist())

    return {
        "algorithm": request.algorithm,
        "row_count": int(len(working)),
        "class_labels": labels,
        "metrics": {
            "accuracy": float(accuracy_score(y_test, predictions)),
            "precision": float(precision_score(y_test, predictions, average="weighted", zero_division=0)),
            "recall": float(recall_score(y_test, predictions, average="weighted", zero_division=0)),
            "f1": float(f1_score(y_test, predictions, average="weighted", zero_division=0)),
        },
        "confusion_matrix": to_native(confusion_matrix(y_test, predictions, labels=labels).tolist()),
        "classification_report": classification_report(y_test, predictions, labels=labels, output_dict=True, zero_division=0),
        "predictions": predictions.tolist(),
    }


def anomaly_detect(frame: pd.DataFrame, request: AnomalyRequest) -> dict:
    """Detect anomalies with isolation forests or local outlier factor."""

    logger.info("Running %s with %d rows, features=%s", request.algorithm, frame.shape[0], request.feature_columns)

    features = _numeric_matrix(frame, request.feature_columns)
    _require_rows(features, minimum=15)

    imputer = SimpleImputer(strategy="median")
    scaler = StandardScaler()
    X_imputed = imputer.fit_transform(features)
    X_scaled = scaler.fit_transform(X_imputed)

    if request.algorithm == "isolation_forest":
        model = IsolationForest(contamination=request.contamination, random_state=42)
        labels = model.fit_predict(X_scaled)
        scores = -model.score_samples(X_scaled)
    else:
        model = LocalOutlierFactor(contamination=request.contamination, n_neighbors=request.n_neighbors)
        labels = model.fit_predict(X_scaled)
        scores = -model.negative_outlier_factor_

    return {
        "algorithm": request.algorithm,
        "row_count": int(features.shape[0]),
        "labels": to_native(labels.tolist()),
        "anomaly_scores": to_native(scores.tolist()),
        "anomaly_count": int((labels == -1).sum()),
    }


def pca(frame: pd.DataFrame, request: PCARequest) -> dict:
    """Run principal component analysis on numeric features."""

    logger.info("Running %s with %d rows, features=%s", request.algorithm, frame.shape[0], request.feature_columns)

    features = _numeric_matrix(frame, request.feature_columns)
    _require_rows(features, minimum=4)

    imputer = SimpleImputer(strategy="median")
    scaler = StandardScaler()
    X_imputed = imputer.fit_transform(features)
    X_scaled = scaler.fit_transform(X_imputed)

    max_components = min(X_scaled.shape[0], X_scaled.shape[1])
    n_components = request.n_components or min(2, max_components)
    n_components = min(n_components, max_components)
    estimator = PCA(n_components=n_components, random_state=42)
    transformed = estimator.fit_transform(X_scaled)

    loadings: list[dict[str, float]] = []
    for index, component in enumerate(estimator.components_, start=1):
        row = {"component": f"PC{index}"}
        row.update(
            {
                column: float(weight)
                for column, weight in zip(request.feature_columns, component, strict=False)
            }
        )
        loadings.append(row)

    return {
        "row_count": int(features.shape[0]),
        "explained_variance_ratio": to_native(estimator.explained_variance_ratio_.tolist()),
        "loadings": loadings,
        "transformed_data": to_native(transformed.tolist()),
    }


def decision_tree(frame: pd.DataFrame, request: DecisionTreeRequest) -> dict:
    """Train and export a decision tree classifier."""

    logger.info("Running %s with %d rows, features=%s", request.algorithm, frame.shape[0], request.feature_columns)

    ensure_columns_exist(frame, request.feature_columns + [request.target_column])
    working = frame[request.feature_columns + [request.target_column]].dropna(subset=[request.target_column]).copy()
    _require_rows(working, minimum=20)
    y = working[request.target_column].astype(str)

    preprocessor = _build_preprocessor(working, request.feature_columns, scale_numeric=False)
    model = DecisionTreeClassifier(random_state=42, max_depth=request.max_depth)
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

    fitted_preprocessor: ColumnTransformer = pipeline.named_steps["preprocessor"]
    feature_names = fitted_preprocessor.get_feature_names_out()
    fitted_model: DecisionTreeClassifier = pipeline.named_steps["model"]

    return {
        "row_count": int(len(working)),
        "feature_importance": {
            str(name): float(score)
            for name, score in zip(feature_names, fitted_model.feature_importances_, strict=False)
            if float(score) > 0
        },
        "tree_structure": export_text(fitted_model, feature_names=list(feature_names)),
        "metrics": {
            "accuracy": float(accuracy_score(y_test, predictions)),
            "precision": float(precision_score(y_test, predictions, average="weighted", zero_division=0)),
            "recall": float(recall_score(y_test, predictions, average="weighted", zero_division=0)),
            "f1": float(f1_score(y_test, predictions, average="weighted", zero_division=0)),
        },
        "class_labels": sorted(y.unique().tolist()),
    }
