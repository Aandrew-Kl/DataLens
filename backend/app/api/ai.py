from fastapi import APIRouter, HTTPException, status

from app.schemas.ai import (
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
        return nlp_service.sentiment(payload.texts)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/summarize", response_model=SummarizeResponse)
async def summarize_data(payload: SummarizeRequest) -> dict:
    try:
        return nlp_service.summarize(payload.data, payload.columns)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/generate-query", response_model=QueryGenerateResponse)
async def generate_query(payload: QueryGenerateRequest) -> dict:
    try:
        return nlp_service.generate_query(payload.question, payload.schema)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
