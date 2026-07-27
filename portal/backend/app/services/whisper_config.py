"""Tenant whisper / transcription settings stored in ``tenants.settings_json``."""

from __future__ import annotations

from typing import Any

from app.models import Tenant

_WHISPER_KEY = "whisper"
_MAX_HOTWORDS = 64
_MAX_HOTWORD_LEN = 64
_MAX_ORG_LEN = 256


def _clean_hotwords(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        items = [p.strip() for p in raw.replace(",", " ").split()]
    elif isinstance(raw, list):
        items = [str(p).strip() for p in raw]
    else:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in items:
        if not item or len(item) > _MAX_HOTWORD_LEN:
            continue
        key = item.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
        if len(out) >= _MAX_HOTWORDS:
            break
    return out


def get_transcription_settings(tenant: Tenant) -> dict[str, Any]:
    raw = ((tenant.settings_json or {}).get(_WHISPER_KEY) or {}) if tenant else {}
    org = str(raw.get("organization_name") or "").strip()[:_MAX_ORG_LEN]
    hotwords = _clean_hotwords(raw.get("hotwords"))
    return {
        "organization_name": org,
        "hotwords": hotwords,
    }


def whisper_runtime_options(tenant: Tenant) -> dict[str, str | None]:
    """Options passed to faster-whisper ``transcribe()``."""
    cfg = get_transcription_settings(tenant)
    org = cfg["organization_name"]
    hotwords = cfg["hotwords"]
    return {
        "initial_prompt": org or None,
        "hotwords": " ".join(hotwords) if hotwords else None,
    }


def set_transcription_settings(
    tenant: Tenant,
    *,
    organization_name: str | None = None,
    hotwords: list[str] | None = None,
) -> dict[str, Any]:
    current = get_transcription_settings(tenant)
    if organization_name is not None:
        current["organization_name"] = organization_name.strip()[:_MAX_ORG_LEN]
    if hotwords is not None:
        current["hotwords"] = _clean_hotwords(hotwords)
    settings = dict(tenant.settings_json or {})
    settings[_WHISPER_KEY] = {
        "organization_name": current["organization_name"],
        "hotwords": current["hotwords"],
    }
    tenant.settings_json = settings
    return current
