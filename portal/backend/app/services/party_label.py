"""Format call parties as ``(Description) Extension`` for API responses."""

from __future__ import annotations


def _local_part(addr: str) -> str:
    return addr.split("@", 1)[0]


def party_extension(addr: str | None) -> str | None:
    if not addr:
        return None
    local = _local_part(addr).strip()
    if not local:
        return None
    digits = "".join(c for c in local if c.isdigit())
    if len(digits) >= 3:
        if len(digits) <= 7:
            return digits
        return local if local.startswith("+") else digits
    return local


def _strip_parens(value: str) -> str:
    trimmed = value.strip()
    if trimmed.startswith("(") and trimmed.endswith(")") and trimmed.count(")") == 1:
        return trimmed[1:-1].strip()
    return trimmed


def _already_formatted(name: str) -> bool:
    text = name.strip()
    if not (text.startswith("(") and ")" in text):
        return False
    rest = text.split(")", 1)[1].strip()
    return bool(rest)


def _comparable(value: str) -> str:
    digits = "".join(c for c in value if c.isdigit())
    return digits or value.strip().lower()


def format_party(name: str | None, addr: str | None) -> str:
    raw = (name or "").strip()
    if raw and _already_formatted(raw):
        return raw
    ext = party_extension(addr)
    label = _strip_parens(raw) if raw else ""
    if label and ext:
        if _comparable(label) == _comparable(ext):
            return ext
        return f"({label}) {ext}"
    if label:
        return label
    return ext or addr or "Unknown"
