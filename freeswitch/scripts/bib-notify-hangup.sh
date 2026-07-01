#!/bin/sh
# Mix legs and notify portal on BIB hangup. Args: refci near_addr far_addr [session]
export PORTAL_API_URL="${PORTAL_API_URL:-http://127.0.0.1:8001}"
export INGEST_TOKEN="${INGEST_TOKEN:-change-me-ingest-token}"
export RECORDINGS_DIR="${RECORDINGS_DIR:-/var/lib/freeswitch/recordings}"
LOG="/tmp/bib-hook.log"
printf '%s hangup refci=%s near=%s far=%s session=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$3" "$4" >> "$LOG"
/usr/bin/python3 /usr/local/sbin/notify-recording.py start \
  --refci "$1" \
  --near-addr "$2" \
  --far-addr "$3" \
  --session "$4" >> "$LOG" 2>&1 || true
exec /usr/bin/python3 /usr/local/sbin/bib-hangup-hook.py --refci "$1"
