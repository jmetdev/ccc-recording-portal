#!/usr/bin/env bash
#
# CCC connector installer. Run on the on-prem host next to your CUCM cluster:
#
#   curl -fsSL https://raw.githubusercontent.com/jmetdev/ccc-recording-portal/main/connector/install.sh \
#     | sudo bash -s -- --token ccck_XXXX --portal https://recorddev.cloudcorecollab.com \
#       --cucm-nodes 172.25.100.10,172.25.100.11,172.25.100.30
#
# Installs Docker-CE, lays out the mount dirs, downloads the connector bundle,
# renders FreeSWITCH ACL + BIB dialplan from --cucm-nodes, writes .env
# (including transcription config), and starts FreeSWITCH + connector + whisper.
# Re-running upgrades in place.
#
# Architecture: the FreeSWITCH container stays the shared GHCR image
# (ccc-freeswitch-docker). CUCM BIB dialplan + hooks are bind-mounted from
# this install — no separate BIB image/repo required. Transcription runs in a
# dedicated whisper sidecar (compose profile ``transcription``).

set -euo pipefail

TOKEN=""
PORTAL="https://dev.cloudcorecollab.com"
CUCM_NODES=""
DATA_DIR="/opt/ccc-connector"
WHISPER_MODEL="base"
TRANSCRIBE="true"
REPO_REF="main"

while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2;;
    --portal) PORTAL="$2"; shift 2;;
    --cucm-nodes) CUCM_NODES="$2"; shift 2;;
    --data-dir) DATA_DIR="$2"; shift 2;;
    --whisper-model) WHISPER_MODEL="$2"; shift 2;;
    --no-transcribe) TRANSCRIBE="false"; shift;;
    --ref) REPO_REF="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

[ -n "$TOKEN" ] || { echo "ERROR: --token is required (create one in the portal: Settings -> Connectors)"; exit 2; }
[ -n "$CUCM_NODES" ] || { echo "ERROR: --cucm-nodes is required (comma-separated CUCM node IPs, e.g. 10.0.0.10,10.0.0.11)"; exit 2; }
[ "$(id -u)" = "0" ] || { echo "ERROR: run as root (curl ... | sudo bash -s -- ...)"; exit 2; }

log() { echo -e "\033[1;36m[ccc]\033[0m $*"; }

CUCM_NODE_LIST=()

# Parse --cucm-nodes into CUCM_NODE_LIST (validated IPv4 addresses).
parse_cucm_nodes() {
  local raw="$1"
  CUCM_NODE_LIST=()
  local ip
  IFS=',' read -ra RAW_NODES <<< "$raw"
  for ip in "${RAW_NODES[@]}"; do
    ip="$(echo "$ip" | xargs)"
    [ -n "$ip" ] || continue
    if ! [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
      echo "ERROR: invalid CUCM node IP: $ip" >&2
      exit 2
    fi
    CUCM_NODE_LIST+=("$ip")
  done
  if [ "${#CUCM_NODE_LIST[@]}" -eq 0 ]; then
    echo "ERROR: --cucm-nodes produced no valid IPs" >&2
    exit 2
  fi
}

# Build a FreeSWITCH dialplan regex that matches any of the node IPs exactly.
# Example: ^(172\.25\.100\.10|172\.25\.100\.11)$
cucm_src_regex() {
  local parts=()
  local ip escaped
  for ip in "${CUCM_NODE_LIST[@]}"; do
    escaped="${ip//./\\.}"
    parts+=("$escaped")
  done
  local IFS='|'
  printf '^(%s)$' "${parts[*]}"
}

write_acl_conf() {
  local out="$1"
  {
    echo '<configuration name="acl.conf" description="Network ACL">'
    echo '  <network-lists>'
    echo '    <list name="cucm" default="deny">'
    for ip in "${CUCM_NODE_LIST[@]}"; do
      echo "      <node type=\"allow\" cidr=\"$ip/32\"/>"
    done
    echo '    </list>'
    echo '  </network-lists>'
    echo '</configuration>'
  } > "$out"
}

# Render cucm_bib.xml from the template by substituting __CUCM_SRC_REGEX__.
write_cucm_bib_dialplan() {
  local template="$1"
  local out="$2"
  local regex
  regex="$(cucm_src_regex)"
  [ -f "$template" ] || { echo "ERROR: missing BIB dialplan template: $template" >&2; exit 2; }
  python3 - "$template" "$out" "$regex" <<'PY'
import sys
from pathlib import Path
template, out, regex = sys.argv[1], sys.argv[2], sys.argv[3]
text = Path(template).read_text(encoding="utf-8")
if "__CUCM_SRC_REGEX__" not in text:
    raise SystemExit("template missing __CUCM_SRC_REGEX__ placeholder")
Path(out).write_text(text.replace("__CUCM_SRC_REGEX__", regex), encoding="utf-8")
PY
}

parse_cucm_nodes "$CUCM_NODES"
log "CUCM nodes: ${CUCM_NODE_LIST[*]}"

# 1) Docker-CE ---------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "installing Docker-CE ..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker || true
fi
docker compose version >/dev/null 2>&1 || { echo "ERROR: 'docker compose' plugin not available"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 is required to render the BIB dialplan"; exit 1; }

# 2) Mount layout ------------------------------------------------------------
log "creating mount layout under $DATA_DIR ..."
mkdir -p "$DATA_DIR/recordings" "$DATA_DIR/freeswitch/dialplan" "$DATA_DIR/freeswitch/scripts" "$DATA_DIR/src"

# Preserve INGEST_TOKEN / WORKER_TOKEN across reinstalls (before we replace src/).
PREV_INGEST=""
PREV_WORKER=""
if [ -f "$DATA_DIR/.env.ingest" ]; then
  PREV_INGEST="$(tr -d '[:space:]' < "$DATA_DIR/.env.ingest")"
elif [ -f "$DATA_DIR/src/.env" ]; then
  PREV_INGEST="$(grep -E '^INGEST_TOKEN=' "$DATA_DIR/src/.env" | cut -d= -f2- | tr -d '[:space:]' || true)"
fi
if [ -f "$DATA_DIR/src/.env" ]; then
  PREV_WORKER="$(grep -E '^WORKER_TOKEN=' "$DATA_DIR/src/.env" | cut -d= -f2- | tr -d '[:space:]' || true)"
fi

# 3) Download the connector bundle (public repo) -----------------------------
log "downloading connector bundle ($REPO_REF) ..."
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
curl -fsSL "https://github.com/jmetdev/ccc-recording-portal/archive/refs/heads/${REPO_REF}.tar.gz" \
  | tar xz -C "$TMP"
BUNDLE="$TMP/ccc-recording-portal-${REPO_REF}"
rm -rf "$DATA_DIR/src"
cp -r "$BUNDLE/connector" "$DATA_DIR/src"

# 4) Render FreeSWITCH ACL + BIB dialplan from --cucm-nodes ------------------
# The GHCR FreeSWITCH image is the shared trunk build (no baked BIB). Compose
# bind-mounts these generated files plus the hook scripts.
log "writing FreeSWITCH CUCM ACL + BIB dialplan from --cucm-nodes ..."
write_acl_conf "$DATA_DIR/freeswitch/acl.conf.xml"
write_cucm_bib_dialplan \
  "$BUNDLE/freeswitch/dialplan/cucm_bib.xml.template" \
  "$DATA_DIR/freeswitch/dialplan/cucm_bib.xml"
log "vendoring FreeSWITCH BIB hook scripts ..."
cp -r "$BUNDLE/freeswitch/scripts/." "$DATA_DIR/freeswitch/scripts/"
chmod +x "$DATA_DIR/freeswitch/scripts/"*.sh "$DATA_DIR/freeswitch/scripts/"*.py 2>/dev/null || true
rm -f "$DATA_DIR/freeswitch/scripts/bib-debug-log.sh"

# 5) .env (token + transcription config) ------------------------------------
log "writing connector environment ..."
if [ -n "$PREV_INGEST" ]; then
  INGEST_TOKEN="$PREV_INGEST"
else
  INGEST_TOKEN="$(openssl rand -hex 24 2>/dev/null || head -c48 /dev/urandom | base64 | tr -dc 'a-f0-9' | head -c48)"
fi
if [ -n "$PREV_WORKER" ]; then
  WORKER_TOKEN="$PREV_WORKER"
else
  WORKER_TOKEN="$INGEST_TOKEN"
fi
printf '%s\n' "$INGEST_TOKEN" > "$DATA_DIR/.env.ingest"
chmod 600 "$DATA_DIR/.env.ingest"
cat > "$DATA_DIR/src/.env" <<EOF
DATA_DIR=$DATA_DIR
PORTAL_URL=$PORTAL
CONNECTOR_TOKEN=$TOKEN
INGEST_TOKEN=$INGEST_TOKEN
WORKER_TOKEN=$WORKER_TOKEN
WHISPER_MODEL=$WHISPER_MODEL
TRANSCRIBE=$TRANSCRIBE
CUCM_NODES=$CUCM_NODES
EOF
chmod 600 "$DATA_DIR/src/.env"

# 6) Build + start -----------------------------------------------------------
log "building the connector stack (transcribe=$TRANSCRIBE, whisper_model=$WHISPER_MODEL) ..."
cd "$DATA_DIR/src"
docker compose pull freeswitch || true
COMPOSE_ARGS=(up -d --build --force-recreate)
if [ "$TRANSCRIBE" = "true" ]; then
  # Whisper runs under the ``transcription`` profile so it can be omitted with
  # --no-transcribe without editing compose.
  docker compose --profile transcription "${COMPOSE_ARGS[@]}"
else
  docker compose "${COMPOSE_ARGS[@]}"
  # Ensure a previously-enabled whisper container is stopped on reinstall.
  docker compose stop whisper 2>/dev/null || true
  docker compose rm -f whisper 2>/dev/null || true
fi

log "done. FreeSWITCH should report healthy; the connector appears Active after it heartbeats."
log "  status:   docker compose -f $DATA_DIR/src/docker-compose.yml --profile transcription ps"
log "  dialplan: $DATA_DIR/freeswitch/dialplan/cucm_bib.xml"
log "  logs:     docker compose -f $DATA_DIR/src/docker-compose.yml logs -f connector"
if [ "$TRANSCRIBE" = "true" ]; then
  log "  whisper:  docker compose -f $DATA_DIR/src/docker-compose.yml --profile transcription logs -f whisper"
fi
log "  CUCM BIB: point recording profile at this host SIP :5070, destination 1034"
