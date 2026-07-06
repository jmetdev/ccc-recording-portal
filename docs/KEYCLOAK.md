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
