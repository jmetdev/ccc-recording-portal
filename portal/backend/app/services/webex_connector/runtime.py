"""Runtime files for portal-provisioned WXC connector containers."""

from __future__ import annotations

import json
import logging
from datetime import timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import decrypt_secret
from app.models import ConnectorCredential, ConnectorKind, WebexServiceAuth
from app.services import webex_serviceapp as wx

logger = logging.getLogger(__name__)

CONNECTOR_TOKEN_FILE = "connector_token"
TOKENS_FILE = "tokens.json"


def tenant_data_path(tenant_id: int) -> Path:
    base = Path(settings.webex_connector_data_path)
    path = base / f"t{tenant_id}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def tenant_data_host_path(tenant_id: int) -> str | None:
    if not settings.webex_connector_data_host_path:
        return None
    path = Path(settings.webex_connector_data_host_path) / f"t{tenant_id}"
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


async def write_tokens_file(
    db: AsyncSession, tenant_id: int, auth: WebexServiceAuth
) -> None:
    """Write the developer-portal access and refresh tokens for the poller.

    Does not call Webex and does not mint a new access token.
    """
    del db
    if not auth.access_token_encrypted or not auth.refresh_token_encrypted:
        raise RuntimeError(
            "Paste the developer-portal access token and refresh token before starting the connector"
        )

    payload: dict[str, str] = {}
    if auth.refresh_token_encrypted:
        payload["refresh_token"] = decrypt_secret(auth.refresh_token_encrypted)
    if auth.access_token_encrypted:
        payload["access_token"] = decrypt_secret(auth.access_token_encrypted)
    if auth.access_expires_at is not None:
        expires_at = auth.access_expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        payload["expires_at"] = expires_at.isoformat()

    dest = tenant_data_path(tenant_id) / TOKENS_FILE
    dest.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    logger.info("Wrote WXC tokens for tenant %s to %s", tenant_id, dest)


async def ensure_connector_credential(
    db: AsyncSession, tenant_id: int
) -> tuple[ConnectorCredential, str]:
    """Return an enabled webex connector credential and its bearer token."""
    from app.core.security import generate_connector_token

    data_dir = tenant_data_path(tenant_id)
    token_path = data_dir / CONNECTOR_TOKEN_FILE

    cred = (
        await db.execute(
            select(ConnectorCredential)
            .where(
                ConnectorCredential.tenant_id == tenant_id,
                ConnectorCredential.kind == ConnectorKind.WEBEX,
                ConnectorCredential.enabled.is_(True),
            )
            .order_by(ConnectorCredential.id.desc())
        )
    ).scalars().first()

    if cred is not None and token_path.exists():
        token = token_path.read_text(encoding="utf-8").strip()
        if token:
            return cred, token

    token, token_hash = generate_connector_token()
    if cred is None:
        cred = ConnectorCredential(
            tenant_id=tenant_id,
            name="wxc-connector",
            kind=ConnectorKind.WEBEX,
            token_hash=token_hash,
        )
        db.add(cred)
    else:
        cred.token_hash = token_hash
        cred.enabled = True
    await db.flush()
    token_path.write_text(token, encoding="utf-8")
    return cred, token


async def prepare_tenant_runtime(db: AsyncSession, tenant_id: int) -> tuple[ConnectorCredential, str]:
    auth = await wx.get_auth(db, tenant_id)
    if auth is None or auth.status != "authorized":
        raise RuntimeError("Webex Service App is not authorized for this tenant")
    cred, token = await ensure_connector_credential(db, tenant_id)
    await write_tokens_file(db, tenant_id, auth)
    return cred, token
