import asyncio
from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, auth, calls, ingest, ingest_v2, oauth, system, tenant, tenants, workers, ws
from app.core.config import settings
from app.core.database import async_session
from app.services.bootstrap import bootstrap
from app.services.call_status import repair_stuck_recording_calls, repair_stuck_transcribing_calls
from app.services.retention import retention_sweep_loop
from app.services.transcription import init_transcription_enabled

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_transcription_enabled()
    async with async_session() as db:
        await bootstrap(db)
        repaired = await repair_stuck_transcribing_calls(db)
        repaired += await repair_stuck_recording_calls(db)
        if repaired:
            await db.commit()
    sweep_task = asyncio.create_task(retention_sweep_loop())
    yield
    sweep_task.cancel()


app = FastAPI(title="Call Recording Portal API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(oauth.router, prefix="/api")
app.include_router(ingest.router, prefix="/api")
app.include_router(ingest_v2.router, prefix="/api")
app.include_router(tenants.router, prefix="/api")
app.include_router(tenant.router, prefix="/api")
app.include_router(workers.router, prefix="/api")
app.include_router(calls.router, prefix="/api")
app.include_router(system.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(ws.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
