"""Keycloak Admin REST client for provisioning portal users into the realm.

Creates/updates users in the shared ``ccc`` realm so they can sign in via:
  - Webex IdP (Continue with Webex → kc_idp_hint=webex), and/or
  - Keycloak username/password (local account / break-glass style).
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class KeycloakAdminError(RuntimeError):
    pass


def keycloak_admin_configured() -> bool:
    return bool(
        settings.keycloak_url.strip()
        and settings.keycloak_admin.strip()
        and settings.keycloak_admin_password.strip()
    )


async def _token(client: httpx.AsyncClient) -> str:
    base = settings.keycloak_url.rstrip("/")
    resp = await client.post(
        f"{base}/realms/master/protocol/openid-connect/token",
        data={
            "client_id": "admin-cli",
            "username": settings.keycloak_admin,
            "password": settings.keycloak_admin_password,
            "grant_type": "password",
        },
    )
    if resp.status_code != 200:
        raise KeycloakAdminError(f"Keycloak admin token failed: {resp.status_code} {resp.text[:200]}")
    return resp.json()["access_token"]


def _realm_users_url() -> str:
    return f"{settings.keycloak_url.rstrip('/')}/admin/realms/{settings.keycloak_realm}/users"


async def find_user_id(client: httpx.AsyncClient, token: str, *, username: str) -> str | None:
    resp = await client.get(
        _realm_users_url(),
        params={"username": username, "exact": "true"},
        headers={"Authorization": f"Bearer {token}"},
    )
    if resp.status_code != 200:
        raise KeycloakAdminError(f"Keycloak user lookup failed: {resp.status_code} {resp.text[:200]}")
    rows = resp.json()
    if not rows:
        return None
    return rows[0].get("id")


async def upsert_user(
    *,
    username: str,
    email: str,
    password: str | None,
    enabled: bool = True,
    attributes: dict[str, list[str]] | None = None,
) -> str:
    """Create or update a Keycloak user; optionally set a permanent password.

    Returns the Keycloak user id.
    """
    if not keycloak_admin_configured():
        raise KeycloakAdminError("Keycloak admin is not configured on this deployment")

    body: dict[str, Any] = {
        "username": username,
        "email": email,
        "emailVerified": True,
        "enabled": enabled,
        "requiredActions": [],
    }
    if attributes:
        body["attributes"] = attributes

    async with httpx.AsyncClient(timeout=30.0) as client:
        token = await _token(client)
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        user_id = await find_user_id(client, token, username=username)
        if user_id:
            resp = await client.put(f"{_realm_users_url()}/{user_id}", headers=headers, json=body)
            if resp.status_code not in (204, 200):
                raise KeycloakAdminError(f"Keycloak user update failed: {resp.status_code} {resp.text[:200]}")
        else:
            resp = await client.post(_realm_users_url(), headers=headers, json=body)
            if resp.status_code not in (201, 204):
                raise KeycloakAdminError(f"Keycloak user create failed: {resp.status_code} {resp.text[:200]}")
            user_id = await find_user_id(client, token, username=username)
            if not user_id:
                raise KeycloakAdminError("Keycloak user create succeeded but user id was not found")

        if password:
            pw_resp = await client.put(
                f"{_realm_users_url()}/{user_id}/reset-password",
                headers=headers,
                json={"type": "password", "value": password, "temporary": False},
            )
            if pw_resp.status_code not in (204, 200):
                raise KeycloakAdminError(
                    f"Keycloak password set failed: {pw_resp.status_code} {pw_resp.text[:200]}"
                )
        return user_id


async def delete_user(*, username: str) -> None:
    if not keycloak_admin_configured():
        return
    async with httpx.AsyncClient(timeout=30.0) as client:
        token = await _token(client)
        user_id = await find_user_id(client, token, username=username)
        if not user_id:
            return
        resp = await client.delete(
            f"{_realm_users_url()}/{user_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code not in (204, 200, 404):
            logger.warning("Keycloak user delete failed for %s: %s", username, resp.status_code)
