# Split-repo deployment (FreeSWITCH + Recording Portal)

Two repos on one host:

- **`ccc-freeswitch-docker`** — generic, reusable FreeSWITCH image + base config. No portal-specific code.
- **`ccc-recording-portal`** — the portal app **and** its FreeSWITCH integration (`freeswitch/`), layered onto FreeSWITCH at deploy time.

## Layout on the server

```
/opt/ccc-freeswitch-docker/     # SIP/RTP — generic, shared across projects
  docker-compose.yml
  runtime/
    config/                     # /etc/freeswitch (dialplan, ACLs, gateways)
    recordings/                 # WAV files (shared with portal)

/opt/recording-portal/          # ccc-recording-portal repo
  docker-compose.yml            # portal services
  portal/backend|frontend|media-handler|whisper/
  freeswitch/                   # BIB integration copied/mounted into FreeSWITCH
    dialplan/cucm_bib.xml
    autoload_configs/acl.conf.xml
    scripts/*.py
    docker-compose.freeswitch.override.yml
  .env
```

## Contract between repos

| Item | FreeSWITCH side | Portal side |
|------|-----------------|-------------|
| Recordings files | Writes WAV to `runtime/recordings` | Reads same path via `RECORDINGS_HOST_PATH` |
| Ingest hooks | Portal `freeswitch/scripts` mounted at `/usr/local/sbin` (via override) | Exposes `POST /api/ingest/*` on host port |
| Hook config | `PORTAL_API_URL`, `INGEST_TOKEN` passed by the override | `INGEST_TOKEN` in portal `.env` (same value) |
| Dialplan / ACL | Portal `freeswitch/dialplan` + `autoload_configs` copied into `runtime/config` | Owned/versioned in the portal repo |
| Network | `network_mode: host` | Publishes `8000` (API) and `5173` (UI) on localhost |

FreeSWITCH uses **host networking**, so hooks call `http://127.0.0.1:8000/api/ingest/...`.

## 1. Deploy FreeSWITCH (generic, once per host)

```bash
ssh user@172.25.100.83
sudo mkdir -p /opt/ccc-freeswitch-docker
cd /opt/ccc-freeswitch-docker

git clone <ccc-freeswitch-docker-url> .
cp .env.example .env   # set IMAGE/TAG/FREESWITCH_VERSION as needed

mkdir -p runtime/{config,logs,recordings,fax}

docker compose up -d --build
docker exec freeswitch fs_cli -x "status"
```

## 2. Deploy Recording Portal

```bash
git clone <ccc-recording-portal-url> /opt/recording-portal
cd /opt/recording-portal
cp .env.example .env
```

Edit `.env`:

```env
POSTGRES_PASSWORD=<strong-password>
JWT_SECRET=<32+-char-secret>
INGEST_TOKEN=<shared-with-freeswitch-hooks>
WORKER_TOKEN=<worker-secret>

# Absolute path to FreeSWITCH recordings (critical for split repos)
RECORDINGS_HOST_PATH=/opt/ccc-freeswitch-docker/runtime/recordings

BACKEND_PORT=8000
FRONTEND_PORT=5173
CORS_ORIGINS=http://172.25.100.83:5173,http://localhost:5173
```

```bash
docker compose up -d --build

# Optional transcription
docker compose --profile whisper up -d --build whisper
```

Verify:

```bash
curl http://127.0.0.1:8000/api/health
# UI: http://<server-ip>:5173  (admin / password from ADMIN_PASSWORD)
```

## 3. Wire the portal into FreeSWITCH (BIB integration)

The portal ships the FreeSWITCH integration under `freeswitch/`. Install it onto
the generic FreeSWITCH deployment (see `freeswitch/README.md` for detail):

```bash
cd /opt/ccc-freeswitch-docker

# Config files (go through the /etc/freeswitch mount)
cp /opt/recording-portal/freeswitch/dialplan/cucm_bib.xml         runtime/config/dialplan/
cp /opt/recording-portal/freeswitch/autoload_configs/acl.conf.xml runtime/config/autoload_configs/

# Hooks + env via the additive override
export PORTAL_FS_SCRIPTS=/opt/recording-portal/freeswitch/scripts
export PORTAL_API_URL=http://127.0.0.1:8000
export INGEST_TOKEN=<same secret as the portal .env>

docker compose \
  -f docker-compose.yml \
  -f /opt/recording-portal/freeswitch/docker-compose.freeswitch.override.yml \
  up -d

docker exec freeswitch fs_cli -x "reloadxml"
```

Update the CUCM node IPs in `cucm_bib.xml` and `acl.conf.xml` to match your cluster.

## 4. What lives where

**`ccc-freeswitch-docker` (generic):**

- `docker-compose.yml` (freeswitch service only), Dockerfile, base config
- SIP profiles, base dialplan, gateways for all projects

**`ccc-recording-portal`:**

- `portal/backend|frontend|media-handler|whisper/` + `docker-compose.yml`
- `freeswitch/` — BIB dialplan, ACL, hook scripts, and the compose override

You do **not** rebuild the FreeSWITCH image when updating the portal.

## 5. Updates

```bash
# Portal app only
cd /opt/recording-portal && git pull
docker compose up -d --build

# Portal FreeSWITCH integration changed (dialplan/ACL/scripts)
cd /opt/recording-portal && git pull
cp freeswitch/dialplan/cucm_bib.xml         /opt/ccc-freeswitch-docker/runtime/config/dialplan/
cp freeswitch/autoload_configs/acl.conf.xml /opt/ccc-freeswitch-docker/runtime/config/autoload_configs/
docker exec freeswitch fs_cli -x "reloadxml"   # scripts are live-mounted, no restart needed

# FreeSWITCH image upgrade
cd /opt/ccc-freeswitch-docker && docker compose pull && docker compose up -d
```

## 6. Firewall / access

- **SIP/RTP:** host ports (FreeSWITCH host network)
- **Portal UI:** open `5173` (or put nginx on 443 in front)
- **API:** keep `8000` on localhost only; do not expose ingest endpoints publicly
- **Postgres `5432`:** localhost only unless you need external DB access

## 7. Multiple projects on one FreeSWITCH

The FreeSWITCH image is generic. Only BIB recording needs the portal integration
(the `freeswitch/` override + config). Other trunks/projects share the same
container without the portal stack.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| No calls in portal | `INGEST_TOKEN` matches on both sides; `PORTAL_API_URL` reachable; FS logs for `notify-recording` |
| Recordings empty in UI | `RECORDINGS_HOST_PATH` points at FS `runtime/recordings`; files exist after test call |
| M4A never appears | `portal-media-handler` logs; WAV readable in shared volume |
| 403 on BIB | ACL in `acl.conf.xml` / IP condition in `cucm_bib.xml` matches CUCM source IPs |
| Hooks not firing | `PORTAL_FS_SCRIPTS` mounted at `/usr/local/sbin`; `docker exec freeswitch ls /usr/local/sbin` |
