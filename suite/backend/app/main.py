import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import internal, me, platform
from app.core.config import settings

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="CloudCoreCollab Suite API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(platform.router, prefix="/api")
app.include_router(me.router, prefix="/api")
app.include_router(internal.router, prefix="/api")


@app.get("/api/health")
async def health():
    return {"status": "ok"}
