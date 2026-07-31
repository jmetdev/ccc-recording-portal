# CCC Recording Portal — Webex integrations: one-time setup and scopes

This app uses **two separate Webex integrations** — don't conflate them when
registering apps or reading logs:

1. **Per-user OIDC/SSO login** (Keycloak broker) — a plain Webex OAuth
   *integration*, identifies who's logging in and what org they're in.
2. **Admin-consent Service App** — an org-level integration a customer's Full
   Admin authorizes once in Control Hub, used for tenant auto-provisioning,
   org-admin detection, Control Hub group sync, and (separately) the WXC
   recording connector's org authorization.

3. **WXC recording connector** (`ccc-connector-webex`, sibling repo) — a
   headless Docker poller deployed on the VPS per customer org. Uses its own
   Service App client credentials + org refresh token (`/data/tokens.json`) to
   list converged Calling recordings (`spark-compliance:recordings_read` or
   `spark-admin:recordings_read` fallback). Pushes MP3 + VTT to portal ingest
   v2. See `ccc-connector-webex/README.md` and `scripts/wxc-smoke-checklist.md`.

## 1. Per-user OIDC/SSO login (Webex as a Keycloak identity provider)

Register a plain Webex OAuth integration at <https://developer.webex.com> → My
Webex Apps → Create an Integration:

- Redirect URI: Keycloak's identity-provider broker callback for this realm
  (e.g. `https://<keycloak-host>/realms/<realm>/broker/webex/endpoint`).
- Scope: `spark:people_read` only — this is identity (name, email, `orgId`),
  the same scope `core/config.py`'s `webex_scopes` already uses for the
  existing direct OAuth login.
- Configure this integration as a Keycloak "Identity Provider" (generic
  OAuth2/OIDC provider type) on the shared realm, with a mapper that pulls
  `orgId` from Webex's `/v1/people/me` response into a `webex_org_id` user
  attribute/claim. See `docs/KEYCLOAK.md` for the realm-level walkthrough.
- **One registration serves every customer org** — Webex's OAuth response
  carries whichever org the logging-in user belongs to; there is no
  per-tenant Keycloak client or IdP config.

## 2. Admin-consent Service App

Register at <https://developer.webex.com> → My Webex Apps → Create a Service
App, following the same pattern CloudCoreFax already uses successfully
(`cloudcorefax/docs/webex-service-app.md`).

### Scopes, by what they unlock

| Scope | Unlocks | Status |
|---|---|---|
| `spark-admin:people_read` | org-admin detection (`person_is_org_admin`) | validated — CloudCoreFax uses this live today |
| `spark-admin:workspaces_read` / `_write` | workspace provisioning for the hosted per-tenant connector | validated pattern, ported from CloudCoreFax |
| `spark-admin:devices_read` / `_write` | customer-managed device provisioning, if the hosted connector needs it | validated pattern, ported from CloudCoreFax |
| `spark-admin:telephony_config_read` / `_write` | number/location lookups, if needed by the connector | validated pattern, ported from CloudCoreFax |
| `spark-admin:licenses_read` | license checks, if the hosted connector requires a specific license type | validated pattern, ported from CloudCoreFax |
| `spark-compliance:recordings_read` | WXC connector recording list/download (Compliance Officer) | **validated** via `ccc-connector-webex` |
| `spark-admin:recordings_read` | WXC connector admin-mode listing fallback | **validated** via `ccc-connector-webex` |
| groups-read (exact scope name **unconfirmed**) | Control Hub group → role sync | **unvalidated — spike against a live org** |

Webex enforces an approximate length ceiling on the combined scope string
(CloudCoreFax's existing 9-scope registration is already close to it). The two
unvalidated rows above may need to become a **second, narrower Service App
registration** rather than growing one giant scope string — decide this once
the corresponding spike concludes, not before.

### Setup steps

1. Register the Service App, note the **App ID**, **Client ID**, **Client
   Secret**.
2. Create the authorization webhook pointing at
   `https://<this-app-domain>/api/webex/serviceapp/webhook`, with a generated
   webhook secret (verified via `X-Spark-Signature` HMAC-SHA1, same as
   CloudCoreFax's implementation).
3. Mint an org token with the `spark:application` scope, used to call
   `POST /v1/applications/{appId}/token` for each authorizing org's token pair.
4. **VPS:** run `deploy/vps/enable-webex-serviceapp.sh` with the five env vars
   (generates `CRYPTO_KEY` if missing). **AWS:** store the same values in SSM
   (SecureString, prefix `/ccc/dev/`):

   ```
   aws ssm put-parameter --type SecureString --name /ccc/dev/webex_serviceapp_id            --value <APP_ID>
   aws ssm put-parameter --type SecureString --name /ccc/dev/webex_serviceapp_client_id     --value <CLIENT_ID>
   aws ssm put-parameter --type SecureString --name /ccc/dev/webex_serviceapp_client_secret --value <CLIENT_SECRET>
   aws ssm put-parameter --type SecureString --name /ccc/dev/webex_serviceapp_webhook_secret --value <WEBHOOK_SECRET>
   aws ssm put-parameter --type SecureString --name /ccc/dev/webex_serviceapp_org_token     --value <ORG_TOKEN>
   ```

   Also add a crypto key for at-rest token encryption:
   `aws ssm put-parameter --type SecureString --name /ccc/dev/crypto_key --value <FERNET_KEY>`.

   Redeploy / restart backend so `serviceapp_configured` becomes true. Health →
   Core services shows **Webex Service App**.

**Recommend one independent Service App registration per product** —
ccc-recording-portal and CloudCoreFax each register their own; the Webex
`org_id` is the only fact shared between them (used as a join key for cross-app
tenant correlation and SSO), not a shared webhook or token.

## SSO trust setup

Cross-app SSO (Phase D) is the *per-user OIDC login* from section 1 above,
brokered through this app's Keycloak realm rather than talking to Webex
directly — see `docs/KEYCLOAK.md`'s "Cross-app SSO with CloudCoreFax" section
for the full setup (`keycloak/setup-realm.sh` automates it). Summary: one
realm, a second client (`cloudcorefax-portal`) for CloudCoreFax, a Webex
identity-provider broker (uses the plain OAuth integration from section 1,
not the Service App), and a `webex_org_id` claim carried by both clients so
each product resolves its own tenant independently. CloudCoreFax still needs
its own OIDC bearer-token verifier built (it has none today) before it can
actually consume tokens from its new client — tracked as separate work in
that repo.

## WXC recording ingest (canonical path)

The experimental `webex-connector/` webhook stub and ECS/Docker auto-provisioning
in this repo are **deprecated**. Production WXC ingest:

1. Create a connector credential (`kind=webex`) in the portal.
2. Deploy `ccc-connector-webex` on the VPS (`deploy/deploy-connector-webex.sh`).
3. Configure recorded users (owner emails) and Control Hub group sync for RBAC.

## Live spike results (2026-07-18, AWS dev — portal Service App only)

Ran `scripts/spike-webex-apis.py` against `/ccc/dev/webex_serviceapp_*` SSM:

| Probe | Result |
|---|---|
| Service App credentials | **Blocked** — SSM values are still `PLACEHOLDER_SET_ME` (copied from fax dev). No org token exchange attempted. |
| `GET /v1/groups` | **Not run** — requires a real Service App + authorized `--org-id`. Client code in `webex_serviceapp.py` uses `/groups` and `/groups/{id}/members` with `displayName`/`members` fields; re-validate when creds exist. |
| Recording retrieval | **Not run** on portal Service App — WXC ingest uses separate `ccc-connector-webex` poller with Compliance Officer scopes instead of the deprecated `webex-connector/` stub. |

**Recording-retrieval conclusion:** WXC ingest is implemented in `ccc-connector-webex`
(Service App + `spark-compliance:recordings_read` or admin fallback). The portal's
`webex-connector/` webhook path is deprecated.

Re-run after setting real Service App SSM values:

```bash
AWS_PROFILE=dev python3 scripts/spike-webex-apis.py --org-id <AUTHORIZED_ORG_ID>
```

## Known caveats

- Group-membership API shape may still need live validation for Phase F.
- The deprecated `webex-connector/` stub and ECS auto-provision path remain in
  the repo for reference only — use `ccc-connector-webex` on the VPS.
