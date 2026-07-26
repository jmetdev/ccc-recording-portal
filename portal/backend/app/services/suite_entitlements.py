"""Read recording entitlements from the suite internal API."""

import httpx

from app.core.config import settings


async def fetch_suite_tenant_by_org(org_id: str) -> dict | None:
    if not settings.suite_api_url or not settings.suite_internal_token:
        return None
    url = f"{settings.suite_api_url.rstrip('/')}/api/internal/tenants/by-org/{org_id}"
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(url, headers={"x-internal-token": settings.suite_internal_token})
    except httpx.HTTPError:
        return None
    if resp.status_code != 200:
        return None
    return resp.json()


def recording_seats_from_entitlements(entitlements: list | None) -> int | None:
    if not entitlements:
        return None
    for item in entitlements:
        if item.get("app") != "recording":
            continue
        limits = item.get("limits_json") or {}
        seats = limits.get("recording_seats")
        if seats is not None:
            return int(seats)
    return None


async def recording_seats_for_org(org_id: str | None) -> int | None:
    if not org_id:
        return None
    suite_tenant = await fetch_suite_tenant_by_org(org_id)
    if not suite_tenant:
        return None
    return recording_seats_from_entitlements(suite_tenant.get("entitlements"))
