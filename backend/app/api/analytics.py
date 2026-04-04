import pandas as pd
from fastapi import APIRouter, HTTPException, status

from app.api.docs import build_error_responses
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


@router.post(
    "/churn-predict",
    response_model=ChurnResponse,
    status_code=status.HTTP_200_OK,
    summary="Predict churn",
    description="Train a churn prediction model and return evaluation metrics, feature importance, and risk scores.",
    response_description="The churn prediction results.",
    responses=build_error_responses(
        bad_request="The churn prediction request could not be processed with the provided dataset or parameters.",
    ),
)
async def predict_churn(payload: ChurnPredictRequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return analytics_service.churn_predict(frame, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/cohort",
    response_model=CohortResponse,
    status_code=status.HTTP_200_OK,
    summary="Run cohort analysis",
    description="Compute retention cohorts from signup and activity dates in the provided dataset.",
    response_description="The cohort analysis results.",
    responses=build_error_responses(
        bad_request="The cohort analysis request could not be processed with the provided dataset or parameters.",
    ),
)
async def run_cohort_analysis(payload: CohortRequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return analytics_service.cohort_analysis(frame, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/ab-test",
    response_model=ABTestResponse,
    status_code=status.HTTP_200_OK,
    summary="Run an A/B test",
    description="Compare two variants for a metric and return statistical significance, effect size, and confidence intervals.",
    response_description="The A/B test results.",
    responses=build_error_responses(
        bad_request="The A/B test request could not be processed with the provided dataset or parameters.",
    ),
)
async def run_ab_test(payload: AbTestRequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return analytics_service.ab_test(frame, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/forecast",
    response_model=ForecastResponse,
    status_code=status.HTTP_200_OK,
    summary="Forecast time series values",
    description="Forecast future values for a time series and return predicted points and model metrics.",
    response_description="The forecasting results.",
    responses=build_error_responses(
        bad_request="The forecasting request could not be processed with the provided dataset or parameters.",
    ),
)
async def run_forecast(payload: ForecastRequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return analytics_service.forecast(frame, payload.date_col, payload.value_col, payload.periods, payload.method)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
