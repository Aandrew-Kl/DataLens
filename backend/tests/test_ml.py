from app.services.ml_service import cluster, regression


def test_regression_returns_strong_fit(regression_data: list[dict[str, float]]) -> None:
    result = regression(regression_data, target="target", features=["x1", "x2"], method="linear")

    assert result["r2"] > 0.98
    assert result["rmse"] < 0.2
    assert abs(result["coefficients"]["x1"] - 3.0) < 0.15
    assert abs(result["coefficients"]["x2"] + 2.0) < 0.15


def test_clustering_finds_two_clusters(cluster_data: list[dict[str, float]]) -> None:
    result = cluster(cluster_data, features=["x", "y"], method="kmeans", n_clusters=2)

    assert len(set(result["labels"])) == 2
    assert result["centers"] is not None
    assert len(result["centers"]) == 2
    assert result["silhouette"] is not None
    assert result["silhouette"] > 0.8
