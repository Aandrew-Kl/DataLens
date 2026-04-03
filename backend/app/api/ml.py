from fastapi import APIRouter, HTTPException, status

from app.schemas.ml import (
    AnomalyRequest,
    AnomalyResponse,
    ClassifyRequest,
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
        return ml_service.regression(payload.data, payload.target, payload.features, payload.method)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/cluster", response_model=ClusterResponse)
async def run_clustering(payload: ClusterRequest) -> dict:
    try:
        return ml_service.cluster(payload.data, payload.features, payload.method, payload.n_clusters)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/classify", response_model=ClassifyResponse)
async def run_classification(payload: ClassifyRequest) -> dict:
    try:
        return ml_service.classify(payload.data, payload.target, payload.features, payload.method)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/anomaly-detect", response_model=AnomalyResponse)
async def run_anomaly_detection(payload: AnomalyRequest) -> dict:
    try:
        return ml_service.anomaly_detect(payload.data, payload.features, payload.method)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/pca", response_model=PCAResponse)
async def run_pca(payload: PCARequest) -> dict:
    try:
        return ml_service.pca(payload.data, payload.features, payload.n_components)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
