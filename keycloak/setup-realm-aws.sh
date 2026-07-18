#!/usr/bin/env bash
# Idempotent Keycloak realm bootstrap for AWS dev (and local with env overrides).
set -euo pipefail

KC="${KEYCLOAK_URL:?Set KEYCLOAK_URL}"
ADMIN_USER="${KEYCLOAK_ADMIN:-admin}"
ADMIN_PASS="${KEYCLOAK_ADMIN_PASSWORD:?Set KEYCLOAK_ADMIN_PASSWORD}"
REALM="${KEYCLOAK_REALM:-ccc}"
WEBEX_CLIENT_ID="${WEBEX_IDP_CLIENT_ID:?Set WEBEX_IDP_CLIENT_ID}"
WEBEX_CLIENT_SECRET="${WEBEX_IDP_CLIENT_SECRET:?Set WEBEX_IDP_CLIENT_SECRET}"

echo "Waiting for Keycloak at $KC..."
for i in $(seq 1 60); do
  if curl -sf "$KC/realms/master" >/dev/null 2>&1; then break; fi
  sleep 5
done
curl -sf "$KC/realms/master" >/dev/null

TOKEN=$(curl -s -X POST "$KC/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=$ADMIN_USER" -d "password=$ADMIN_PASS" -d "grant_type=password" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")

auth() { echo "Authorization: Bearer $TOKEN"; }

put_json() {
  local method=$1 url=$2 body=$3
  code=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "$url" -H "$(auth)" -H 'Content-Type: application/json' -d "$body")
  echo "  $method $url -> $code"
}

echo "Ensuring realm '$REALM'..."
put_json POST "$KC/admin/realms" "{\"realm\": \"$REALM\", \"enabled\": true, \"loginTheme\": \"ccc\"}"

for spec in \
  'ccc-portal|https://dev.cloudcorecollab.com/auth/callback|http://localhost:5173/auth/callback' \
  'cloudcorefax-portal|https://fax.dev.cloudcorecollab.com/auth/callback|http://localhost:5174/auth/callback'
do
  IFS='|' read -r cid redirect_prod redirect_dev <<<"$spec"
  echo "Ensuring client '$cid'..."
  put_json POST "$KC/admin/realms/$REALM/clients" "{
    \"clientId\": \"$cid\",
    \"publicClient\": true,
    \"standardFlowEnabled\": true,
    \"redirectUris\": [\"$redirect_prod\", \"$redirect_dev\"],
    \"webOrigins\": [\"+\"],
    \"attributes\": {\"pkce.code.challenge.method\": \"S256\"}
  }"
done

echo "Ensuring Webex identity-provider broker..."
put_json POST "$KC/admin/realms/$REALM/identity-provider/instances" "{
  \"alias\": \"webex\",
  \"providerId\": \"oidc\",
  \"enabled\": true,
  \"trustEmail\": true,
  \"config\": {
    \"clientId\": \"$WEBEX_CLIENT_ID\",
    \"clientSecret\": \"$WEBEX_CLIENT_SECRET\",
    \"authorizationUrl\": \"https://webexapis.com/v1/authorize\",
    \"tokenUrl\": \"https://webexapis.com/v1/access_token\",
    \"userInfoUrl\": \"https://webexapis.com/v1/people/me\",
    \"defaultScope\": \"spark:people_read\",
    \"clientAuthMethod\": \"client_secret_post\",
    \"syncMode\": \"IMPORT\",
    \"useJwksUrl\": \"false\",
    \"validateSignature\": \"false\"
  }
}"

echo "Ensuring broker + client mappers..."
put_json POST "$KC/admin/realms/$REALM/identity-provider/instances/webex/mappers" '{
  "name": "org-id-to-attribute",
  "identityProviderAlias": "webex",
  "identityProviderMapper": "oidc-user-attribute-idp-mapper",
  "config": {"syncMode": "INHERIT", "claim": "orgId", "user.attribute": "webex_org_id"}
}'

for CLIENT in ccc-portal cloudcorefax-portal; do
  CID=$(curl -s "$KC/admin/realms/$REALM/clients?clientId=$CLIENT" -H "$(auth)" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['id'] if d else '')")
  [ -n "$CID" ] || continue
  put_json POST "$KC/admin/realms/$REALM/clients/$CID/protocol-mappers/models" '{
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
done

echo "Keycloak realm bootstrap complete."
