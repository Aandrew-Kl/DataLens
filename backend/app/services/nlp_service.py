"""NLP service implementations using TextBlob, NLTK, and SQL parsing."""

from __future__ import annotations

import re
from collections import Counter
from time import perf_counter

import pandas as pd
import sqlparse
from httpx import AsyncClient, HTTPError
from nltk.stem.snowball import SnowballStemmer
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer
from textblob import TextBlob

from app.config import get_settings
from app.schemas.ai import NLQueryRequest
from app.services.data_service import ensure_columns_exist, profile_dataset, to_native

_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_]+")
_TABLE_RE = re.compile(r"\b(?:FROM|JOIN)\s+([A-Za-z0-9_\".]+)", re.IGNORECASE)
_SELECT_RE = re.compile(r"\bSELECT\b(.*?)\bFROM\b", re.IGNORECASE | re.DOTALL)
_GROUP_RE = re.compile(r"\bGROUP\s+BY\b(.*?)(?:\bORDER\b|\bLIMIT\b|$)", re.IGNORECASE | re.DOTALL)
_ORDER_RE = re.compile(r"\bORDER\s+BY\b(.*?)(?:\bLIMIT\b|$)", re.IGNORECASE | re.DOTALL)
_WHERE_RE = re.compile(r"\bWHERE\b(.*?)(?:\bGROUP\b|\bORDER\b|\bLIMIT\b|$)", re.IGNORECASE | re.DOTALL)
_LIMIT_RE = re.compile(r"\bLIMIT\b\s+(\d+)", re.IGNORECASE)
_stemmer = SnowballStemmer("english")


def _analyzer(text: str) -> list[str]:
    """Tokenize and stem English text for vectorization."""

    tokens = _TOKEN_RE.findall(text.lower())
    return [
        _stemmer.stem(token)
        for token in tokens
        if token not in ENGLISH_STOP_WORDS and len(token) > 2
    ]


def _top_terms(texts: list[str], max_terms: int) -> list[dict[str, float | str]]:
    """Return TF-IDF weighted top terms."""

    documents = [text for text in texts if text and text.strip()]
    if not documents:
        return []
    vectorizer = TfidfVectorizer(analyzer=_analyzer, max_features=max_terms)
    matrix = vectorizer.fit_transform(documents)
    scores = matrix.mean(axis=0).A1
    features = vectorizer.get_feature_names_out()
    order = scores.argsort()[::-1]
    return [
        {"term": str(features[index]), "score": float(scores[index])}
        for index in order
        if scores[index] > 0
    ]


def sentiment(frame: pd.DataFrame, text_column: str, limit: int | None = None) -> dict:
    """Analyze row-level sentiment with TextBlob."""

    ensure_columns_exist(frame, [text_column])
    texts = frame[text_column].dropna().astype(str)
    if texts.empty:
        raise ValueError("Selected text column does not contain any non-null rows.")

    if limit is not None:
        texts = texts.head(limit)

    rows = []
    term_scores: Counter[str] = Counter()
    for index, text in texts.items():
        blob = TextBlob(text)
        polarity = float(blob.sentiment.polarity)
        subjectivity = float(blob.sentiment.subjectivity)
        label = "positive" if polarity > 0.1 else "negative" if polarity < -0.1 else "neutral"
        rows.append(
            {
                "row_index": int(index),
                "text": text,
                "polarity": polarity,
                "subjectivity": subjectivity,
                "label": label,
            }
        )
        for token in _analyzer(text):
            term_scores[token] += polarity

    polarities = [row["polarity"] for row in rows]
    subjectivities = [row["subjectivity"] for row in rows]
    top_terms = [
        {"term": token, "score": float(score)}
        for token, score in term_scores.most_common(10)
    ]

    return {
        "text_column": text_column,
        "row_count": len(rows),
        "aggregate": {
            "mean_polarity": float(pd.Series(polarities).mean()),
            "median_polarity": float(pd.Series(polarities).median()),
            "mean_subjectivity": float(pd.Series(subjectivities).mean()),
            "positive_share": float(sum(value > 0.1 for value in polarities) / len(polarities)),
            "negative_share": float(sum(value < -0.1 for value in polarities) / len(polarities)),
        },
        "rows": rows,
        "top_terms": top_terms,
    }


def summarize(frame: pd.DataFrame, dataset_id: int, text_columns: list[str], max_terms: int) -> dict:
    """Summarize a dataset with descriptive statistics and TF-IDF terms."""

    available_text_columns = text_columns or [
        column
        for column in frame.columns
        if pd.api.types.is_string_dtype(frame[column]) or pd.api.types.is_object_dtype(frame[column])
    ]
    ensure_columns_exist(frame, available_text_columns)

    profile = profile_dataset(frame)
    documents: list[str] = []
    for column in available_text_columns:
        documents.extend(frame[column].dropna().astype(str).tolist())
    top_terms = _top_terms(documents, max_terms=max_terms)

    null_cells = int(frame.isna().sum().sum())
    correlations_text = ", ".join(
        "{} vs {} ({:.2f})".format(pair["left"], pair["right"], pair["correlation"])
        for pair in profile["correlations"][:3]
    ) or "not available"
    terms_text = ", ".join(term["term"] for term in top_terms[:5]) or "not available"
    summary_text = (
        f"Dataset {dataset_id} contains {frame.shape[0]} rows across {frame.shape[1]} columns. "
        f"There are {null_cells} missing cells in total. "
        f"The strongest numeric correlations are {correlations_text}. "
        f"Top textual terms are {terms_text}."
    )

    key_statistics = {
        "row_count": int(frame.shape[0]),
        "column_count": int(frame.shape[1]),
        "missing_cells": null_cells,
        "numeric_columns": int(frame.select_dtypes(include=["number"]).shape[1]),
        "text_columns": available_text_columns,
        "correlations": profile["correlations"][:5],
    }

    return {
        "dataset_id": dataset_id,
        "summary_text": summary_text,
        "key_statistics": key_statistics,
        "top_terms": top_terms,
    }


def _extract_entities(question: str, frame: pd.DataFrame) -> dict:
    """Extract likely columns, operations, and filters from a natural-language question."""

    lowered = question.lower()
    columns = list(frame.columns)
    matched_columns = [column for column in columns if column.lower() in lowered]
    numeric_columns = [
        column for column in columns if pd.api.types.is_numeric_dtype(frame[column])
    ]
    categorical_columns = [column for column in columns if column not in numeric_columns]

    aggregate = "count"
    if any(word in lowered for word in ("average", "avg", "mean")):
        aggregate = "avg"
    elif any(word in lowered for word in ("sum", "total", "revenue")):
        aggregate = "sum"
    elif any(word in lowered for word in ("max", "highest", "largest", "top")):
        aggregate = "max"
    elif any(word in lowered for word in ("min", "lowest", "smallest")):
        aggregate = "min"

    target_column = next((column for column in matched_columns if column in numeric_columns), None)
    if target_column is None and aggregate != "count" and numeric_columns:
        target_column = numeric_columns[0]

    group_by = None
    by_match = re.search(r"\bby ([a-zA-Z0-9_ ]+)", lowered)
    if by_match:
        by_fragment = by_match.group(1).strip()
        group_by = next(
            (column for column in columns if column.lower() in by_fragment),
            next((column for column in matched_columns if column in categorical_columns), None),
        )

    limit_match = re.search(r"\btop (\d+)", lowered)
    filters = []
    if "where " in lowered:
        after_where = lowered.split("where ", maxsplit=1)[1]
        filters.append(after_where.strip())

    return {
        "aggregate": aggregate,
        "matched_columns": matched_columns,
        "target_column": target_column,
        "group_by": group_by,
        "limit": int(limit_match.group(1)) if limit_match else None,
        "filters": filters,
    }


def _build_sql(entities: dict, table_name: str) -> str:
    """Build a SQL statement from extracted entities."""

    aggregate = entities["aggregate"]
    target = entities["target_column"]
    group_by = entities["group_by"]
    limit = entities["limit"]
    filters = entities["filters"]

    if aggregate == "count":
        select_expr = "COUNT(*) AS row_count"
    elif target is None:
        select_expr = "*"
    else:
        select_expr = f"{aggregate.upper()}(\"{target}\") AS {aggregate}_{target}"

    if group_by:
        sql = f'SELECT "{group_by}", {select_expr} FROM "{table_name}"'
    else:
        sql = f"SELECT {select_expr} FROM \"{table_name}\""

    if filters:
        sql += f" WHERE {filters[0]}"
    if group_by:
        sql += f' GROUP BY "{group_by}" ORDER BY {select_expr.split(" AS ")[-1]} DESC'
    if limit:
        sql += f" LIMIT {limit}"
    return sql


async def _generate_with_ollama(question: str, columns: list[str], table_name: str) -> str | None:
    """Optionally delegate SQL generation to Ollama."""

    settings = get_settings()
    prompt = (
        f"You translate analytics questions into PostgreSQL-compatible SQL. "
        f"Table name: {table_name}. Columns: {', '.join(columns)}. "
        f"Return SQL only for: {question}"
    )
    payload = {
        "model": "llama3.1",
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
    }
    try:
        async with AsyncClient(base_url=str(settings.OLLAMA_URL), timeout=20.0) as client:
            response = await client.post("/api/chat", json=payload)
            response.raise_for_status()
            data = response.json()
            return (
                data.get("message", {}).get("content")
                or data.get("response")
            )
    except HTTPError:
        return None


async def generate_query(request: NLQueryRequest, frame: pd.DataFrame, table_name: str) -> dict:
    """Translate a natural-language question into SQL."""

    start = perf_counter()
    entities = _extract_entities(request.question, frame)
    sql = _build_sql(entities, table_name)
    used_ollama = False

    if request.use_ollama:
        ollama_sql = await _generate_with_ollama(request.question, list(frame.columns), table_name)
        if ollama_sql:
            sql = ollama_sql.strip().strip("`")
            used_ollama = True

    duration_ms = int((perf_counter() - start) * 1000)
    explanation = (
        f"Generated {entities['aggregate']} query"
        + (f" grouped by {entities['group_by']}" if entities["group_by"] else "")
        + (f" with limit {entities['limit']}" if entities["limit"] else "")
        + f" in {duration_ms} ms."
    )

    return {
        "sql": sqlparse.format(sql, reindent=True, keyword_case="upper"),
        "explanation": explanation,
        "extracted_entities": entities,
        "used_ollama": used_ollama,
        "duration_ms": duration_ms,
    }


def explain(sql: str) -> dict:
    """Explain a SQL query in plain English."""

    formatted = sqlparse.format(sql, reindent=True, keyword_case="upper")
    tables = [match for match in sum(_TABLE_RE.findall(formatted), ()) if match]
    select_clause = _SELECT_RE.search(formatted)
    where_clause = _WHERE_RE.search(formatted)
    group_clause = _GROUP_RE.search(formatted)
    order_clause = _ORDER_RE.search(formatted)
    limit_clause = _LIMIT_RE.search(formatted)

    selected_columns = []
    if select_clause:
        selected_columns = [
            part.strip()
            for part in select_clause.group(1).replace("\n", " ").split(",")
            if part.strip()
        ]

    steps = []
    if tables:
        steps.append(f"Reads data from {', '.join(tables)}.")
    if selected_columns:
        steps.append(f"Selects {', '.join(selected_columns)}.")
    if where_clause:
        steps.append(f"Filters rows where {where_clause.group(1).strip()}.")
    if group_clause:
        steps.append(f"Groups rows by {group_clause.group(1).strip()}.")
    if order_clause:
        steps.append(f"Orders results by {order_clause.group(1).strip()}.")
    if limit_clause:
        steps.append(f"Limits the output to {limit_clause.group(1)} rows.")

    summary = " ".join(steps) if steps else "Parses and returns rows from the referenced SQL statement."
    return {
        "summary": summary,
        "steps": steps,
        "tables": tables,
        "columns": selected_columns,
    }
