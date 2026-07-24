#!/bin/sh
# Notify portal on BIB call start. Args: refci near_addr far_addr [session]
export PORTAL_API_URL="${PORTAL_API_URL:-http://127.0.0.1:8001}"
export INGEST_TOKEN="${INGEST_TOKEN:-change-me-ingest-token}"
export RECORDINGS_DIR="${RECORDINGS_DIR:-/var/lib/freeswitch/recordings}"
LOG="${RECORDINGS_DIR}/.bib-hook.log"
printf '%s start refci=%s near=%s far=%s session=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$3" "$4" >> "$LOG"
START_FILE="${RECORDINGS_DIR}/.bib_start_${1}"
LOCK_FILE="${RECORDINGS_DIR}/.bib_start_${1}.lock"
(
  flock -n 9 || exit 0
  if [ ! -f "$START_FILE" ]; then
    date +%s > "$START_FILE"
  fi
  /usr/bin/python3 /usr/local/sbin/notify-recording.py start \
    --refci "$1" \
    --near-addr "$2" \
    --far-addr "$3" \
    --session "$4"
) 9>"$LOCK_FILE"
