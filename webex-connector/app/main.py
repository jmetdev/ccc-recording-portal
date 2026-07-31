"""Hosted per-tenant Webex connector (DEPRECATED).

One instance of this container per tenant was an experimental webhook receiver.
WXC ingest now uses the external ``ccc-connector-webex`` poller on the VPS.
See ``ccc-connector-webex/README.md``.
"""

import hashlib
import hmac
import logging

from fastapi import FastAPI, HTTPException, Request

from app.config import config
from app.portal import PortalClient

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("webex_connector.main")

app = FastAPI(title="Hosted Webex Connector")
portal = PortalClient()


def _verify_signature(body: bytes, signature: str | None) -> bool:
    if not signature:
        return False
    expected = hmac.new(config.webhook_secret.encode(), body, hashlib.sha1).hexdigest()
    return hmac.compare_digest(expected, signature.strip())


@app.get("/healthz")
async def healthz():
    return {"status": "ok", "tenant_id": config.tenant_id}


@app.post("/t/{tenant_id}/webhook")
async def webhook(tenant_id: str, request: Request):
    # Defense-in-depth: the ALB rule already routes only this tenant's path to
    # this instance, but cross-check anyway in case of misrouting.
    if tenant_id != config.tenant_id:
        raise HTTPException(status_code=404, detail="Tenant mismatch")

    body = await request.body()
    signature = request.headers.get("x-spark-signature")
    if not _verify_signature(body, signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    payload = await request.json()
    logger.info("Received Webex event for tenant %s: %s", config.tenant_id, payload.get("resource"))
    await _fetch_and_ingest_recording(payload)
    return {"status": "ok"}


async def _fetch_and_ingest_recording(payload: dict) -> None:
    """STUB — pending live-org validation of the Webex recording-retrieval API.

    Once validated, this should: fetch the recording referenced by `payload`
    using this tenant's org token, then call portal.start/upload_media/complete
    (or .fail on error) exactly as the on-prem CUCM connector's pipeline does.
    """
    logger.warning(
        "Recording retrieval not yet implemented (pending Webex API spike) — "
        "event acknowledged but not ingested: %s",
        payload.get("data", {}).get("id"),
    )
