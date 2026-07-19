#!/usr/bin/env bash
# Enable Webex-brokered SSO on the VPS Keycloak + portal.
#
# Prerequisites:
#   1. Register a Webex OAuth Integration (NOT Service App) at
#      https://developer.webex.com → My Webex Apps → Create an Integration
#   2. Scope: spark:people_read
#   3. Redirect URI (exact):
#      https://authdev.cloudcorecollab.com/realms/ccc/broker/webex/endpoint
#
# Usage (on VPS as deploy, or via ssh):
#   WEBEX_IDP_CLIENT_ID=... WEBEX_IDP_CLIENT_SECRET=... \
#     ./deploy/vps/enable-webex-sso.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ccc-recording-portal}"
FAX_DIR="${FAX_DIR:-/opt/cloudcorefax}"

: "${WEBEX_IDP_CLIENT_ID:?Set WEBEX_IDP_CLIENT_ID}"
: "${WEBEX_IDP_CLIENT_SECRET:?Set WEBEX_IDP_CLIENT_SECRET}"

upsert_env() {
  local file=$1 key=$2 value=$3
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    # Escape sed specials in value minimally
    python3 - "$file" "$key" "$value" <<'PY'
import sys
from pathlib import Path
path, key, value = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
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
  else
    echo "${key}=${value}" >> "$file"
  fi
}

echo "==> Writing Webex IdP + OIDC settings into $APP_DIR/.env"
upsert_env "$APP_DIR/.env" WEBEX_IDP_CLIENT_ID "$WEBEX_IDP_CLIENT_ID"
upsert_env "$APP_DIR/.env" WEBEX_IDP_CLIENT_SECRET "$WEBEX_IDP_CLIENT_SECRET"
upsert_env "$APP_DIR/.env" OIDC_ENABLED true
upsert_env "$APP_DIR/.env" OIDC_ISSUER "https://authdev.cloudcorecollab.com/realms/ccc"
upsert_env "$APP_DIR/.env" OIDC_CLIENT_ID ccc-portal
upsert_env "$APP_DIR/.env" KEYCLOAK_HOSTNAME "https://authdev.cloudcorecollab.com"

if [ -f "$FAX_DIR/.env" ]; then
  echo "==> Enabling OIDC on fax portal"
  upsert_env "$FAX_DIR/.env" OIDC_ENABLED true
  upsert_env "$FAX_DIR/.env" OIDC_ISSUER "https://authdev.cloudcorecollab.com/realms/ccc"
  upsert_env "$FAX_DIR/.env" OIDC_CLIENT_ID cloudcorefax-portal
fi

echo "==> Recreating portal backend + keycloak with new env"
cd "$APP_DIR"
docker compose --env-file .env --env-file .env.deploy up -d keycloak backend

echo "==> Waiting for Keycloak"
for i in $(seq 1 36); do
  if curl -sf http://127.0.0.1:8180/realms/master >/dev/null; then break; fi
  sleep 5
done

echo "==> Bootstrapping realm + Webex IdP"
set -a
# shellcheck disable=SC1091
. "$APP_DIR/.env"
set +a
export KEYCLOAK_URL=http://127.0.0.1:8180
chmod +x "$APP_DIR/setup-realm-aws.sh"
"$APP_DIR/setup-realm-aws.sh"

if [ -f "$FAX_DIR/docker-compose.yml" ]; then
  echo "==> Recreating fax api"
  cd "$FAX_DIR"
  docker compose --env-file .env --env-file .env.deploy up -d api
fi

echo ""
echo "Webex SSO enabled."
echo "  Portal:  https://dev.cloudcorecollab.com  (Continue with Webex)"
echo "  Broker:  https://authdev.cloudcorecollab.com/realms/ccc/broker/webex/endpoint"
echo "Confirm that redirect URI is registered on the Webex Integration."
