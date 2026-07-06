from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

engine = create_async_engine(settings.database_url, echo=False)
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
