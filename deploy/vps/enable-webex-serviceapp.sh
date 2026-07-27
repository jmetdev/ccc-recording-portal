#!/usr/bin/env bash
# Wire Webex Service App credentials into the VPS portal .env.
#
# Prerequisites:
#   1. Register a Webex Service App (NOT the login OAuth Integration) at
#      https://developer.webex.com → My Webex Apps → Create a Service App
#   2. Authorization webhook URL (exact):
#      https://recorddev.cloudcorecollab.com/api/webex/serviceapp/webhook
#   3. Mint an org token with spark:application for token exchange
#   4. See docs/webex-service-app.md for scopes and details
#
# Usage (on VPS as root/deploy, or via ssh):
#   WEBEX_SERVICEAPP_ID=... \
#   WEBEX_SERVICEAPP_CLIENT_ID=... \
#   WEBEX_SERVICEAPP_CLIENT_SECRET=... \
#   WEBEX_SERVICEAPP_WEBHOOK_SECRET=... \
#   WEBEX_SERVICEAPP_ORG_TOKEN=... \
#     ./deploy/vps/enable-webex-serviceapp.sh
#
# CRYPTO_KEY is generated automatically if missing (do not rotate casually once
# org tokens are stored encrypted).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ccc-recording-portal}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
PUBLIC_BASE="${PUBLIC_BASE:-https://recorddev.cloudcorecollab.com}"

: "${WEBEX_SERVICEAPP_ID:?Set WEBEX_SERVICEAPP_ID}"
: "${WEBEX_SERVICEAPP_CLIENT_ID:?Set WEBEX_SERVICEAPP_CLIENT_ID}"
: "${WEBEX_SERVICEAPP_CLIENT_SECRET:?Set WEBEX_SERVICEAPP_CLIENT_SECRET}"
: "${WEBEX_SERVICEAPP_WEBHOOK_SECRET:?Set WEBEX_SERVICEAPP_WEBHOOK_SECRET}"
: "${WEBEX_SERVICEAPP_ORG_TOKEN:?Set WEBEX_SERVICEAPP_ORG_TOKEN}"

upsert_env() {
  local file=$1 key=$2 value=$3
  python3 - "$file" "$key" "$value" <<'PY'
import sys
from pathlib import Path
path, key, value = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
if not path.exists():
    path.write_text("")
lines = []
found = False
for line in path.read_text().splitlines():
    if line.startswith(key + "="):
        lines.append(f"{key}={value}")
        found = True
    else:
        lines.append(line)
if not found:
    lines.append(f"{key}={value}")
path.write_text("\n".join(lines) + "\n")
PY
}

ensure_crypto_key() {
  local file=$1
  local existing
  existing=$(grep -E '^CRYPTO_KEY=' "$file" 2>/dev/null | head -1 | cut -d= -f2- || true)
  if [ -n "$existing" ] && [ "$existing" != "REPLACE_ME" ] && [ "$existing" != "PLACEHOLDER_SET_ME" ]; then
    echo "==> Keeping existing CRYPTO_KEY"
    return
  fi
  local key
  key=$(python3 -c 'import base64,secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())')
  upsert_env "$file" CRYPTO_KEY "$key"
  echo "==> Generated new CRYPTO_KEY (store securely; do not rotate after tokens are saved)"
}

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

echo "==> Writing Webex Service App settings into $ENV_FILE"
upsert_env "$ENV_FILE" WEBEX_SERVICEAPP_ID "$WEBEX_SERVICEAPP_ID"
upsert_env "$ENV_FILE" WEBEX_SERVICEAPP_CLIENT_ID "$WEBEX_SERVICEAPP_CLIENT_ID"
upsert_env "$ENV_FILE" WEBEX_SERVICEAPP_CLIENT_SECRET "$WEBEX_SERVICEAPP_CLIENT_SECRET"
upsert_env "$ENV_FILE" WEBEX_SERVICEAPP_WEBHOOK_SECRET "$WEBEX_SERVICEAPP_WEBHOOK_SECRET"
upsert_env "$ENV_FILE" WEBEX_SERVICEAPP_ORG_TOKEN "$WEBEX_SERVICEAPP_ORG_TOKEN"
ensure_crypto_key "$ENV_FILE"

echo "==> Recreating portal backend with new env"
cd "$APP_DIR"
if [ -f docker-compose.vps.yml ]; then
  docker compose -f docker-compose.vps.yml --env-file .env up -d backend 2>/dev/null \
    || docker compose --env-file .env --env-file .env.deploy up -d backend
elif [ -f deploy/docker-compose.vps.yml ]; then
  docker compose -f deploy/docker-compose.vps.yml --env-file .env up -d backend
else
  docker compose --env-file .env up -d backend
fi

echo
echo "Checklist"
echo "  1. Service App webhook URL: ${PUBLIC_BASE}/api/webex/serviceapp/webhook"
echo "  2. Control Hub → Management → Apps → Service Apps → authorize CCC Recording Portal"
echo "  3. Portal Settings → Webex setup should show serviceapp_configured / Authorized"
echo "  4. Settings → Group sync becomes usable after authorize"
echo
echo "Done."
