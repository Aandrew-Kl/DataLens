from fastapi import APIRouter

from app.api import ai, analytics, auth, datasets, ml


api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(datasets.router)
api_router.include_router(ml.router)
api_router.include_router(ai.router)
api_router.include_router(analytics.router)
