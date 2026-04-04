import pandas as pd
from fastapi import APIRouter, HTTPException, status

from app.schemas.ai import (
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


@router.post("/sentiment", response_model=SentimentResponse)
async def analyze_sentiment(payload: SentimentRequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return nlp_service.sentiment(frame, payload.text_column, payload.limit)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/summarize", response_model=SummarizeResponse)
async def summarize_data(payload: SummarizeRequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return nlp_service.summarize(frame, payload.dataset_id, payload.text_columns, payload.max_terms)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/generate-query", response_model=QueryGenerateResponse)
async def generate_query(payload: QueryGenerateRequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data) if payload.data else pd.DataFrame()
        request = NLQueryRequest(question=payload.question, use_ollama=payload.use_ollama)
        return await nlp_service.generate_query(request, frame, payload.table_name)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
