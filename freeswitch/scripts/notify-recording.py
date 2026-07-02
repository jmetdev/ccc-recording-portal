#!/usr/bin/env python3
"""Notify the recording portal on BIB call start/complete."""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request


RECORDINGS_DIR = os.environ.get("RECORDINGS_DIR", "/var/lib/freeswitch/recordings")


def to_rel_path(path: str) -> str:
    path = path.strip()
    if path.startswith(RECORDINGS_DIR):
        return path[len(RECORDINGS_DIR) :].lstrip("/")
    return os.path.basename(path)


def post(path: str, payload: dict) -> None:
    base = os.environ.get("PORTAL_API_URL", "http://127.0.0.1:8000")
    token = os.environ.get("INGEST_TOKEN", "")
    url = f"{base.rstrip('/')}{path}"
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "X-Ingest-Token": token},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            print(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Request failed: {e}", file=sys.stderr)
        sys.exit(1)


def cmd_start(args: argparse.Namespace) -> None:
    if args.json:
        payload = json.loads(args.json)
    else:
        payload = {}
    if args.refci:
        payload.setdefault("refci", args.refci)
    if args.near_addr:
        payload.setdefault("near_addr", args.near_addr)
    if args.far_addr:
        payload.setdefault("far_addr", args.far_addr)
    if args.session:
        payload.setdefault("session", args.session)
    if args.near_name:
        payload.setdefault("near_name", args.near_name)
    if args.far_name:
        payload.setdefault("far_name", args.far_name)
    if args.guid:
        payload.setdefault("guid", args.guid)
    post("/api/ingest/start", payload)


def cmd_complete(args: argparse.Namespace) -> None:
    files: dict[str, str] = {}
    if args.files:
        for part in args.files.split(","):
            leg, _, path = part.partition("=")
            if leg and path:
                files[leg.strip()] = to_rel_path(path.strip())
    payload = {"refci": args.refci, "files": files}
    if args.duration_s:
        payload["duration_s"] = float(args.duration_s)
    post("/api/ingest/complete", payload)


def cmd_fail(args: argparse.Namespace) -> None:
    payload = {"refci": args.refci}
    if args.reason:
        payload["reason"] = args.reason
    if args.duration_s:
        payload["duration_s"] = float(args.duration_s)
    post("/api/ingest/fail", payload)


def main() -> None:
    parser = argparse.ArgumentParser(description="Recording portal ingest hook")
    sub = parser.add_subparsers(dest="command", required=True)

    p_start = sub.add_parser("start")
    p_start.add_argument("--json", help="JSON payload with call metadata")
    p_start.add_argument("--refci")
    p_start.add_argument("--near-addr")
    p_start.add_argument("--far-addr")
    p_start.add_argument("--session")
    p_start.add_argument("--near-name")
    p_start.add_argument("--far-name")
    p_start.add_argument("--guid")
    p_start.set_defaults(func=cmd_start)

    p_complete = sub.add_parser("complete")
    p_complete.add_argument("--refci", required=True)
    p_complete.add_argument("--files", help="comma-separated leg=path pairs")
    p_complete.add_argument("--duration-s", dest="duration_s")
    p_complete.set_defaults(func=cmd_complete)

    p_fail = sub.add_parser("fail")
    p_fail.add_argument("--refci", required=True)
    p_fail.add_argument("--reason")
    p_fail.add_argument("--duration-s", dest="duration_s")
    p_fail.set_defaults(func=cmd_fail)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
