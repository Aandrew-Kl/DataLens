from types import SimpleNamespace

import pandas as pd

from app.services.ml_service import anomaly_detect, classify, cluster, pca, regression


def test_regression_linear(regression_data: list[dict[str, object]]) -> None:
    request = SimpleNamespace(
        feature_columns=["feature_a", "feature_b"],
        target_column="target",
        algorithm="linear",
        test_size=0.2,
        cv_folds=5,
        alpha=1.0,
    )
    result = regression(pd.DataFrame(regression_data), request)

    metrics = result["metrics"]
    assert "r2" in metrics
    assert "rmse" in metrics
    assert "coefficients" in result
    assert len(result["coefficients"]) == 2


def test_regression_ridge(regression_data: list[dict[str, object]]) -> None:
    request = SimpleNamespace(
        feature_columns=["feature_a", "feature_b"],
        target_column="target",
        algorithm="ridge",
        test_size=0.2,
        cv_folds=5,
        alpha=0.5,
    )
    result = regression(pd.DataFrame(regression_data), request)

    assert result["algorithm"] == "ridge"
    assert "coefficients" in result


def test_cluster_kmeans(cluster_data: list[dict[str, object]]) -> None:
    frame = pd.DataFrame(cluster_data)
    request = SimpleNamespace(
        feature_columns=["feature_a", "feature_b"],
        algorithm="kmeans",
        n_clusters=2,
        eps=0.5,
        min_samples=3,
    )
    result = cluster(frame, request)

    assert len(result["labels"]) == len(cluster_data)
    centers = result["cluster_centers"] if "cluster_centers" in result else result.get("centers")
    assert centers is not None
    assert len(centers) == 2
    assert result["silhouette_score"] is not None


def test_cluster_dbscan(cluster_data: list[dict[str, object]]) -> None:
    frame = pd.DataFrame(cluster_data)
    request = SimpleNamespace(
        feature_columns=["feature_a", "feature_b"],
        algorithm="dbscan",
        n_clusters=2,
        eps=0.4,
        min_samples=4,
    )
    result = cluster(frame, request)

    assert "labels" in result
    assert len(result["labels"]) == len(cluster_data)


def test_classify_random_forest(classification_data: list[dict[str, object]]) -> None:
    frame = pd.DataFrame(classification_data)
    request = SimpleNamespace(
        target_column="target",
        feature_columns=["feature_a", "feature_b", "plan"],
        algorithm="random_forest",
        test_size=0.25,
    )
    result = classify(frame, request)
    metrics = result["metrics"]

    assert "accuracy" in metrics
    assert "precision" in metrics
    assert "recall" in metrics
    assert "f1" in metrics


def test_anomaly_isolation_forest(regression_data: list[dict[str, object]]) -> None:
    frame = pd.DataFrame(regression_data)
    request = SimpleNamespace(
        feature_columns=["feature_a", "feature_b", "feature_c"],
        algorithm="isolation_forest",
        contamination=0.05,
        n_neighbors=20,
    )
    result = anomaly_detect(frame, request)

    assert "labels" in result
    assert "anomaly_scores" in result
    assert len(result["labels"]) == len(regression_data)
    assert len(result["anomaly_scores"]) == len(regression_data)


def test_pca(cluster_data: list[dict[str, object]]) -> None:
    frame = pd.DataFrame(cluster_data)
    request = SimpleNamespace(
        feature_columns=["feature_a", "feature_b"],
        n_components=2,
    )
    result = pca(frame, request)

    explained = result["explained_variance_ratio"]
    transformed = result["transformed_data"]
    assert isinstance(explained, list)
    assert len(explained) == 2
    assert len(transformed) == len(cluster_data)
    assert len(transformed[0]) == 2
