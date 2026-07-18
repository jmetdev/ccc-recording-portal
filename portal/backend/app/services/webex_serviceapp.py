"""Webex Service App integration: per-org tokens and admin-detection calls.

The Service App is registered once (docs/webex-service-app.md). A customer's
full admin authorizes it in Control Hub; Webex fires our authorization
webhook with the orgId, we exchange for the org's token pair via
POST /applications/{appId}/token (authenticated with our own org's
spark:application token), and store the pair Fernet-encrypted per tenant.

Ported from cloudcorefax's services/webex_serviceapp.py; the fax-specific
provisioning primitives (workspaces/devices/numbers) are intentionally not
included here — this product's Service App use is auth/admin-detection plus,
later, group-membership reads and the hosted per-tenant connector.
"""

import hashlib
import hmac
import logging
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import decrypt_secret, encrypt_secret
from app.models import WebexServiceAuth

logger = logging.getLogger(__name__)

API = "https://webexapis.com/v1"
PLACEHOLDER = "REPLACE_ME"


def serviceapp_enabled() -> bool:
    vals = [
        settings.webex_serviceapp_id,
        settings.webex_serviceapp_client_id,
        settings.webex_serviceapp_client_secret,
    ]
    return all(v and PLACEHOLDER not in v for v in vals)


# ---- webhook signature -------------------------------------------------------
def verify_webhook_signature(body: bytes, signature: str | None) -> bool:
    """Webex signs webhook bodies with HMAC-SHA1 of the shared secret."""
    secret = settings.webex_serviceapp_webhook_secret
    if not secret or PLACEHOLDER in secret:
        logger.warning("Service App webhook secret not configured; rejecting webhook")
        return False
    if not signature:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha1).hexdigest()
    return hmac.compare_digest(expected, signature.strip())


# ---- token management --------------------------------------------------------
async def fetch_org_token_pair(org_id: str) -> dict:
    """Exchange for a customer's org token pair after authorization.

    POST /applications/{appId}/token with our org's spark:application token.
    Returns {access_token, refresh_token, expires_in, ...}.
    """
    url = f"{API}/applications/{settings.webex_serviceapp_id}/token"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            url,
            headers={"Authorization": f"Bearer {settings.webex_serviceapp_org_token}"},
            json={
                "clientId": settings.webex_serviceapp_client_id,
                "clientSecret": settings.webex_serviceapp_client_secret,
                "targetOrgId": org_id,
            },
        )
    if resp.status_code != 200:
        raise RuntimeError(
            f"Service App token exchange failed for org {org_id}: "
            f"{resp.status_code} {resp.text[:300]}"
        )
    return resp.json()


def store_token_pair(auth: WebexServiceAuth, pair: dict) -> None:
    access = pair.get("access_token")
    refresh = pair.get("refresh_token")
    if access:
        auth.access_token_encrypted = encrypt_secret(access)
        expires_in = int(pair.get("expires_in") or 3600)
        auth.access_expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
    if refresh:
        auth.refresh_token_encrypted = encrypt_secret(refresh)


async def _refresh_access_token(auth: WebexServiceAuth) -> str:
    refresh = decrypt_secret(auth.refresh_token_encrypted)
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{API}/access_token",
            data={
                "grant_type": "refresh_token",
                "client_id": settings.webex_serviceapp_client_id,
                "client_secret": settings.webex_serviceapp_client_secret,
                "refresh_token": refresh,
            },
        )
    if resp.status_code != 200:
        auth.status = "error"
        raise RuntimeError(f"Service App token refresh failed: {resp.status_code} {resp.text[:300]}")
    store_token_pair(auth, resp.json())
    auth.status = "authorized"
    return decrypt_secret(auth.access_token_encrypted)


async def get_auth(db: AsyncSession, tenant_id: int) -> WebexServiceAuth | None:
    return (
        await db.execute(select(WebexServiceAuth).where(WebexServiceAuth.tenant_id == tenant_id))
    ).scalar_one_or_none()


async def get_org_token(db: AsyncSession, tenant_id: int) -> str:
    """Valid access token for the tenant's org, refreshing when near expiry.

    Persists refreshed tokens (commits) so concurrent workers reuse them.
    """
    auth = await get_auth(db, tenant_id)
    if auth is None or auth.status == "deauthorized" or not auth.refresh_token_encrypted:
        raise HTTPException(
            status_code=409,
            detail="The Webex Service App is not authorized for this organization yet",
        )
    now = datetime.now(timezone.utc)
    if (
        auth.access_token_encrypted
        and auth.access_expires_at
        and auth.access_expires_at > now + timedelta(minutes=5)
    ):
        return decrypt_secret(auth.access_token_encrypted)
    token = await _refresh_access_token(auth)
    await db.commit()
    return token


# ---- Webex API client --------------------------------------------------------
async def _request(token: str, method: str, path: str, *, retries: int = 2, **kwargs) -> httpx.Response:
    """One Webex API call with simple 429 retry. Raises HTTPException on error."""
    url = path if path.startswith("http") else f"{API}{path}"
    async with httpx.AsyncClient(timeout=30) as client:
        for attempt in range(retries + 1):
            resp = await client.request(
                method, url, headers={"Authorization": f"Bearer {token}"}, **kwargs
            )
            if resp.status_code == 429 and attempt < retries:
                import asyncio

                wait = int(resp.headers.get("Retry-After", "2"))
                await asyncio.sleep(min(wait, 15))
                continue
            break
    if resp.status_code >= 400:
        detail = resp.text[:300]
        logger.warning("Webex API %s %s -> %s: %s", method, path, resp.status_code, detail)
        raise HTTPException(status_code=502, detail=f"Webex API error {resp.status_code}: {detail}")
    return resp


async def _paginate(token: str, path: str, params: dict | None = None, key: str = "items") -> list[dict]:
    items: list[dict] = []
    url = path
    while url:
        resp = await _request(token, "GET", url, params=params if url == path else None)
        items.extend(resp.json().get(key, []))
        # RFC5988 Link header pagination.
        url = resp.links.get("next", {}).get("url")
    return items


async def person_is_org_admin(token: str, email: str) -> bool:
    """Does this email hold Webex admin roles in the org? (spark-admin:people_read)"""
    resp = await _request(token, "GET", "/people", params={"email": email, "max": 1})
    people = resp.json().get("items", [])
    if not people:
        return False
    return bool(people[0].get("roles"))


# ---- Control Hub group reads (Phase F) --------------------------------------
# UNVALIDATED: the exact Webex Groups API path/response shape and the scope it
# requires have not been confirmed against a live org (see docs/webex-service-
# app.md's scope table). These two functions are written defensively against
# the endpoint shape Webex's admin API docs describe today, but must be
# verified — and the scope list updated — before relying on them in production.


async def list_org_groups(token: str) -> list[dict]:
    """Control Hub groups in this org. Returns [{id, name}]."""
    items = await _paginate(token, "/groups")
    return [{"id": g.get("id"), "name": g.get("displayName") or g.get("name")} for g in items]


async def list_group_members(token: str, group_id: str) -> list[str]:
    """Emails of the group's current members."""
    resp = await _request(token, "GET", f"/groups/{group_id}/members", params={"max": 500})
    members = resp.json().get("members", []) or resp.json().get("items", [])
    return [m.get("email") for m in members if m.get("email")]
