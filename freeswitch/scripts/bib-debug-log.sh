#!/bin/sh
# Append NDJSON debug lines for BIB pipeline (session d3dd31).
# Usage: bib-debug-log.sh <location> <message> [json_data]
export RECORDINGS_DIR="${RECORDINGS_DIR:-/var/lib/freeswitch/recordings}"
LOG="${RECORDINGS_DIR}/.debug-d3dd31.log"
LOCATION="$1"
MESSAGE="$2"
DATA="${3:-{}}"
TS="$(date +%s000 2>/dev/null || python3 -c 'import time; print(int(time.time()*1000))')"
printf '{"sessionId":"d3dd31","timestamp":%s,"location":"%s","message":"%s","data":%s,"hypothesisId":"%s","runId":"%s"}\n' \
  "$TS" "$LOCATION" "$MESSAGE" "$DATA" "${4:-H0}" "${5:-pre-fix}" >> "$LOG"
