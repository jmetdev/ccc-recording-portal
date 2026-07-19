# AWS dev decommission checklist (owner executes after VPS soak)

Execute **after** VPS cutover is accepted and both `deploy-vps-dev.yml` workflows
are green with `require_public_smoke: true`.

## 1. Tear down per-tenant AWS runtime resources

Via each product UI or API, disable every provisioned per-tenant connector/gateway
so ALB rules, ECS services, and SSM params are cleaned up by the app teardown code.

## 2. CDK destroy (us-east-1, account 765366202604)

**ccc-recording-portal** (`infra/`):

```bash
npx cdk destroy ccc-dev-app ccc-dev-webex-connector ccc-dev-keycloak \
  ccc-dev-ci ccc-dev-data ccc-dev-network -c stage=dev
```

**cloudcorefax** (`infra/`):

```bash
npx cdk destroy fax-dev-app fax-dev-gateway fax-dev-ci fax-dev-data -c stage=dev
```

## 3. Orphan cleanup

- ECR repositories (`ccc-*`, `fax-*`) if not removed by CDK
- SSM: `/ccc/dev/**`, `/fax/dev/**`
- Aurora clusters / snapshots
- S3 buckets (including RETAIN-policy leftovers)
- SES identities, receipt rules, inbound Lambda
- Route53 records / ACM certs for old ALBs
- CloudFront distributions (ccc SPA)

## 4. Demote AWS CI (optional, post-cutover)

In both repos, change `.github/workflows/deploy-aws-dev.yml` to
`workflow_dispatch` only (remove `push:` trigger).

## 5. Harden VPS

```bash
# As root on 162.35.179.243
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl reload sshd
```

Ongoing deploys use the `deploy` user + `VPS_SSH_KEY` only.
