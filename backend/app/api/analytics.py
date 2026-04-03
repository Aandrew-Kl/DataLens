from fastapi import APIRouter, HTTPException, status

from app.schemas.analytics import (
    ABTestRequest,
    ABTestResponse,
    ChurnRequest,
    ChurnResponse,
    CohortRequest,
    CohortResponse,
    ForecastRequest,
    ForecastResponse,
)
from app.services import analytics_service


router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.post("/churn-predict", response_model=ChurnResponse)
async def predict_churn(payload: ChurnRequest) -> dict:
    try:
        return analytics_service.churn_predict(payload.data, payload.features)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/cohort", response_model=CohortResponse)
async def run_cohort_analysis(payload: CohortRequest) -> dict:
    try:
        return analytics_service.cohort_analysis(payload.data, payload.date_col, payload.user_col)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/ab-test", response_model=ABTestResponse)
async def run_ab_test(payload: ABTestRequest) -> dict:
    try:
        return analytics_service.ab_test(payload.control, payload.treatment, payload.alpha)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/forecast", response_model=ForecastResponse)
async def run_forecast(payload: ForecastRequest) -> dict:
    try:
        return analytics_service.forecast(payload.data, payload.date_col, payload.value_col, payload.periods)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
