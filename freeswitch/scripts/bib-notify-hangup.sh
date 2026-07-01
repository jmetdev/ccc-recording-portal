#!/bin/sh
# Mix legs and notify portal on BIB hangup. Args: refci near_addr far_addr [session]
export PORTAL_API_URL="${PORTAL_API_URL:-http://127.0.0.1:8001}"
export INGEST_TOKEN="${INGEST_TOKEN:-change-me-ingest-token}"
export RECORDINGS_DIR="${RECORDINGS_DIR:-/var/lib/freeswitch/recordings}"
LOG="${RECORDINGS_DIR}/.bib-hook.log"
# #region agent log
/usr/local/sbin/bib-debug-log.sh "bib-notify-hangup.sh" "hangup hook invoked" "{\"refci\":\"$1\",\"near\":\"$2\",\"far\":\"$3\",\"session\":\"$4\",\"pid\":$$}" "H2" "post-fix"
# #endregion
printf '%s hangup refci=%s near=%s far=%s session=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$3" "$4" >> "$LOG"
exec /usr/bin/python3 /usr/local/sbin/bib-hangup-hook.py --refci "$1"
