from fastapi import APIRouter

from app.api import ai, analytics, auth, bookmarks, datasets, history, ml, pipelines, ws


api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(datasets.router)
api_router.include_router(bookmarks.router)
api_router.include_router(pipelines.router)
api_router.include_router(history.router)
api_router.include_router(ml.router)
api_router.include_router(ai.router)
api_router.include_router(analytics.router)
api_router.include_router(ws.router)
