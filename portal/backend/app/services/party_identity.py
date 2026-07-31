"""Shared helpers for near-party identity (DN vs email)."""


def normalize_email(addr: str | None) -> str | None:
    if not addr or "@" not in addr:
        return None
    return addr.strip().lower()


def looks_like_email(addr: str | None) -> bool:
    email = normalize_email(addr)
    if not email:
        return False
    local, _, domain = email.partition("@")
    return bool(local and domain and "." in domain)
