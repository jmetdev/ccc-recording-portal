from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, auth, calls, ingest, workers, ws
from app.core.config import settings
from app.core.database import async_session
from app.services.bootstrap import bootstrap
from app.services.call_status import repair_stuck_transcribing_calls
from app.services.transcription import init_transcription_enabled

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_transcription_enabled()
    async with async_session() as db:
        await bootstrap(db)
        repaired = await repair_stuck_transcribing_calls(db)
        if repaired:
            await db.commit()
    yield


app = FastAPI(title="Call Recording Portal API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(ingest.router, prefix="/api")
app.include_router(workers.router, prefix="/api")
app.include_router(calls.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(ws.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
