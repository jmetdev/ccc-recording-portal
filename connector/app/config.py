"""Connector configuration (env-driven)."""

import os


class Config:
    # Cloud portal + per-tenant connector auth
    PORTAL_URL = os.environ.get("PORTAL_URL", "https://dev.cloudcorecollab.com").rstrip("/")
    CONNECTOR_TOKEN = os.environ.get("CONNECTOR_TOKEN", "")
    SOURCE = os.environ.get("CONNECTOR_SOURCE", "cucm")  # cucm | webex

    # Shared recordings volume (also mounted into the FreeSWITCH container)
    RECORDINGS_DIR = os.environ.get("RECORDINGS_DIR", "/recordings")

    # Local shim: the FreeSWITCH hook scripts POST here (v1-shaped) with this token
    LISTEN_HOST = os.environ.get("LISTEN_HOST", "0.0.0.0")
    LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "9000"))
    INGEST_TOKEN = os.environ.get("INGEST_TOKEN", "")  # shared secret with FS hooks

    # Local media pipeline + on-prem whisper sidecar
    WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")
    TRANSCRIBE = os.environ.get("TRANSCRIBE", "true").lower() == "true"
    # Shared secret between the whisper container and this connector
    WORKER_TOKEN = os.environ.get("WORKER_TOKEN", "")

    # Durable spool (survives restarts) + retry
    SPOOL_DB = os.environ.get("SPOOL_DB", "/recordings/.connector/spool.db")
    HEARTBEAT_INTERVAL_S = int(os.environ.get("HEARTBEAT_INTERVAL_S", "60"))
    RETRY_MAX_S = int(os.environ.get("RETRY_MAX_S", "300"))
    VERSION = os.environ.get("CONNECTOR_VERSION", "0.1.0")

    # Keep local WAV/M4A this many days after a confirmed upload (0 = keep forever)
    LOCAL_RETENTION_DAYS = int(os.environ.get("LOCAL_RETENTION_DAYS", "7"))


config = Config()
