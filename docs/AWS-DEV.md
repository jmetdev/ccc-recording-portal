# AWS Dev Environment

The dev portal runs at **https://dev.cloudcorecollab.com** on AWS (account
`765366202604`, region `us-east-1`). Infrastructure is AWS CDK in [`infra/`](../infra).

## Architecture

```
                 Cloudflare DNS (apex cloudcorecollab.com)
                        │  NS delegation of dev.*
                        ▼
        Route53 zone dev.cloudcorecollab.com
         │                              │
  dev.cloudcorecollab.com        api-origin.dev.cloudcorecollab.com
         ▼                              ▼
    CloudFront ───/api/*──────────►  ALB (HTTPS) ──► ECS Fargate Spot (backend)
     │  default                                          │
     ▼                                                   ├─► Aurora Serverless v2 (PG16, isolated subnets)
    S3 web bucket (SPA, OAC)                             └─► S3 media bucket (presigned playback)

  Auth: Webex/Zoom OAuth + local users   |   Secrets: SSM SecureString + Aurora-managed Secrets Manager
```

- **No NAT gateway** (Fargate runs in public subnets with public IPs). **Fargate Spot**, single task.
- **Aurora Serverless v2** min **0 ACU** — auto-pauses when idle (backend uses `DB_POOL_MODE=nullpool`). Expect a ~15–30s cold resume on the first request after idle.
- FreeSWITCH is **not** in AWS. Recording ingest arrives over HTTPS via the v2 connector API.

## Access

```bash
aws sso login --profile dev          # SSO issuer d-90667774d2 / us-east-1
aws sts get-caller-identity --profile dev
```
CDK CLI: `infra/node_modules/.bin/cdk` (or `npx cdk`).

## Stacks

| Stack | Contents | Removal |
|---|---|---|
| `ccc-dev-network` | VPC, subnets (public + isolated), no NAT | — |
| `ccc-dev-data` | Aurora Sv2 + media bucket + DB secret | Aurora DESTROY (dev), media bucket RETAIN |
| `ccc-dev-ci` | ECR repo, GitHub OIDC provider, deploy role | RETAIN |
| `ccc-dev-app` | ECS/ALB/CloudFront/ACM/Route53 + web bucket | DESTROY (dev) |

Deploy manually (from `infra/`):
```bash
cdk deploy ccc-dev-network ccc-dev-data ccc-dev-ci -c stage=dev --profile dev
# app stack needs an image tag that exists in ECR (pushed by CI):
cdk deploy ccc-dev-app -c stage=dev -c imageTag=<tag> --profile dev
```

## Secrets

- **DB creds** — Aurora-managed Secrets Manager secret `ccc-dev-db`; ECS injects
  `DB_HOST/PORT/USER/PASSWORD` from it and the backend assembles the URLs.
- **App secrets** — SSM SecureString: `/ccc/dev/{jwt_secret,ingest_token,worker_token,admin_password}`.
  Rotate with `aws ssm put-parameter --name /ccc/dev/<x> --type SecureString --value <v> --overwrite --profile dev`
  then restart the service (`aws ecs update-service --force-new-deployment ...`).
- Retrieve the bootstrap admin password: `aws ssm get-parameter --name /ccc/dev/admin_password --with-decryption --profile dev --query Parameter.Value --output text`.

## CI/CD

[`.github/workflows/deploy-aws-dev.yml`](../.github/workflows/deploy-aws-dev.yml) runs on push to `main`
(paths `portal/**`, `infra/**`) or manual dispatch:

1. Assume `ccc-dev-github-deploy` via GitHub OIDC (no stored keys).
2. Build + push backend image to ECR (`:<sha>` and `:dev`).
3. `cdk deploy ccc-dev-app -c imageTag=<sha>`.
4. Build the SPA, `s3 sync` to the web bucket, invalidate CloudFront.
5. Smoke test `/api/health`; optional v2-ingest smoke if repo secret `SMOKE_CONNECTOR_TOKEN` is set.

The legacy on-prem workflow `deploy-portal-dev.yml` is untouched until cutover.

## Authentication

Users sign in through the platform running their calling — **Webex** or **Zoom** —
via server-side OAuth, plus **local** username/password accounts (break-glass/admin).
There is no Cognito. Each provider is enabled once its client id + secret are set to
real values in SSM (placeholders are `REPLACE_ME`).

### Register the provider apps (one shared app per provider)

**Webex** — developer.webex.com → *My Apps* → *Create an Integration*:
- Redirect URI: `https://dev.cloudcorecollab.com/api/auth/oauth/webex/callback`
- Scope: `spark:people_read` (reads `/people/me`: email + `orgId`)
- Copy the Client ID / Secret.

**Zoom** — marketplace.zoom.us → *Develop* → *Build App* → *OAuth* (user-managed):
- Redirect URL: `https://dev.cloudcorecollab.com/api/auth/oauth/zoom/callback`
- Scope: `user:read` (granular: `user:read:user` / `user_info:read`) for `/users/me`
- Copy the Client ID / Secret.

### Turn a provider on
```bash
aws ssm put-parameter --overwrite --type SecureString --profile dev \
  --name /ccc/dev/webex_client_id     --value '<client id>'
aws ssm put-parameter --overwrite --type SecureString --profile dev \
  --name /ccc/dev/webex_client_secret --value '<client secret>'   # same for zoom_*
# restart the backend so it picks up the new values:
CL=$(aws ecs list-clusters --profile dev --query "clusterArns[0]" --output text)
SV=$(aws ecs list-services --cluster "$CL" --profile dev --query "serviceArns[0]" --output text)
aws ecs update-service --cluster "$CL" --service "$SV" --force-new-deployment --profile dev
```
The login page shows a "Sign in with Webex/Zoom" button for each enabled provider
(driven by `GET /api/auth/sso/config` → `oauth_providers`).

### Tenant mapping (multi-tenant)
On first login a user is provisioned in the tenant whose `settings_json` matches the
provider org id, else the `default` tenant, with the `viewer` role. To bind a customer
org to a tenant, set `settings_json` → `{"webex_org_id": "..."}` or `{"zoom_account_id": "..."}`.

### Local users
Create via the admin API (used for the bootstrap `admin` and break-glass accounts):
`POST /api/admin/users` with a bearer token from `POST /api/auth/token`.

## Notes / gotchas

- The **web bucket moved** from data-stack to app-stack (to avoid a CloudFront-OAC
  cross-stack cycle). The first `cdk deploy ccc-dev-app` updates data-stack to drop
  the old empty `ccc-dev-web-*` and app recreates it with the same name.
- Origin-verify header (CloudFront→ALB) is deferred; the ALB is reachable directly
  but every route except `/api/health` requires auth. Add it when hardening prod.
- Cost target ~$30/mo: ALB is the fixed floor (~$16); Aurora/Fargate are near-zero when idle.
  Budget alerts at $30/$60/$100 and anomaly detection are configured.
