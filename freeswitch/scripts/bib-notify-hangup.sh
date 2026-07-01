#!/bin/sh
# Mix legs and notify portal on BIB hangup. Args: refci
export PORTAL_API_URL="${PORTAL_API_URL:-http://127.0.0.1:8001}"
export INGEST_TOKEN="${INGEST_TOKEN:-change-me-ingest-token}"
export RECORDINGS_DIR="${RECORDINGS_DIR:-/var/lib/freeswitch/recordings}"
LOG="$RECORDINGS_DIR/.bib-hook.log"
printf '%s hangup refci=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$LOG"
exec /usr/bin/python3 /usr/local/sbin/bib-hangup-hook.py --refci "$1"
