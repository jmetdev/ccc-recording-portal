# VPS dev environment (162.35.179.243)

Replaces AWS ECS/Aurora dev with Docker Compose on a single VPS. HTTP ingress
via Cloudflare tunnel; SIP/RTP use the VPS public IP directly.

## CI/CD (self-hosted runners — no SSH deploy)

Two GitHub Actions runners run as `deploy` on this host:

| Runner | Repo | Labels |
|--------|------|--------|
| `vps-dev-ccc` | `jmetdev/ccc-recording-portal` | `self-hosted`, `vps-dev` |
| `vps-dev-fax` | `jmetdev/cloudcorefax` | `self-hosted`, `vps-dev` |

Workflows use `runs-on: [self-hosted, vps-dev]`:

- **ccc** `deploy-vps-dev.yml` — build backend/frontend/media-handler/keycloak/webex-connector → GHCR → compose up
- **fax** `deploy-vps-dev.yml` — build api/frontend only → GHCR → compose up (does **not** touch FreeSWITCH)
- **fax** `deploy-vps-gateway.yml` — sync mounted FreeSWITCH conf + `reloadxml` (optional rebuild via `workflow_dispatch`)

Reinstall runners: `deploy/vps/install-actions-runners.sh` (as root).

## Bootstrap (once, as root)

Generate the deploy SSH key **on your laptop** (never on the VPS):

```bash
ssh-keygen -t ed25519 -f deploy_ed25519 -N "" -C "ccc-vps-deploy"
```

Add `deploy_ed25519` (private) to GitHub Actions secret `VPS_SSH_KEY` in both
`ccc-recording-portal` and `cloudcorefax`.

```bash
VPS_DEPLOY_PUBLIC_KEY="$(cat deploy_ed25519.pub)" \
  ssh root@162.35.179.243 'bash -s' < deploy/vps/bootstrap.sh
```

Pin the host key for CI:

```bash
ssh-keyscan -H 162.35.179.243 >> deploy/vps/known_hosts
git add deploy/vps/known_hosts && git commit -m "Pin VPS host key"
```

As `deploy`:

```bash
docker login ghcr.io -u jmetdev --password-stdin   # fine-scoped read:packages PAT
```

Use a PAT with **read:packages** only; set a calendar reminder to rotate it.

## App layout

| Path | Contents |
|------|----------|
| `/opt/ccc-recording-portal/.env` | Secrets (chmod 600, deploy-owned). See `deploy/.env.vps.example`. |
| `/opt/ccc-recording-portal/.env.deploy` | `IMAGE_TAG=sha-…` — written by CI only. |
| `/opt/ccc-recording-portal/docker-compose.yml` | Copied from `deploy/docker-compose.vps.yml` by CI. |
| `/opt/cloudcorefax/` | Same pattern for fax app. |

## Security notes

- **Docker socket**: API containers talk to `docker-proxy` (tecnativa/docker-socket-proxy), not the raw host socket.
- **Per-tenant fax gateways** use `network_mode: host` with port slots — port-isolated for dev, not network-namespace isolated. Do not treat this as production multi-tenant isolation.
- **Per-tenant connector secrets** live in container env on dev (documented trade-off).
- After cutover: `PermitRootLogin prohibit-password` and use `deploy` only.

## Firewall (ufw)

- `22/tcp` — SSH
- `5080:5241/tcp` — SIP/TLS (fax slots 0–15)
- `16384:32767/udp` — RTP
- No inbound 80/443 (Cloudflare tunnel egresses outbound)

## Cloudflare tunnel

Flat hostnames under `*.cloudcorecollab.com` (Universal SSL — no nested
`*.dev.*`):

| Hostname | Service |
|----------|---------|
| `recorddev.cloudcorecollab.com` | Recording portal `:8081` |
| `dev.cloudcorecollab.com` | Same (alias) |
| `faxdev.cloudcorecollab.com` | Fax portal `:8082` |
| `authdev.cloudcorecollab.com` | Keycloak `:8180` |

See `cloudflared-config.example.yml`. Frontend nginx proxies `/t/*/webhook`
to per-tenant connector containers.

## Integration tests (Phase K)

On the VPS or any host with Docker:

```bash
./deploy/vps/integration-test-docker-backend.sh
```

## AWS decommission

After VPS soak: `deploy/vps/aws-decommission.md` (owner executes).
