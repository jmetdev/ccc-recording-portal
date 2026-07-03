#!/bin/sh
# Notify portal on BIB call start. Args: refci near_addr far_addr [session]
export PORTAL_API_URL="${PORTAL_API_URL:-http://127.0.0.1:8001}"
export INGEST_TOKEN="${INGEST_TOKEN:-change-me-ingest-token}"
export RECORDINGS_DIR="${RECORDINGS_DIR:-/var/lib/freeswitch/recordings}"
LOG="${RECORDINGS_DIR}/.bib-hook.log"
# #region agent log
/usr/local/sbin/bib-debug-log.sh "bib-notify-start.sh" "start hook invoked" "{\"refci\":\"$1\",\"near\":\"$2\",\"far\":\"$3\",\"session\":\"$4\",\"pid\":$$}" "H1" "post-fix2"
# #endregion
printf '%s start refci=%s near=%s far=%s session=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$3" "$4" >> "$LOG"
START_FILE="${RECORDINGS_DIR}/.bib_start_${1}"
if [ ! -f "$START_FILE" ]; then
  date +%s > "$START_FILE"
fi
exec /usr/bin/python3 /usr/local/sbin/notify-recording.py start \
  --refci "$1" \
  --near-addr "$2" \
  --far-addr "$3" \
  --session "$4"
