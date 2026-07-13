from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from app.core.config import settings

_engine_kwargs: dict = {"echo": False}
if settings.db_pool_mode == "nullpool":
    # No pooled idle connections, so Aurora Serverless v2 can auto-pause.
    _engine_kwargs["poolclass"] = NullPool
else:
    _engine_kwargs["pool_pre_ping"] = True
    _engine_kwargs["pool_recycle"] = 300

engine = create_async_engine(settings.database_url, **_engine_kwargs)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session


async def set_tenant_context(session: AsyncSession, tenant_id: int) -> None:
    """Scope this transaction's row-level-security policies to one tenant.

    Transaction-local (`set_config(..., true)`): after a commit the connection
    reverts to system context, so pooled connections never leak the setting.
    Application queries must still filter by tenant_id explicitly — RLS is
    defense-in-depth, not the primary isolation mechanism.
    """
    from sqlalchemy import text

    await session.execute(
        text("SELECT set_config('app.tenant_id', :tid, true)"), {"tid": str(tenant_id)}
    )
