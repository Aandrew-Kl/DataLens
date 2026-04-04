import pandas as pd
from fastapi import APIRouter, HTTPException, status

from app.api.docs import build_error_responses
from app.schemas.ml import (
    AnomalyRequest,
    AnomalyResponse,
    ClassificationRequest,
    ClassifyResponse,
    ClusterRequest,
    ClusterResponse,
    DecisionTreeRequest,
    DecisionTreeResponse,
    PCARequest,
    PCAResponse,
    RegressionRequest,
    RegressionResponse,
)
from app.services import ml_service

router = APIRouter(prefix="/ml", tags=["ml"])


@router.post(
    "/regression",
    response_model=RegressionResponse,
    status_code=status.HTTP_200_OK,
    summary="Run regression analysis",
    description="Train a regression model on the provided tabular data and return model metrics and coefficients.",
    response_description="The regression analysis results.",
    responses=build_error_responses(
        bad_request="The regression request could not be processed with the provided dataset or parameters.",
    ),
)
async def run_regression(payload: RegressionRequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return ml_service.regression(frame, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/cluster",
    response_model=ClusterResponse,
    status_code=status.HTTP_200_OK,
    summary="Run clustering analysis",
    description="Cluster the provided records and return labels and clustering quality metrics.",
    response_description="The clustering analysis results.",
    responses=build_error_responses(
        bad_request="The clustering request could not be processed with the provided dataset or parameters.",
    ),
)
async def run_clustering(payload: ClusterRequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return ml_service.cluster(frame, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/classify",
    response_model=ClassifyResponse,
    status_code=status.HTTP_200_OK,
    summary="Run classification analysis",
    description="Train a classification model and return predicted class metadata and evaluation metrics.",
    response_description="The classification analysis results.",
    responses=build_error_responses(
        bad_request="The classification request could not be processed with the provided dataset or parameters.",
    ),
)
async def run_classification(payload: ClassificationRequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return ml_service.classify(frame, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/anomaly-detect",
    response_model=AnomalyResponse,
    status_code=status.HTTP_200_OK,
    summary="Detect anomalies",
    description="Detect outliers in the provided records and return anomaly labels and scores.",
    response_description="The anomaly detection results.",
    responses=build_error_responses(
        bad_request="The anomaly detection request could not be processed with the provided dataset or parameters.",
    ),
)
async def run_anomaly_detection(payload: AnomalyRequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return ml_service.anomaly_detect(frame, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/pca",
    response_model=PCAResponse,
    status_code=status.HTTP_200_OK,
    summary="Run principal component analysis",
    description="Reduce dimensionality for the provided feature set and return loadings and transformed rows.",
    response_description="The principal component analysis results.",
    responses=build_error_responses(
        bad_request="The PCA request could not be processed with the provided dataset or parameters.",
    ),
)
async def run_pca(payload: PCARequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return ml_service.pca(frame, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post(
    "/decision-tree",
    response_model=DecisionTreeResponse,
    status_code=status.HTTP_200_OK,
    summary="Run decision tree analysis",
    description="Train a decision tree model and return feature importance, metrics, and the learned tree structure.",
    response_description="The decision tree analysis results.",
    responses=build_error_responses(
        bad_request="The decision tree request could not be processed with the provided dataset or parameters.",
    ),
)
async def run_decision_tree(payload: DecisionTreeRequest) -> dict:
    try:
        frame = pd.DataFrame(payload.data)
        return ml_service.decision_tree(frame, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
