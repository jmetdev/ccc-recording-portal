"""Client for the cloud portal's v2 connector ingest API (ccck_ bearer)."""

from __future__ import annotations

import json
import logging

import httpx

from app.config import config

logger = logging.getLogger("connector.portal")


class PortalClient:
    def __init__(self) -> None:
        self._base = f"{config.PORTAL_URL}/api/v2"
        self._headers = {"Authorization": f"Bearer {config.CONNECTOR_TOKEN}"}
        self._client = httpx.Client(timeout=120.0, headers=self._headers)

    def start(self, refci: str, meta: dict) -> int:
        body = {"refci": refci, "source": config.SOURCE, **meta}
        r = self._client.post(f"{self._base}/ingest/calls/start", json=body)
        r.raise_for_status()
        return r.json()["call_id"]

    def upload_media(
        self,
        call_id: int,
        leg: str,
        file_path: str,
        mime: str,
        duration_s: float | None,
        sample_rate: int | None,
        channels: int | None,
        peaks: dict | None,
    ) -> None:
        data = {"leg": leg, "mime": mime}
        if duration_s is not None:
            data["duration_s"] = str(duration_s)
        if sample_rate is not None:
            data["sample_rate"] = str(sample_rate)
        if channels is not None:
            data["channels"] = str(channels)
        if peaks is not None:
            data["peaks"] = json.dumps(peaks)
        with open(file_path, "rb") as fh:
            files = {"file": (file_path.rsplit("/", 1)[-1], fh, mime)}
            r = self._client.post(
                f"{self._base}/ingest/calls/{call_id}/media", data=data, files=files
            )
        r.raise_for_status()

    def create_transcript(
        self,
        call_id: int,
        leg: str,
        text: str,
        segments: list,
        language: str | None,
        sentiment: str | None,
        sentiment_score: float | None,
    ) -> None:
        body = {
            "leg": leg,
            "source": "whisper",  # connector runs faster-whisper locally
            "language": language,
            "text": text,
            "segments_json": segments,
            "sentiment": sentiment,
            "sentiment_score": sentiment_score,
        }
        r = self._client.post(f"{self._base}/ingest/calls/{call_id}/transcript", json=body)
        r.raise_for_status()

    def complete(self, refci: str, duration_s: float | None) -> None:
        body = {"refci": refci, "processed": True}
        if duration_s is not None:
            body["duration_s"] = duration_s
        r = self._client.post(f"{self._base}/ingest/calls/complete", json=body)
        r.raise_for_status()

    def fail(self, refci: str, reason: str | None, duration_s: float | None) -> None:
        body: dict = {"refci": refci}
        if reason:
            body["reason"] = reason
        if duration_s is not None:
            body["duration_s"] = duration_s
        r = self._client.post(f"{self._base}/ingest/calls/fail", json=body)
        r.raise_for_status()

    def heartbeat(self, stats: dict) -> None:
        body = {"version": config.VERSION, "stats": stats}
        r = self._client.post(f"{self._base}/connector/heartbeat", json=body)
        r.raise_for_status()
