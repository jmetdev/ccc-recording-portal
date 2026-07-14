"""CUCM connector: a local shim the FreeSWITCH BIB hooks POST to, which then
runs the media pipeline and pushes results to the cloud portal over the v2 API.

FreeSWITCH keeps posting the same v1-shaped payloads it always has (start /
complete / fail) — only PORTAL_API_URL changes to point at this connector.
"""

from __future__ import annotations

import logging
import threading
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from app import pipeline, spool
from app.config import config
from app.portal import PortalClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("connector")

portal = PortalClient()
_stop = threading.Event()

_META_FIELDS = (
    "near_addr", "far_addr", "session", "near_name", "far_name",
    "guid", "direction", "external_id",
)


def _require_token(x_ingest_token: str | None = Header(default=None)) -> None:
    if config.INGEST_TOKEN and x_ingest_token != config.INGEST_TOKEN:
        raise HTTPException(status_code=401, detail="bad ingest token")


def _worker() -> None:
    while not _stop.is_set():
        job = spool.claim_due()
        if job is None:
            time.sleep(2)
            continue
        import json

        payload = json.loads(job["payload_json"])
        try:
            if job["kind"] == "complete":
                pipeline.process_complete(portal, job["refci"], payload["files"], payload.get("duration_s"))
            elif job["kind"] == "fail":
                pipeline.process_fail(portal, job["refci"], payload.get("reason"), payload.get("duration_s"))
            spool.mark_done(job["id"])
        except Exception:
            attempts = job["attempts"] + 1
            logger.exception("job %s (%s) failed, attempt %s", job["id"], job["kind"], attempts)
            spool.mark_retry(job["id"], attempts)


def _heartbeat() -> None:
    while not _stop.is_set():
        try:
            portal.heartbeat({"queue_depth": spool.queue_depth()})
        except Exception as exc:
            logger.warning("heartbeat failed: %s", exc)
        _stop.wait(config.HEARTBEAT_INTERVAL_S)


@asynccontextmanager
async def lifespan(app: FastAPI):
    spool.init()
    threads = [threading.Thread(target=_worker, daemon=True), threading.Thread(target=_heartbeat, daemon=True)]
    for t in threads:
        t.start()
    logger.info("connector up: portal=%s source=%s", config.PORTAL_URL, config.SOURCE)
    yield
    _stop.set()


app = FastAPI(title="ccc-connector", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "queue_depth": spool.queue_depth(), "version": config.VERSION}


class StartIn(BaseModel):
    refci: str
    model_config = {"extra": "allow"}


class CompleteIn(BaseModel):
    refci: str
    files: dict[str, str] = {}
    duration_s: float | None = None


class FailIn(BaseModel):
    refci: str
    reason: str | None = None
    duration_s: float | None = None


@app.post("/api/ingest/start", dependencies=[Depends(_require_token)])
def ingest_start(body: StartIn):
    data = body.model_dump()
    meta = {k: data[k] for k in _META_FIELDS if data.get(k) is not None}
    spool.record_start(body.refci, meta)
    # Best-effort: register the call now so it shows live in the portal. If the
    # portal is unreachable, the pipeline will (re)start it at complete time.
    try:
        spool.set_call_id(body.refci, portal.start(body.refci, meta))
    except Exception as exc:
        logger.warning("live start for %s deferred: %s", body.refci, exc)
    return {"status": "ok"}


@app.post("/api/ingest/complete", dependencies=[Depends(_require_token)])
def ingest_complete(body: CompleteIn):
    spool.enqueue("complete", body.refci, {"files": body.files, "duration_s": body.duration_s})
    return {"status": "queued"}


@app.post("/api/ingest/fail", dependencies=[Depends(_require_token)])
def ingest_fail(body: FailIn):
    spool.enqueue("fail", body.refci, {"reason": body.reason, "duration_s": body.duration_s})
    return {"status": "queued"}
