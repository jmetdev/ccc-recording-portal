#!/bin/sh
# Mix legs and notify portal on BIB hangup. Args: refci near_addr far_addr [session]
export PORTAL_API_URL="${PORTAL_API_URL:-http://127.0.0.1:8001}"
export INGEST_TOKEN="${INGEST_TOKEN:-change-me-ingest-token}"
export RECORDINGS_DIR="${RECORDINGS_DIR:-/var/lib/freeswitch/recordings}"
LOG="${RECORDINGS_DIR}/.bib-hook.log"
printf '%s hangup refci=%s near=%s far=%s session=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$3" "$4" >> "$LOG"
# Background the worker: this script is invoked via api_hangup_hook=system,
# which blocks the FS hangup thread until we return. The python hook polls
# for flushed WAVs for up to ~30s, so it must not run in the foreground.
nohup /usr/bin/python3 /usr/local/sbin/bib-hangup-hook.py --refci "$1" >/dev/null 2>&1 &
exit 0
