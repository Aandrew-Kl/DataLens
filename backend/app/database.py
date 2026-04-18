from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import StaticPool

from app.config import settings


engine_options: dict[str, object] = {"future": True, "echo": False}
if settings.DATABASE_URL.startswith("postgresql"):
    engine_options.update(pool_size=20, max_overflow=40, pool_recycle=3600)
elif settings.DATABASE_URL.startswith("sqlite+aiosqlite:///:memory:"):
    engine_options.update(poolclass=StaticPool)

engine = create_async_engine(settings.DATABASE_URL, **engine_options)
AsyncSessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
