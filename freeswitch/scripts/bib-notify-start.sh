#!/bin/sh
# Notify portal on BIB call start. Args: refci near_addr far_addr [session]
export PORTAL_API_URL="${PORTAL_API_URL:-http://127.0.0.1:8001}"
export INGEST_TOKEN="${INGEST_TOKEN:-change-me-ingest-token}"
LOG="/tmp/bib-hook.log"
printf '%s start refci=%s near=%s far=%s session=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$3" "$4" >> "$LOG"
exec /usr/bin/python3 /usr/local/sbin/notify-recording.py start \
  --refci "$1" \
  --near-addr "$2" \
  --far-addr "$3" \
  --session "$4"
