from types import SimpleNamespace

import pandas as pd
import pytest

from app.services.nlp_service import generate_query, sentiment, summarize


def _sentiment_for_text(text: str) -> str:
    data_frame = pd.DataFrame({"text": [text]})
    return sentiment(data_frame, "text")["rows"][0]["label"]


def test_sentiment_positive() -> None:
    assert _sentiment_for_text("I love this great product") == "positive"


def test_sentiment_negative() -> None:
    assert _sentiment_for_text("This is terrible and bad") == "negative"


def test_sentiment_neutral() -> None:
    assert _sentiment_for_text("The meeting is at 3pm") == "neutral"


def test_summarize() -> None:
    frame = pd.DataFrame(
        {
            "notes": [
                "System logs show reliable uptime and quick response times.",
                "Support requested multiple times after deployment.",
                "Revenue increased after the launch."
            ]
        }
    )
    result = summarize(frame, dataset_id=7, text_columns=["notes"], max_terms=5)

    assert isinstance(result["summary_text"], str)
    assert isinstance(result["top_terms"], list)


@pytest.mark.asyncio
async def test_generate_query_count() -> None:
    frame = pd.DataFrame(
        {
            "users": [10, 20, 30],
            "salary": [50000, 55000, 52000],
        }
    )
    request = SimpleNamespace(question="how many users", use_ollama=False)
    result = await generate_query(request, frame, table_name="user_activity")

    assert "COUNT(*)" in result["sql"].upper()


@pytest.mark.asyncio
async def test_generate_query_average() -> None:
    frame = pd.DataFrame(
        {
            "salary": [50000, 55000, 52000],
            "users": [10, 20, 30],
        }
    )
    request = SimpleNamespace(question="average salary", use_ollama=False)
    result = await generate_query(request, frame, table_name="payroll")

    assert "AVG(" in result["sql"].upper()
