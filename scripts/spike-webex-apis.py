#!/usr/bin/env python3
"""Live Webex Groups + recording-retrieval API probe (dev spike).

Reads Service App credentials from SSM (/ccc/dev/webex_serviceapp_*) and probes
the endpoints the portal backend will call. Safe to re-run; prints status only.

Usage:
  AWS_PROFILE=dev python3 scripts/spike-webex-apis.py
  AWS_PROFILE=dev python3 scripts/spike-webex-apis.py --org-id <WEBEX_ORG_ID>
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys

import httpx

API = "https://webexapis.com/v1"
SSM_PREFIX = "/ccc/dev"
PLACEHOLDERS = {"REPLACE_ME", "PLACEHOLDER_SET_ME", "REPLACE_ME_WEBEX_CLIENT_ID"}


def ssm(name: str) -> str:
    out = subprocess.check_output(
        [
            "aws",
            "ssm",
            "get-parameter",
            "--name",
            f"{SSM_PREFIX}/{name}",
            "--with-decryption",
            "--query",
            "Parameter.Value",
            "--output",
            "text",
        ],
        text=True,
    )
    return out.strip()


def creds_configured() -> bool:
    try:
        vals = [
            ssm("webex_serviceapp_id"),
            ssm("webex_serviceapp_client_id"),
            ssm("webex_serviceapp_client_secret"),
            ssm("webex_serviceapp_org_token"),
        ]
    except subprocess.CalledProcessError as exc:
        print(f"SSM read failed: {exc}", file=sys.stderr)
        return False
    bad = [v for v in vals if not v or any(p in v for p in PLACEHOLDERS)]
    if bad:
        print("Service App SSM values are still placeholders — Groups/recording spikes blocked.")
        print("Set real /ccc/dev/webex_serviceapp_* values (or copy from fax) before re-running.")
        return False
    return True


def exchange_org_token(org_id: str) -> str:
    app_id = ssm("webex_serviceapp_id")
    client_id = ssm("webex_serviceapp_client_id")
    client_secret = ssm("webex_serviceapp_client_secret")
    org_token = ssm("webex_serviceapp_org_token")
    resp = httpx.post(
        f"{API}/applications/{app_id}/token",
        headers={"Authorization": f"Bearer {org_token}"},
        json={
            "clientId": client_id,
            "clientSecret": client_secret,
            "targetOrgId": org_id,
        },
        timeout=30,
    )
    print(f"POST /applications/{{appId}}/token -> {resp.status_code}")
    if resp.status_code != 200:
        print(resp.text[:500])
        sys.exit(1)
    return resp.json()["access_token"]


def probe(name: str, method: str, path: str, token: str, **kwargs) -> None:
    url = path if path.startswith("http") else f"{API}{path}"
    resp = httpx.request(method, url, headers={"Authorization": f"Bearer {token}"}, timeout=30, **kwargs)
    print(f"\n=== {name} ===")
    print(f"{method} {path} -> {resp.status_code}")
    try:
        body = resp.json()
        print(json.dumps(body, indent=2)[:2000])
    except Exception:
        print(resp.text[:500])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--org-id", help="Target Webex org id (required when creds are real)")
    args = parser.parse_args()

    if not creds_configured():
        sys.exit(2)

    org_id = args.org_id
    if not org_id:
        print("Real creds present but --org-id not supplied; skipping org-token exchange.")
        print("Re-run with --org-id after a customer authorizes the Service App.")
        sys.exit(0)

    token = exchange_org_token(org_id)
    probe("Groups list", "GET", "/groups", token, params={"max": 5})
    # Pick first group id if any for members probe.
    groups = httpx.get(f"{API}/groups", headers={"Authorization": f"Bearer {token}"}, params={"max": 1}, timeout=30)
    if groups.status_code == 200:
        items = groups.json().get("items") or []
        if items and items[0].get("id"):
            gid = items[0]["id"]
            probe("Group members", "GET", f"/groups/{gid}/members", token, params={"max": 5})

    # Recording / compliance endpoints — document what the Service App can reach.
    for path in (
        "/recordings",
        "/compliance/recordings",
        "/meetingChats",
    ):
        probe(f"Recording probe {path}", "GET", path, token, params={"max": 1})


if __name__ == "__main__":
    main()
