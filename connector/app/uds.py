"""Cisco Unified User Data Services (UDS) client for near-end display name lookup."""

from __future__ import annotations

import logging
import xml.etree.ElementTree as ET

import httpx

from app.config import config

logger = logging.getLogger("connector.uds")


def _local_tag(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _normalize_addr(addr: str) -> str:
    local = addr.split("@", 1)[0].strip()
    return "".join(c for c in local if c.isdigit())


def _number_last(digits: str) -> str:
    if not digits:
        return ""
    return digits if len(digits) <= 4 else digits[-4:]


def _find_text(parent: ET.Element, name: str) -> str | None:
    for child in parent.iter():
        if _local_tag(child.tag) == name:
            text = (child.text or "").strip()
            if text:
                return text
    return None


def _parse_user_name(user_el: ET.Element) -> str | None:
    display = _find_text(user_el, "displayName")
    if display:
        return display
    last = _find_text(user_el, "lastName")
    first = _find_text(user_el, "firstName")
    if last and first:
        return f"{last}, {first}"
    return last or first or None


def _parse_users(xml_text: str) -> str | None:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        logger.warning("UDS XML parse error: %s", exc)
        return None

    returned = root.get("returnedCount")
    if returned == "0":
        return None
    count_text = _find_text(root, "returnedCount")
    if count_text == "0":
        return None

    for el in root.iter():
        if _local_tag(el.tag) != "user":
            continue
        name = _parse_user_name(el)
        if name:
            return name
    return None


class UdsClient:
    def __init__(self) -> None:
        self._base = (config.UDS_BASE_URL or "").rstrip("/")
        self._verify = config.UDS_VERIFY_TLS
        self._auth = None
        if config.UDS_USER:
            self._auth = (config.UDS_USER, config.UDS_PASSWORD or "")
        self._client = httpx.Client(timeout=10.0, verify=self._verify)

    def lookup_display_name(self, near_addr: str) -> str | None:
        if not self._base:
            return None
        digits = _normalize_addr(near_addr)
        if not digits:
            return None
        numberlast = _number_last(digits)
        url = f"{self._base}/cucm-uds/users"
        params = {"numberlast": numberlast}
        try:
            return self._fetch_name(url, params)
        except Exception as exc:
            logger.warning("UDS lookup failed for %s: %s", near_addr, exc)
            return None

    def _fetch_name(self, url: str, params: dict[str, str]) -> str | None:
        r = self._client.get(url, params=params)
        if r.status_code in (401, 403) and self._auth:
            r = self._client.get(url, params=params, auth=self._auth)
        if r.status_code >= 400:
            logger.warning("UDS HTTP %s for %s", r.status_code, params)
            return None
        return _parse_users(r.text)
