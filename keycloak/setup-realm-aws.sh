#!/usr/bin/env bash
# Idempotent Keycloak realm bootstrap (AWS dev + VPS). Upserts realm, clients,
# Webex IdP broker, and protocol mappers so secret/redirect rotations apply.
set -euo pipefail

KC="${KEYCLOAK_URL:?Set KEYCLOAK_URL}"
ADMIN_USER="${KEYCLOAK_ADMIN:-admin}"
ADMIN_PASS="${KEYCLOAK_ADMIN_PASSWORD:?Set KEYCLOAK_ADMIN_PASSWORD}"
REALM="${KEYCLOAK_REALM:-ccc}"
WEBEX_CLIENT_ID="${WEBEX_IDP_CLIENT_ID:-}"
WEBEX_CLIENT_SECRET="${WEBEX_IDP_CLIENT_SECRET:-}"

echo "Waiting for Keycloak at $KC..."
for i in $(seq 1 60); do
  if curl -sf "$KC/realms/master" >/dev/null 2>&1; then break; fi
  sleep 5
done
curl -sf "$KC/realms/master" >/dev/null

TOKEN=$(curl -s -X POST "$KC/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=$ADMIN_USER" -d "password=$ADMIN_PASS" -d "grant_type=password" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

auth_hdr() { printf 'Authorization: Bearer %s' "$TOKEN"; }

api() {
  local method=$1 url=$2 body=${3:-}
  if [ -n "$body" ]; then
    curl -s -o /tmp/kc_resp.json -w '%{http_code}' -X "$method" "$url" \
      -H "$(auth_hdr)" -H 'Content-Type: application/json' -d "$body"
  else
    curl -s -o /tmp/kc_resp.json -w '%{http_code}' -X "$method" "$url" -H "$(auth_hdr)"
  fi
}

ensure_realm() {
  local code
  local body='{"realm":"'"$REALM"'","enabled":true,"loginTheme":"ccc","displayName":"CloudCoreCollab","displayNameHtml":"<strong>CloudCoreCollab</strong>","registrationAllowed":false,"resetPasswordAllowed":false,"rememberMe":true,"loginWithEmailAllowed":true,"duplicateEmailsAllowed":false,"editUsernameAllowed":false}'
  code=$(api GET "$KC/admin/realms/$REALM")
  if [ "$code" = "200" ]; then
    code=$(api PUT "$KC/admin/realms/$REALM" "$body")
    echo "  PUT realm $REALM -> $code"
  else
    code=$(api POST "$KC/admin/realms" "$body")
    echo "  POST realm $REALM -> $code"
  fi
}

ensure_client() {
  local cid=$1
  shift
  local redirects=("$@")
  local internal_id code body uri_json=""
  local i=0
  for uri in "${redirects[@]}"; do
    [ -n "$uri" ] || continue
    if [ $i -gt 0 ]; then uri_json+=", "; fi
    uri_json+="\"$uri\""
    i=$((i + 1))
  done
  internal_id=$(curl -s "$KC/admin/realms/$REALM/clients?clientId=$cid" -H "$(auth_hdr)" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['id'] if d else '')")
  body=$(cat <<EOF
{
  "clientId": "$cid",
  "publicClient": true,
  "standardFlowEnabled": true,
  "redirectUris": [$uri_json],
  "webOrigins": ["+"],
  "attributes": {"pkce.code.challenge.method": "S256"}
}
EOF
)
  if [ -n "$internal_id" ]; then
    code=$(api PUT "$KC/admin/realms/$REALM/clients/$internal_id" "$body")
    echo "  PUT client $cid -> $code"
  else
    code=$(api POST "$KC/admin/realms/$REALM/clients" "$body")
    echo "  POST client $cid -> $code"
  fi
}

ensure_webex_idp() {
  local code body
  # Login with Webex (OIDC). Keycloak always prepends "openid" to defaultScope.
  # Do NOT put spark:* API scopes here unless those scopes are checked on the
  # Webex Integration — otherwise Webex returns invalid_scope. OIDC scopes
  # (email/profile) do not need to be registered. Optional extra scopes via
  # WEBEX_IDP_SCOPES (space-separated), e.g. "email profile spark:people_read".
  local scopes="${WEBEX_IDP_SCOPES:-email profile}"
  body=$(cat <<EOF
{
  "alias": "webex",
  "displayName": "Webex",
  "providerId": "oidc",
  "enabled": true,
  "trustEmail": true,
  "storeToken": false,
  "linkOnly": false,
  "firstBrokerLoginFlowAlias": "first broker login",
  "config": {
    "clientId": "$WEBEX_CLIENT_ID",
    "clientSecret": "$WEBEX_CLIENT_SECRET",
    "authorizationUrl": "https://webexapis.com/v1/authorize",
    "tokenUrl": "https://webexapis.com/v1/access_token",
    "userInfoUrl": "https://webexapis.com/v1/userinfo",
    "issuer": "https://idbroker.webex.com/idb",
    "defaultScope": "$scopes",
    "clientAuthMethod": "client_secret_post",
    "syncMode": "IMPORT",
    "useJwksUrl": "false",
    "validateSignature": "false",
    "guiOrder": "1",
    "hideOnLoginPage": "false"
  }
}
EOF
)
  code=$(api GET "$KC/admin/realms/$REALM/identity-provider/instances/webex")
  if [ "$code" = "200" ]; then
    code=$(api PUT "$KC/admin/realms/$REALM/identity-provider/instances/webex" "$body")
    echo "  PUT IdP webex -> $code"
  else
    code=$(api POST "$KC/admin/realms/$REALM/identity-provider/instances" "$body")
    echo "  POST IdP webex -> $code"
  fi
}

ensure_idp_mapper() {
  local body mapper_id code
  mapper_id=$(curl -s "$KC/admin/realms/$REALM/identity-provider/instances/webex/mappers" -H "$(auth_hdr)" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print(next((m['id'] for m in d if m.get('name')=='org-id-to-attribute'),''))")
  if [ -n "$mapper_id" ]; then
    echo "  IdP mapper org-id-to-attribute already present ($mapper_id)"
    return 0
  fi
  body='{
    "name": "org-id-to-attribute",
    "identityProviderAlias": "webex",
    "identityProviderMapper": "oidc-user-attribute-idp-mapper",
    "config": {"syncMode": "INHERIT", "claim": "orgId", "user.attribute": "webex_org_id"}
  }'
  code=$(api POST "$KC/admin/realms/$REALM/identity-provider/instances/webex/mappers" "$body")
  echo "  POST IdP mapper org-id-to-attribute -> $code"
}

ensure_client_mapper() {
  local client_name=$1
  local internal_id mapper_id code body
  internal_id=$(curl -s "$KC/admin/realms/$REALM/clients?clientId=$client_name" -H "$(auth_hdr)" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['id'] if d else '')")
  [ -n "$internal_id" ] || return 0
  mapper_id=$(curl -s "$KC/admin/realms/$REALM/clients/$internal_id/protocol-mappers/models" -H "$(auth_hdr)" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print(next((m['id'] for m in d if m.get('name')=='webex-org-id'),''))")
  if [ -n "$mapper_id" ]; then
    echo "  mapper webex-org-id on $client_name already present ($mapper_id)"
    return 0
  fi
  body='{
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
  }'
  code=$(api POST "$KC/admin/realms/$REALM/clients/$internal_id/protocol-mappers/models" "$body")
  echo "  POST mapper webex-org-id on $client_name -> $code"
}

echo "Ensuring realm '$REALM'..."
ensure_realm

echo "Ensuring client 'ccc-portal'..."
ensure_client ccc-portal \
  "https://recorddev.cloudcorecollab.com/auth/callback" \
  "https://dev.cloudcorecollab.com/auth/callback" \
  "http://localhost:5173/auth/callback"

echo "Ensuring client 'cloudcorefax-portal'..."
ensure_client cloudcorefax-portal \
  "https://faxdev.cloudcorecollab.com/auth/callback" \
  "http://localhost:5174/auth/callback"

if [ -n "$WEBEX_CLIENT_ID" ] && [ -n "$WEBEX_CLIENT_SECRET" ]; then
  echo "Ensuring Webex identity-provider broker..."
  ensure_webex_idp
  ensure_idp_mapper
  for CLIENT in ccc-portal cloudcorefax-portal; do
    ensure_client_mapper "$CLIENT"
  done
else
  echo "Skipping Webex IdP broker — set WEBEX_IDP_CLIENT_ID/SECRET to enable."
fi

echo "Keycloak realm bootstrap complete."
