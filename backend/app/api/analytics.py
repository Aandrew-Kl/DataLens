import pandas as pd
from fastapi import APIRouter, HTTPException, status

from app.schemas.analytics import (
    ABTestResponse,
    AbTestRequest,
    ChurnPredictRequest,
    ChurnResponse,
    CohortRequest,
    CohortResponse,
    ForecastRequest,
    ForecastResponse,
)
from app.services import analytics_service

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.post("/churn-predict", response_model=ChurnResponse)
async def predict_churn(payload: ChurnPredictRequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return analytics_service.churn_predict(frame, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/cohort", response_model=CohortResponse)
async def run_cohort_analysis(payload: CohortRequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return analytics_service.cohort_analysis(frame, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/ab-test", response_model=ABTestResponse)
async def run_ab_test(payload: AbTestRequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return analytics_service.ab_test(frame, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/forecast", response_model=ForecastResponse)
async def run_forecast(payload: ForecastRequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return analytics_service.forecast(frame, payload.date_col, payload.value_col, payload.periods, payload.method)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
