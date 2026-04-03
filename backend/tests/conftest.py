import sys
from pathlib import Path

import numpy as np
import pytest


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


@pytest.fixture
def regression_data() -> list[dict[str, float]]:
    rng = np.random.default_rng(42)
    x1 = rng.normal(0, 1, 120)
    x2 = rng.normal(0, 1, 120)
    noise = rng.normal(0, 0.1, 120)
    y = 3.0 * x1 - 2.0 * x2 + noise
    return [
        {"x1": float(feature_one), "x2": float(feature_two), "target": float(target)}
        for feature_one, feature_two, target in zip(x1, x2, y, strict=False)
    ]


@pytest.fixture
def cluster_data() -> list[dict[str, float]]:
    rng = np.random.default_rng(7)
    cluster_one = rng.normal(loc=(0.0, 0.0), scale=0.25, size=(30, 2))
    cluster_two = rng.normal(loc=(4.0, 4.0), scale=0.25, size=(30, 2))
    combined = np.vstack([cluster_one, cluster_two])
    return [{"x": float(row[0]), "y": float(row[1])} for row in combined]


@pytest.fixture
def sentiment_texts() -> list[str]:
    return [
        "I absolutely love this product. It works beautifully.",
        "This is the worst customer experience I have had in months.",
        "The release shipped today.",
    ]
