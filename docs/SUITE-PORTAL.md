# CloudCoreCollab suite portal (login + app launcher)

Planning note — **do not deploy production** from this doc. Dev may evolve toward
this shape; production hostnames are reserved only.

## Hostname model

| Environment | Role | Hostname |
|-------------|------|----------|
| **Production** (future) | Suite portal — login + app launcher + licenses | `https://portal.cloudcorecollab.com` |
| **Production** (future) | Recording app (direct entry) | `https://record.cloudcorecollab.com` |
| **Production** (future) | Fax app (direct entry) | `https://fax.cloudcorecollab.com` |
| **Production** (future) | Keycloak | `https://auth.cloudcorecollab.com` |
| **Dev** (current VPS) | Suite portal — login + app launcher + licenses | `https://dev.cloudcorecollab.com` |
| **Dev** | Recording app (direct entry) | `https://recorddev.cloudcorecollab.com` |
| **Dev** | Fax app (direct entry) | `https://faxdev.cloudcorecollab.com` |
| **Dev** | Keycloak | `https://authdev.cloudcorecollab.com` |

Rules:

- `dev.` / `portal.` are the **suite shell** (identity entry + licensed apps +
  license/plan UI). They are **not** aliases of the recording product.
- Users may **bypass** the launcher and open a product host directly
  (`recorddev…` / `faxdev…`, or prod `record…` / `fax…`). Same Keycloak realm /
  SSO session still applies.
- Drop the `dev` infix for production product hosts (`recorddev` → `record`).
- **No production cutover yet** — leave `portal.` / `record.` / `fax.` /
  `auth.` alone until explicitly scheduled.

The frontend switches by hostname: `dev.` / `portal.` render the suite
launcher (`SuiteHomePage`); `recorddev.` / `record.` render the recording app.
Both currently ship from the same frontend image until a dedicated suite
service exists.

## User journeys

### A. Suite entry (preferred)

1. User opens `dev.` (prod: `portal.`).
2. **Continue with Webex** → Keycloak (`authdev.`) → Webex broker → back to suite.
3. **App portal** screen lists products the tenant/user is **licensed** for
   (Recording, Fax, later Spam Shield / Phone Control).
4. User picks an app → navigate to that product host (SSO cookie/session already
   established via shared Keycloak realm).

### B. Direct app entry

1. User opens `recorddev.` or `faxdev.` (or bookmarks / deep links).
2. If no session: product login still goes through the same Keycloak realm
   (same Webex broker).
3. After login they land **in the product**, not the suite launcher.
4. Optional: product chrome links “CloudCoreCollab home” → suite portal.

## Suite dashboard responsibilities

- **Licensed apps** — which products the org may open (and CTA into each).
- **License / plan information** — plan name, seats/limits, included usage
  summaries (fax already has plan fields + overview widgets; recording has no
  first-class plan UI yet).
- **Cross-product identity** — shared users via Keycloak; suite is the place
  operators manage “who is in the org” when that UI exists.
- **Tenant / org linking** — Webex `orgId` ↔ CCC tenant (today split across
  product Service App webhooks and APIs).

Product apps keep **runtime** and **product-specific setup** (recording
connectors/extensions, fax trunks/numbers/gateway wizard, retention, etc.).

## What to move off Recording / Fax (provisioning)

Move toward the suite portal over time; leave product-specific ops in-app.

| Capability | Today | Target owner |
|------------|--------|--------------|
| Platform tenant create / activate | Superadmin API in each app (no UI) | **Suite** |
| Plan / limits assignment (`plan_name`, seats, pages, etc.) | Fax API/fields; recording none | **Suite** |
| Webex org ↔ tenant link (Service App / `webex_org_id`) | Per-product webhook + settings status | **Suite** (products may mirror status) |
| Shared user directory / invite / cross-app roles | Per-product Settings → Users | **Suite** for identity; product-scoped roles stay |
| Superadmin “mint connector credential” for operators | Platform connector APIs | **Suite** (optional operator console) |
| Hosted recording connector enable/disable | Recording Settings → Webex | Stay in **Recording** |
| Control Hub group → recording roles | Recording Group sync | Stay in **Recording** |
| Fax line / workspace / number wizard | Fax Webex setup wizard | Stay in **Fax** |
| Trunks, DIDs, gateway health | Fax Settings | Stay in **Fax** |
| Extensions, retention, storage, call UX | Recording | Stay in **Recording** |

Neither product has a real superadmin tenants UI or email invites today — those
are greenfield suite surfaces.

## Identity / SSO (unchanged direction)

- One Keycloak realm (`ccc`) for the suite + all product clients.
- Clients (examples): `ccc-suite` (or rename from current portal client),
  `ccc-portal` / recording, `cloudcorefax-portal`.
- Webex IdP broker on Keycloak; redirect URI stays on the Keycloak host
  (`authdev…/realms/ccc/broker/webex/endpoint`).
- Product apps keep accepting the shared OIDC session; suite is just another
  public client with its own redirect URIs.

See [KEYCLOAK.md](./KEYCLOAK.md) for broker setup details.

## Implementation sequencing (notes only)

1. **Docs / DNS naming** — treat `dev.` as suite; stop calling it a recording
   alias in new work. Reserve prod names; no prod deploy.
2. **Suite SPA shell** — login + app cards + license panel (can start thin:
   hard-coded licensed apps from tenant claims/flags).
3. **Move recording UI** fully under `recorddev.` (tunnel + compose + OIDC
   redirects); `dev.` serves suite only.
4. **License model** — single source of truth for product entitlements (DB or
   claims); fax plan fields consolidate upward; recording gains entitlement.
5. **Lift provisioning APIs** — tenant/org/plan/user identity into a suite
   backend (or shared service both apps call); thin product settings tabs that
   deep-link to suite for org-level tasks.
6. **Production** — mirror hostnames without `dev` infix when ready
   (`portal` / `record` / `fax` / `auth`). Explicit cutover only.

## Non-goals (for now)

- Deploying or configuring `portal.cloudcorecollab.com` / production auth.
- Billing/Stripe checkout (license **display** and entitlement flags first).
- Merging recording and fax codebases — separate apps, shared identity + suite
  shell.
