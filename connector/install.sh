#!/usr/bin/env bash
#
# CCC connector installer. Run on the on-prem host next to your CUCM cluster:
#
#   curl -fsSL https://raw.githubusercontent.com/jmetdev/ccc-recording-portal/main/connector/install.sh \
#     | sudo bash -s -- --token ccck_XXXX --portal https://dev.cloudcorecollab.com \
#       --cucm-nodes 10.0.0.10,10.0.0.11
#
# Installs Docker-CE, lays out the mount dirs, downloads the connector bundle,
# writes the connector's .env (with your token), and starts FreeSWITCH + the
# connector. Re-running it upgrades in place.

set -euo pipefail

TOKEN=""
PORTAL="https://dev.cloudcorecollab.com"
CUCM_NODES=""
DATA_DIR="/opt/ccc-connector"
WHISPER_MODEL="base"
REPO_REF="main"

while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2;;
    --portal) PORTAL="$2"; shift 2;;
    --cucm-nodes) CUCM_NODES="$2"; shift 2;;
    --data-dir) DATA_DIR="$2"; shift 2;;
    --whisper-model) WHISPER_MODEL="$2"; shift 2;;
    --ref) REPO_REF="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

[ -n "$TOKEN" ] || { echo "ERROR: --token is required (create one in the portal: Settings -> Connectors)"; exit 2; }
[ "$(id -u)" = "0" ] || { echo "ERROR: run as root (curl ... | sudo bash -s -- ...)"; exit 2; }

log() { echo -e "\033[1;36m[ccc]\033[0m $*"; }

# 1) Docker-CE ---------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "installing Docker-CE ..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker || true
fi
docker compose version >/dev/null 2>&1 || { echo "ERROR: 'docker compose' plugin not available"; exit 1; }

# 2) Mount layout ------------------------------------------------------------
log "creating mount layout under $DATA_DIR ..."
mkdir -p "$DATA_DIR/recordings" "$DATA_DIR/freeswitch" "$DATA_DIR/src"

# 3) Per-tenant CUCM ACL -----------------------------------------------------
log "writing FreeSWITCH CUCM ACL ..."
{
  echo '<configuration name="acl.conf" description="Network ACL">'
  echo '  <network-lists>'
  echo '    <list name="cucm" default="deny">'
  if [ -n "$CUCM_NODES" ]; then
    IFS=',' read -ra NODES <<< "$CUCM_NODES"
    for ip in "${NODES[@]}"; do
      ip="$(echo "$ip" | xargs)"
      [ -n "$ip" ] && echo "      <node type=\"allow\" cidr=\"$ip/32\"/>"
    done
  else
    echo "      <!-- No --cucm-nodes given; add your CUCM node IPs and reload FreeSWITCH -->"
  fi
  echo '    </list>'
  echo '  </network-lists>'
  echo '</configuration>'
} > "$DATA_DIR/freeswitch/acl.conf.xml"

# 4) Download the connector bundle (public repo) -----------------------------
log "downloading connector bundle ($REPO_REF) ..."
TMP="$(mktemp -d)"
curl -fsSL "https://github.com/jmetdev/ccc-recording-portal/archive/refs/heads/${REPO_REF}.tar.gz" \
  | tar xz -C "$TMP"
rm -rf "$DATA_DIR/src"
cp -r "$TMP/ccc-recording-portal-${REPO_REF}/connector" "$DATA_DIR/src"
rm -rf "$TMP"

# 5) .env (token + config) ---------------------------------------------------
log "writing connector environment ..."
INGEST_TOKEN="$(openssl rand -hex 24 2>/dev/null || head -c48 /dev/urandom | base64 | tr -dc 'a-f0-9' | head -c48)"
cat > "$DATA_DIR/src/.env" <<EOF
DATA_DIR=$DATA_DIR
PORTAL_URL=$PORTAL
CONNECTOR_TOKEN=$TOKEN
INGEST_TOKEN=$INGEST_TOKEN
WHISPER_MODEL=$WHISPER_MODEL
EOF
chmod 600 "$DATA_DIR/src/.env"

# 6) Build + start -----------------------------------------------------------
log "building the connector and starting the stack ..."
cd "$DATA_DIR/src"
docker compose pull freeswitch || true
docker compose up -d --build

log "done. The connector will appear as 'Active' in the portal once it heartbeats."
log "  status:  docker compose -f $DATA_DIR/src/docker-compose.yml ps"
log "  logs:    docker compose -f $DATA_DIR/src/docker-compose.yml logs -f connector"
