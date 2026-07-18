# Handoff — Webex Control Hub onboarding + cross-app SSO, deploy to AWS dev

**Repos:** `ccc-recording-portal` (this repo) and `cloudcorefax`
(`/Users/jmetcalf/Projects/cloudcorefax`), both on `main`, both with all
changes **uncommitted** in the working tree. Account `765366202604`,
region `us-east-1`, both apps share one VPC/ALB (`dev.cloudcorecollab.com`
and `fax.dev.cloudcorecollab.com`).

Full design doc: `/Users/jmetcalf/.claude/plans/i-need-to-get-validated-cupcake.md`
(has a STATUS section at the top with the same phase summary as below, plus
full design rationale for each phase).

## What this delivers

Automates Webex tenant onboarding via a Service App, correlates each
product's tenant_id with the customer's Webex org_id, syncs Webex Control Hub
groups into ccc-recording-portal's roles/permissions, and replaces each
product's shared multi-tenant gateway process with a genuinely isolated
per-tenant instance (own container, own credentials) for privacy. The code
also includes a locally verified Keycloak-brokered cross-app SSO design, but
the AWS dev deployment does not include Keycloak and therefore does not
enable cross-app SSO.

## State by phase

| Phase | Repo | What | Status |
|---|---|---|---|
| A | ccc-recording-portal | Tenant role-seeding fix + real `webex_org_id` column (migration 006) | done, verified against real DB |
| B | ccc-recording-portal | Owner/customer Webex docs | done |
| C | ccc-recording-portal | Service App webhook onboarding (migration 007) | done, verified live (real HMAC sig tests) |
| D | ccc-recording-portal | Cross-app SSO via Keycloak Webex broker | local implementation verified; **not deployed or enabled in AWS dev** because no AWS Keycloak service exists |
| E | ccc-recording-portal | Per-tenant isolated hosted Webex connector (migration 008) | done, verified (moto-mocked AWS round-trip); **recording-retrieval logic is a stub** pending a live-org API spike |
| F | ccc-recording-portal | Control Hub group→role sync (migration 009) | done, verified against real DB with a **stubbed** Webex client; **Groups API shape unvalidated** |
| G | cloudcorefax | Per-tenant isolated FreeSWITCH gateway (migration 008) | done, verified (moto + a live two-tenant cross-tenant-isolation attack test against the running app) |

Everything above compiles/typechecks clean and CDK synths clean as of this
handoff (re-verify with the commands in "Pre-deploy checks" below — don't
trust this table blindly if time has passed).

## What changed just now, to make this handoff possible

Two real deployment blockers were found and fixed while preparing this
handoff (not part of the original phase work, discovered by re-reading the
CI/CD paths with a "will this actually deploy" lens):

1. **`infra/lib/webex-connector-stack.ts` referenced an ECR repo that didn't
   exist** (`ecr.Repository.fromRepositoryName` assumes it's already there).
   Fixed: `infra/lib/ci-stack.ts` now also creates `ccc-webex-connector` and
   grants the deploy role push access to it.
2. **Neither CI workflow deployed the new stack or built its image.**
   `ccc-recording-portal`'s `.github/workflows/deploy-aws-dev.yml` now builds
   `./webex-connector` and deploys `ccc-dev-webex-connector` before
   `ccc-dev-app`. `cloudcorefax`'s workflow now includes `fax-dev-gateway` in
   its `cdk deploy` stack list (no new image needed there — `fax-gateway`
   reuses the existing `fax-freeswitch`/`fax-gateway-engine` images already
   built by that workflow).

Both fixed, typechecked, and synthed clean (see "Pre-deploy checks").

## One-time SSM prerequisites (must exist before the first deploy of this work)

### ccc-recording-portal — `/ccc/dev/` prefix

Referenced by `infra/lib/app-stack.ts`'s `secure()` calls; the ECS task fails
to start if these don't exist:

```bash
for p in webex_serviceapp_id webex_serviceapp_client_id webex_serviceapp_client_secret \
         webex_serviceapp_webhook_secret webex_serviceapp_org_token; do
  aws ssm put-parameter --region us-east-1 --type SecureString \
    --name "/ccc/dev/$p" --value "REPLACE_ME"
done

# CRYPTO_KEY must always be a valid Fernet key, even while Service App
# credentials are placeholders.
CRYPTO_KEY=$(python3 -c 'import base64,secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())')
aws ssm put-parameter --region us-east-1 --type SecureString \
  --name "/ccc/dev/crypto_key" --value "$CRYPTO_KEY"
```

Placeholders are fine for the five `webex_serviceapp_*` parameters — everything gated on these
(`webex_serviceapp.serviceapp_enabled()`) is a no-op until real values are
set. Real values come from registering the Service App per
`docs/webex-service-app.md` (separate from the Keycloak/SSO Webex OAuth
Integration — these are two different Webex app registrations, don't
conflate them).

The `webex-connector` cluster/task-def/subnet/SG identifiers are **not**
manual SSM params — they're CDK outputs from the new `WebexConnectorStack`,
wired automatically into the backend's plain (non-secret) environment
variables in `app-stack.ts`.

### cloudcorefax — `/fax/dev/` prefix

No **new** SSM params for Phase G itself (it reuses the existing
`connector_token`/`trunk_encryption_key` pattern — `ConnectorCredential` rows
are created per-tenant at runtime, not via SSM). If Phase C-equivalent
Service App params for cloudcorefax aren't already set from the earlier
Phase 2 work, confirm they exist (`webex_serviceapp_*`, per
`cloudcorefax/docs/webex-service-app.md`) — unrelated to this session's
changes but on the same deploy path.

## Deploy sequence

Both repos' CI workflows trigger on push to `main` (or `workflow_dispatch`).
Push `cloudcorefax` and `ccc-recording-portal` **in either order** — they're
independent deployments, not coupled at deploy time (only coupled by the
shared `webex_org_id` convention at the data layer, which requires no
deploy-time ordering).

**ccc-recording-portal**: `deploy-aws-dev.yml` now does, in order: build+push
backend image → build+push `webex-connector` image → `cdk deploy
ccc-dev-webex-connector` → `cdk deploy ccc-dev-app` → publish SPA → smoke
test. Migrations 006→009 run automatically via the backend's Docker CMD
(`alembic upgrade head && uvicorn ...`), same single-task/`minHealthyPercent:
0` pattern as before — no migration race.

**cloudcorefax**: `deploy-aws-dev.yml` now does: validate FreeSWITCH XML →
build+push all 3 images → `cdk deploy fax-dev-data fax-dev-gateway
fax-dev-app` → publish SPA → smoke test. Migration 008
(`per_tenant_fax_gateway`) runs automatically the same way.

## Pre-deploy checks (re-run these — don't skip)

```bash
# ccc-recording-portal
cd /Users/jmetcalf/Projects/ccc-recording-portal/portal/backend && python3 -m compileall -q app/
cd /Users/jmetcalf/Projects/ccc-recording-portal/portal/frontend && npm run build
cd /Users/jmetcalf/Projects/ccc-recording-portal/infra && npx tsc --noEmit -p . && \
  npx cdk synth ccc-dev-network ccc-dev-data ccc-dev-ci ccc-dev-webex-connector ccc-dev-app -c stage=dev

# cloudcorefax
cd /Users/jmetcalf/Projects/cloudcorefax/portal/backend && python3 -m compileall -q app/
cd /Users/jmetcalf/Projects/cloudcorefax/infra && npx tsc --noEmit -p . && \
  npx cdk synth fax-dev-data fax-dev-ci fax-dev-gateway fax-dev-app -c stage=dev
```

All of the above were run clean immediately before writing this doc — if
they still pass, the CDK/build side is solid; what's actually unverified is
API-shape correctness against live Webex (see below).

## After the push — verify

- Watch both Actions runs to green.
- `curl https://dev.cloudcorecollab.com/api/health` and
  `curl https://fax.dev.cloudcorecollab.com/api/health` → `{"status":"ok"}`.
- ccc-recording-portal: Settings → **Webex setup** tab renders, shows
  "Service App isn't configured" until real Service App creds are set;
  **Group sync** tab renders.
- Cross-app SSO is not an AWS-dev acceptance criterion for this deploy;
  `OIDC_ENABLED=false` remains intentional until Keycloak is deployed there.
- CloudWatch: confirm `alembic ... Running upgrade ... -> 009` (portal) and
  `... -> 008` (cloudcorefax) in each API container's log group, no RLS
  errors.
- Create a trunk in cloudcorefax (Settings → Trunks) and confirm a
  `fax_gateway_instances` row appears with `status` progressing toward
  `running` (poll `/api/trunks` or query the DB — no status-check UI was
  built for this, only the backend service functions
  `refresh_tenant_gateway_status`/`get_instance`).

## Rollback

Same pattern as the existing CloudCoreFax Phase 2 handoff
(`cloudcorefax/docs/HANDOFF-phase2.md`): re-push/`workflow_dispatch` an
earlier commit to redeploy that image tag. Migrations don't auto-downgrade.
**New consideration for this work**: rolling back past migration 008 in
either repo while any `webex_connector_instances`/`fax_gateway_instances`
rows exist would orphan real running ECS services/SSM params for those
tenants — run `teardown_tenant_connector`/`teardown_tenant_gateway` (or their
API-facing equivalents, `POST /tenant/webex/connector/disable` in
ccc-recording-portal) for any provisioned tenants before rolling back that far.

## Outstanding — needs the account owner, not more code

1. **Real Webex Service App credentials** (ccc-recording-portal) — separate
   from the SSO OAuth Integration already configured. Register per
   `docs/webex-service-app.md`, put real values in the 5 `/ccc/dev/
   webex_serviceapp_*` SSM params above, and retain the generated Fernet
   `crypto_key` (changing it later would make stored tokens unreadable).
2. **Groups API live-org spike** (Phase F) — `webex_serviceapp.
   list_group_members`/`list_org_groups` are written defensively but
   unvalidated. Confirm the real Webex Groups API shape/scope against a live
   Control Hub org before trusting Phase F in production.
3. **Recording-retrieval API spike** (Phase E) — `webex-connector/app/
   main.py`'s `_fetch_and_ingest_recording` is a stub. Confirm whether
   Webex's Compliance Recording API (or a different mechanism entirely,
   possibly requiring a separate partner-approved app type) is the right
   integration point before implementing it for real.
4. **Live fax smoke test** (Phase G) — provision a real trunk against the new
   per-tenant `fax-gateway` service and confirm SIP registration + an actual
   T.38/G.711 fax both directions, matching the quality of the previous
   shared-gateway path.
5. **Retire `core/oauth.py`'s direct Webex OAuth exchange** (ccc-recording-
   portal) once the Keycloak-brokered SSO path (Phase D) is confirmed working
   end-to-end for a real user login — both paths currently coexist.
6. **CloudCoreFax needs its own OIDC bearer-token verifier** (no
   `core/oidc.py`-equivalent exists there yet) before it can actually consume
   tokens issued by its new `cloudcorefax-portal` Keycloak client. Separate,
   fairly small task in that repo.

## Local dev state (informational, not required for deploy)

A local Keycloak is running (`docker compose --profile sso up -d keycloak`,
port 8180, admin `admin`/`DevAdmin!2026`) with the `ccc` realm, both clients,
the Webex broker (real client ID now configured, per the account owner), the
`webex_org_id` claim mapper, and the custom `ccc` login theme — all verified
live. This is dev-local tooling (`keycloak/setup-realm.sh` reproduces it
idempotently); it has no bearing on the AWS dev deploy, which doesn't run
Keycloak — SSO in AWS dev would need its own Keycloak deployment, not covered
by this session's work (out of scope; the bundled Keycloak here was for
local verification of the Phase D design only).
