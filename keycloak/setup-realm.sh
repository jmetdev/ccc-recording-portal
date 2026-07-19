#!/usr/bin/env bash
# One-shot Keycloak realm/client/broker setup for cross-app SSO (Phase D).
#
# Run once portal-keycloak is up (docker compose --profile sso up -d keycloak)
# and responding. Safe to re-run — POSTs that hit an existing resource just
# return 409, which this script ignores.
#
# After running: edit the "webex" identity provider in the admin console
# (Identity Providers -> webex) and replace the placeholder Client ID/Secret
# with real values from a Webex OAuth Integration registered at
# https://developer.webex.com (redirect URI:
# <KC>/realms/<REALM>/broker/webex/endpoint). See docs/KEYCLOAK.md.
set -euo pipefail

KC="${KEYCLOAK_URL:-http://localhost:8180}"
ADMIN_USER="${KEYCLOAK_ADMIN:-admin}"
ADMIN_PASS="${KEYCLOAK_ADMIN_PASSWORD:?Set KEYCLOAK_ADMIN_PASSWORD to the admin password used to start the container}"
REALM="${KEYCLOAK_REALM:-ccc}"

echo "Waiting for Keycloak to respond at $KC..."
until curl -sf "$KC/realms/master" >/dev/null 2>&1; do sleep 3; done
echo "Keycloak is up."

TOKEN=$(curl -s -X POST "$KC/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=$ADMIN_USER" -d "password=$ADMIN_PASS" -d "grant_type=password" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

auth() { echo "Authorization: Bearer $TOKEN"; }

echo "Creating realm '$REALM'..."
curl -s -X POST "$KC/admin/realms" -H "$(auth)" -H "Content-Type: application/json" \
  -d "{\"realm\": \"$REALM\", \"enabled\": true}" -o /dev/null -w "  -> %{http_code}\n"

echo "Creating client 'ccc-portal'..."
curl -s -X POST "$KC/admin/realms/$REALM/clients" -H "$(auth)" -H "Content-Type: application/json" -d '{
  "clientId": "ccc-portal",
  "publicClient": true,
  "standardFlowEnabled": true,
  "redirectUris": ["http://localhost:5173/auth/callback", "https://recorddev.cloudcorecollab.com/auth/callback", "https://dev.cloudcorecollab.com/auth/callback"],
  "webOrigins": ["+"],
  "attributes": {"pkce.code.challenge.method": "S256"}
}' -o /dev/null -w "  -> %{http_code}\n"

echo "Creating client 'cloudcorefax-portal'..."
curl -s -X POST "$KC/admin/realms/$REALM/clients" -H "$(auth)" -H "Content-Type: application/json" -d '{
  "clientId": "cloudcorefax-portal",
  "publicClient": true,
  "standardFlowEnabled": true,
  "redirectUris": ["http://localhost:5174/auth/callback", "https://faxdev.cloudcorecollab.com/auth/callback"],
  "webOrigins": ["+"],
  "attributes": {"pkce.code.challenge.method": "S256"}
}' -o /dev/null -w "  -> %{http_code}\n"

echo "Creating Webex identity-provider broker (PLACEHOLDER client_id/secret -- swap in real values, see header comment above)..."
curl -s -X POST "$KC/admin/realms/$REALM/identity-provider/instances" -H "$(auth)" -H "Content-Type: application/json" -d '{
  "alias": "webex",
  "providerId": "oidc",
  "enabled": true,
  "trustEmail": true,
  "config": {
    "clientId": "REPLACE_ME_WEBEX_CLIENT_ID",
    "clientSecret": "REPLACE_ME_WEBEX_CLIENT_SECRET",
    "authorizationUrl": "https://webexapis.com/v1/authorize",
    "tokenUrl": "https://webexapis.com/v1/access_token",
    "userInfoUrl": "https://webexapis.com/v1/people/me",
    "defaultScope": "spark:people_read",
    "clientAuthMethod": "client_secret_post",
    "syncMode": "IMPORT",
    "useJwksUrl": "false",
    "validateSignature": "false"
  }
}' -o /dev/null -w "  -> %{http_code}\n"

echo "Adding orgId -> webex_org_id user-attribute mapper on the broker..."
curl -s -X POST "$KC/admin/realms/$REALM/identity-provider/instances/webex/mappers" \
  -H "$(auth)" -H "Content-Type: application/json" -d '{
    "name": "org-id-to-attribute",
    "identityProviderAlias": "webex",
    "identityProviderMapper": "oidc-user-attribute-idp-mapper",
    "config": {
      "syncMode": "INHERIT",
      "claim": "orgId",
      "user.attribute": "webex_org_id"
    }
  }' -o /dev/null -w "  -> %{http_code}\n"

echo "Adding a user-attribute protocol mapper (webex_org_id -> token claim) on both clients..."
for CLIENT in ccc-portal cloudcorefax-portal; do
  CID=$(curl -s "$KC/admin/realms/$REALM/clients?clientId=$CLIENT" -H "$(auth)" | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])")
  curl -s -X POST "$KC/admin/realms/$REALM/clients/$CID/protocol-mappers/models" \
    -H "$(auth)" -H "Content-Type: application/json" -d '{
      "name": "webex-org-id",
      "protocol": "openid-connect",
      "protocolMapper": "oidc-usermodel-attribute-mapper",
      "config": {
        "user.attribute": "webex_org_id",
        "claim.name": "webex_org_id",
        "jsonType.label": "String",
        "id.token.claim": "true",
        "access.token.claim": "true",
        "userinfo.token.claim": "true"
      }
    }' -o /dev/null -w "  $CLIENT -> %{http_code}\n"
done

echo "Setting the 'ccc' login theme..."
curl -s -X PUT "$KC/admin/realms/$REALM" -H "$(auth)" -H "Content-Type: application/json" \
  -d '{"loginTheme": "ccc"}' -o /dev/null -w "  -> %{http_code}\n"

echo "Done. Admin console: $KC/admin (login: $ADMIN_USER / <your KEYCLOAK_ADMIN_PASSWORD>)"
