from types import SimpleNamespace

import pandas as pd

from app.services.ml_service import decision_tree


def test_decision_tree_basic(classification_data: list[dict[str, object]]) -> None:
    """Test basic decision tree classification."""
    frame = pd.DataFrame(classification_data)
    request = SimpleNamespace(
        algorithm="decision_tree",
        feature_columns=["feature_a", "feature_b"],
        target_column="target",
        max_depth=3,
        test_size=0.25,
    )
    result = decision_tree(frame, request)

    assert "metrics" in result
    metrics = result["metrics"]
    assert "accuracy" in metrics
    assert 0.0 <= metrics["accuracy"] <= 1.0
    assert "feature_importance" in result
    assert isinstance(result["feature_importance"], dict)
    assert "tree_structure" in result
    assert isinstance(result["tree_structure"], str)
    assert "class_labels" in result
    assert len(result["class_labels"]) >= 2
    assert result["row_count"] > 0


def test_decision_tree_no_max_depth(classification_data: list[dict[str, object]]) -> None:
    """Test decision tree with unlimited depth."""
    frame = pd.DataFrame(classification_data)
    request = SimpleNamespace(
        algorithm="decision_tree",
        feature_columns=["feature_a", "feature_b"],
        target_column="target",
        max_depth=None,
        test_size=0.2,
    )
    result = decision_tree(frame, request)
    assert result["metrics"]["accuracy"] > 0
    assert len(result["tree_structure"]) > 0
