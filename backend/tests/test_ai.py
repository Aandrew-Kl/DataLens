from app.services.nlp_service import sentiment


def test_sentiment_analysis_labels_texts(sentiment_texts: list[str]) -> None:
    result = sentiment(sentiment_texts)

    labels = [item["label"] for item in result["results"]]
    assert labels[0] == "positive"
    assert labels[1] == "negative"
    assert labels[2] == "neutral"
