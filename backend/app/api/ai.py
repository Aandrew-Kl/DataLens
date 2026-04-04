import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.auth import get_current_user
from app.api.docs import build_error_responses
from app.models.user import User
from app.schemas.ai import (
    ExplainRequest,
    ExplainResponse,
    NLQueryRequest,
    QueryGenerateRequest,
    QueryGenerateResponse,
    SentimentRequest,
    SentimentResponse,
    SummarizeRequest,
    SummarizeResponse,
)
from app.services import nlp_service

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post(
    "/sentiment",
    response_model=SentimentResponse,
    status_code=status.HTTP_200_OK,
    summary="Analyze sentiment",
    description="Score sentiment for text rows in the provided dataset sample and return aggregates and top terms.",
    response_description="The sentiment analysis results.",
    responses=build_error_responses(
        bad_request="The sentiment analysis request could not be processed with the provided dataset or parameters.",
    ),
)
async def analyze_sentiment(
    payload: SentimentRequest,
    _current_user: User = Depends(get_current_user),
) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return nlp_service.sentiment(frame, payload.text_column, payload.limit)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/summarize",
    response_model=SummarizeResponse,
    status_code=status.HTTP_200_OK,
    summary="Summarize text data",
    description="Generate a natural-language summary and key statistics for the provided text columns.",
    response_description="The dataset summary results.",
    responses=build_error_responses(
        bad_request="The summarization request could not be processed with the provided dataset or parameters.",
    ),
)
async def summarize_data(
    payload: SummarizeRequest,
    _current_user: User = Depends(get_current_user),
) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return nlp_service.summarize(frame, payload.dataset_id, payload.text_columns, payload.max_terms)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/generate-query",
    response_model=QueryGenerateResponse,
    status_code=status.HTTP_200_OK,
    summary="Generate SQL from natural language",
    description="Convert a natural-language question into a SQL query and explain the generated statement.",
    response_description="The generated SQL query and explanation.",
    responses=build_error_responses(
        bad_request="The SQL generation request could not be processed with the provided prompt or dataset context.",
    ),
)
async def generate_query(
    payload: QueryGenerateRequest,
    _current_user: User = Depends(get_current_user),
) -> dict:
    try:
        frame = pd.DataFrame(payload.data) if payload.data else pd.DataFrame()
        request = NLQueryRequest(question=payload.question, use_ollama=payload.use_ollama)
        return await nlp_service.generate_query(request, frame, payload.table_name)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/explain",
    response_model=ExplainResponse,
    status_code=status.HTTP_200_OK,
    summary="Explain SQL",
    description="Break down a SQL statement into a human-readable summary, steps, tables, and columns.",
    response_description="The SQL explanation details.",
    responses=build_error_responses(
        bad_request="The SQL explanation request could not be processed with the provided statement.",
    ),
)
async def explain_sql(
    payload: ExplainRequest,
    _current_user: User = Depends(get_current_user),
) -> dict:
    try:
        return nlp_service.explain(payload.sql)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
