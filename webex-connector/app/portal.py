"""Client for the cloud portal's v2 connector ingest API (ccck_ bearer).

Ported from connector/app/portal.py (the on-prem CUCM connector) — same ingest
contract, so the portal's Call/Recording model doesn't need a second code path
for Webex-sourced recordings.
"""

import logging

import httpx

from app.config import config

logger = logging.getLogger("webex_connector.portal")


class PortalClient:
    def __init__(self) -> None:
        self._base = f"{config.portal_url}/api/v2"
        self._headers = {"Authorization": f"Bearer {config.connector_token}"}
        self._client = httpx.Client(timeout=120.0, headers=self._headers)

    def start(self, refci: str, meta: dict) -> int:
        body = {"refci": refci, "source": "webex", **meta}
        r = self._client.post(f"{self._base}/ingest/calls/start", json=body)
        r.raise_for_status()
        return r.json()["call_id"]

    def upload_media(
        self,
        call_id: int,
        leg: str,
        content: bytes,
        filename: str,
        mime: str,
        duration_s: float | None = None,
    ) -> None:
        data: dict = {"leg": leg, "mime": mime}
        if duration_s is not None:
            data["duration_s"] = str(duration_s)
        files = {"file": (filename, content, mime)}
        r = self._client.post(f"{self._base}/ingest/calls/{call_id}/media", data=data, files=files)
        r.raise_for_status()

    def complete(self, refci: str, duration_s: float | None = None) -> None:
        body: dict = {"refci": refci, "processed": True}
        if duration_s is not None:
            body["duration_s"] = duration_s
        r = self._client.post(f"{self._base}/ingest/calls/complete", json=body)
        r.raise_for_status()

    def fail(self, refci: str, reason: str | None = None) -> None:
        body: dict = {"refci": refci}
        if reason:
            body["reason"] = reason
        r = self._client.post(f"{self._base}/ingest/calls/fail", json=body)
        r.raise_for_status()

    def heartbeat(self, stats: dict) -> None:
        body = {"version": "0.1.0", "stats": stats}
        r = self._client.post(f"{self._base}/connector/heartbeat", json=body)
        r.raise_for_status()
