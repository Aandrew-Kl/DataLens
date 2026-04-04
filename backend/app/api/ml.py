import pandas as pd
from fastapi import APIRouter, HTTPException, status

from app.schemas.ml import (
    AnomalyRequest,
    AnomalyResponse,
    ClassificationRequest,
    ClassifyResponse,
    ClusterRequest,
    ClusterResponse,
    PCARequest,
    PCAResponse,
    RegressionRequest,
    RegressionResponse,
)
from app.services import ml_service

router = APIRouter(prefix="/ml", tags=["ml"])


@router.post("/regression", response_model=RegressionResponse)
async def run_regression(payload: RegressionRequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return ml_service.regression(frame, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/cluster", response_model=ClusterResponse)
async def run_clustering(payload: ClusterRequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return ml_service.cluster(frame, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/classify", response_model=ClassifyResponse)
async def run_classification(payload: ClassificationRequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return ml_service.classify(frame, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/anomaly-detect", response_model=AnomalyResponse)
async def run_anomaly_detection(payload: AnomalyRequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return ml_service.anomaly_detect(frame, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/pca", response_model=PCAResponse)
async def run_pca(payload: PCARequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return ml_service.pca(frame, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
