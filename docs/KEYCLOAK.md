# Keycloak SSO setup

The portal supports SSO via any OIDC provider; this guide covers the bundled
Keycloak (`docker compose --profile sso up -d keycloak`).

## How the flow works

1. The login page calls `GET /api/auth/sso/config`; when `OIDC_ENABLED=true` it
   shows **Sign in with SSO**.
2. The SPA runs the PKCE authorization-code flow against Keycloak
   (redirect URI `https://<portal-host>/auth/callback`).
3. The SPA posts the Keycloak access token to `POST /api/auth/sso/exchange`;
   the backend verifies it against the realm JWKS, resolves/provisions the
   user, and issues portal JWTs (which carry the tenant claim used by REST,
   websockets, and RLS).

Local username/password login keeps working alongside SSO.

## Realm setup

1. Create the Keycloak database once: `docker exec portal-db psql -U portal -c 'CREATE DATABASE keycloak'`,
   then `docker compose --profile sso up -d keycloak` and log into the admin
   console (`KEYCLOAK_ADMIN` / `KEYCLOAK_ADMIN_PASSWORD`, port 8080).
2. Create a realm, e.g. `ccc`.
3. Create a client:
   - Client ID: `ccc-portal` (must match `OIDC_CLIENT_ID`)
   - Client authentication: **off** (public client), Standard flow: **on**
   - PKCE: set *Proof Key for Code Exchange Code Challenge Method* = `S256`
     (Advanced settings)
   - Valid redirect URIs: `https://<portal-host>/auth/callback`
     (and `http://localhost:5173/auth/callback` for dev)
   - Web origins: `+`
4. Backend `.env`:

   ```
   OIDC_ENABLED=true
   OIDC_ISSUER=http://<keycloak-host>:8080/realms/ccc
   OIDC_CLIENT_ID=ccc-portal
   ```

   The backend must be able to reach the issuer URL for discovery/JWKS.

## User mapping and provisioning

- Users are matched by OIDC subject, then by **email** (linking the subject on
  first SSO login). With `OIDC_AUTO_PROVISION=true` (default), unknown users
  are created automatically.
- **Tenant**: auto-provisioned users land in the tenant named by the token
  claim configured via `OIDC_TENANT_CLAIM` (default `tenant`), falling back to
  the default tenant. Add a Keycloak client mapper: *User Attribute* →
  attribute `tenant`, token claim name `tenant`, add to access token — and set
  the attribute on each user (or use per-tenant realms/orgs).
- **Roles**: realm role names that match portal role names in that tenant
  (e.g. `admin`, `viewer`) are attached at provisioning time.
- Customer IdPs (Entra ID, Google Workspace) are brokered *inside* Keycloak
  (Identity Providers → Add), so the portal only ever talks to Keycloak.

## Hardening for production

- Add a client **audience mapper** (Client scopes → dedicated →
  Add mapper → Audience, include client `ccc-portal` in the access token) and
  set `OIDC_AUDIENCE=ccc-portal`. Without this the backend accepts any valid
  token from the realm regardless of intended audience.
- Run Keycloak behind TLS with a real hostname (`KC_HOSTNAME`), not
  `start-dev`.
- Disable `OIDC_AUTO_PROVISION` if onboarding is admin-controlled.

## Cross-app SSO with CloudCoreFax (Phase D)

Public VPS hostnames (Universal SSL). Target naming (suite vs apps) is in
[SUITE-PORTAL.md](./SUITE-PORTAL.md) — **production hosts are not live yet**.

| Role | Hostname |
|------|----------|
| Suite portal (login + app launcher) | `https://dev.cloudcorecollab.com` *(interim: still recording SPA until split)* |
| Recording app (direct) | `https://recorddev.cloudcorecollab.com` |
| Fax app (direct) | `https://faxdev.cloudcorecollab.com` |
| Keycloak | `https://authdev.cloudcorecollab.com` |
| Production (reserved, do not deploy yet) | `portal.` / `record.` / `fax.` / `auth.` `.cloudcorecollab.com` |

Webex Integration redirect URI (exact):

```
https://authdev.cloudcorecollab.com/realms/ccc/broker/webex/endpoint
```

Enable on the VPS after registering the Integration:

```
WEBEX_IDP_CLIENT_ID=... WEBEX_IDP_CLIENT_SECRET=... \
  /opt/ccc-recording-portal/deploy/vps/enable-webex-sso.sh
```

(or from this repo: `deploy/vps/enable-webex-sso.sh` after syncing to the host)

The portal login button **Continue with Webex** sends `kc_idp_hint=webex` so
users skip the Keycloak chooser and go straight to Webex. The branded `ccc`
login theme still applies to Keycloak pages (first-broker linking, errors).

The same realm brokers Webex login for **both** products, so logging into
either app doesn't require a second login for the other. This is one realm
with a second client and a Webex identity-provider broker — not a second
Keycloak instance, and not per-tenant configuration of any kind.

### Why the login has to go *through* Keycloak

Both products already have a direct, per-user Webex OAuth login
(`core/oauth.py`/`api/oauth.py`) that never touches Keycloak. That flow works
fine standalone but can't produce a shared SSO session — if a user's
Webex login only ever talks to Webex directly, there's no Keycloak session
for the second app to reuse. Making SSO real means re-pointing the *existing*
"Continue with Webex" button through Keycloak's own Identity Provider broker
feature instead: app → Keycloak → Webex → Keycloak → app. The button doesn't
change for the user; the plumbing behind it does. `core/oauth.py`'s direct
exchange should be retired once the brokered path is live (keep it disabled-
but-present for one release as a rollback path).

### Setup

1. **Register a plain Webex OAuth integration** (not a Service App) at
   <https://developer.webex.com> → My Webex Apps → Create an Integration.
   Redirect URI: Keycloak's broker callback,
   `<keycloak-host>/realms/ccc/broker/webex/endpoint`.
   Login uses Webex **Login with Webex** (OIDC). Keycloak always sends
   `openid` plus `defaultScope` (`email profile` by default). Do **not** add
   `spark:*` API scopes to the IdP unless those scopes are also checked on the
   Integration — otherwise Webex returns `invalid_scope`. Optional:
   `WEBEX_IDP_SCOPES=email profile spark:people_read` after enabling
   `spark:people_read` on the Integration (needed for `orgId` → tenant mapping
   via `/v1/people/me`; without it, users fall back to the default tenant).
2. **Add a second client** on the same `ccc` realm for CloudCoreFax:
   Client ID `cloudcorefax-portal`, same public/PKCE/standard-flow settings as
   `ccc-portal` above, redirect URIs pointed at CloudCoreFax's own origin.
3. **Add the Webex identity provider** (Identity Providers → Add provider →
   OpenID Connect v1.0): alias `webex`, Authorization URL
   `https://webexapis.com/v1/authorize`, Token URL
   `https://webexapis.com/v1/access_token`, User Info URL
   `https://webexapis.com/v1/userinfo`, Default Scopes `email profile`,
   Client ID/Secret from step 1, Client Authentication `client_secret_post`.
   Discovery: `https://webexapis.com/v1/.well-known/openid-configuration`.
4. **Map `orgId` into a claim both clients carry**: on the `webex` identity
   provider, add a mapper (*User Attribute* importer) from claim `orgId` to
   user attribute `webex_org_id`; then on **both** `ccc-portal` and
   `cloudcorefax-portal` clients, add a protocol mapper (*User Attribute*)
   from that same user attribute to a token claim named `webex_org_id`
   (include in ID token, access token, and userinfo). Each product resolves
   this claim to its own local tenant row independently (`core/oidc.py`'s
   `_tenant_for_claims`, `OIDC_ORG_CLAIM=webex_org_id` by default) — this is
   the same join-key convention the Service App webhook uses for tenant
   correlation, just reused for login-time tenant resolution too.
5. **Apply the branded login theme**: set the realm's Login Theme to `ccc`
   (Realm settings → Themes). The theme lives in `keycloak/themes/ccc/login/`
   and is mounted into the container via `docker-compose.yml`'s `keycloak`
   service volume — it skins the standard Keycloak login page (colors, font)
   rather than replacing templates, so the OIDC flow's security properties
   are untouched.
6. **Companion work in CloudCoreFax** (separate repo, separate task): it has
   no `core/oidc.py`-equivalent bearer-token verifier yet — it needs one built
   before it can actually consume tokens issued by the `cloudcorefax-portal`
   client. Not built as part of this change.

### Local dev quickstart

`keycloak/setup-realm.sh` does steps 2–5 via Keycloak's Admin REST API (with
placeholder Webex credentials), idempotently. Run it once against a running
`portal-keycloak`:

```
KEYCLOAK_ADMIN_PASSWORD=<your admin password> keycloak/setup-realm.sh
```

Then edit the `webex` identity provider's Client ID/Secret in the admin
console to the real values from step 1, and set the realm's login theme to
`ccc` if the script's `PUT` didn't stick (Realm settings → Themes).

### Known gaps

- Cross-domain cookie behavior needs validating against the real deployed
  domains (not just localhost) — third-party cookie restrictions can break
  the "silent" part of SSO depending on how the two apps' domains relate.
- If the same email should never map to different tenants across the two
  products, note that explicitly — the org_id-claim design above already
  keeps tenant resolution independent per app, but `core/oidc.py`'s existing
  email-fallback matching is a separate mechanism worth double-checking
  doesn't accidentally cross-link accounts.
