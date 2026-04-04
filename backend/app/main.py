from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.database import Base, engine
from app.logging_config import setup_logging
from app.models import analysis, dataset, user  # noqa: F401


setup_logging()
app = FastAPI(title="DataLens Backend", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix="/api")


@app.on_event("startup")
async def on_startup() -> None:
    Path("uploads").mkdir(parents=True, exist_ok=True)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


@app.get("/health")
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}
