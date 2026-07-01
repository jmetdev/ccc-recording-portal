# Split-repo deployment (FreeSWITCH + Recording Portal)

Use **two repos on one host**. FreeSWITCH is shared across projects; the recording portal is independent.

## Layout on the server

```
/opt/ccc-freeswitch-docker/     # SIP/RTP — one container, many dialplan projects
  docker-compose.yml
  runtime/
    config/                     # dialplan, ACLs, gateways
    recordings/                 # WAV files (shared with portal)
  scripts/                      # notify-recording.py, bib-hangup-hook.py, mix-bib-stereo.py
  config/dialplan/cucm_bib.xml  # copy/sync into runtime/config/dialplan/

/opt/recording-portal/          # this portal stack (ccc-recording-portal repo)
  docker-compose.yml            # portal services
  portal/backend|frontend|media-handler|whisper/
  .env
```

## Contract between repos

| Item | FreeSWITCH repo | Portal repo |
|------|-----------------|-------------|
| Recordings files | Writes WAV to `runtime/recordings` | Reads same path via `RECORDINGS_HOST_PATH` |
| Ingest hooks | `scripts/` mounted at `/usr/local/sbin` | Exposes `POST /api/ingest/*` on host port |
| Auth token | `PORTAL_INGEST_TOKEN` in FS `.env` | Same value as `INGEST_TOKEN` in portal `.env` |
| Network | `network_mode: host` | Publishes `8000` (API) and `5173` (UI) on localhost |

FreeSWITCH uses **host networking**, so hooks call `http://127.0.0.1:8000/api/ingest/...` (not a Docker service name).

## 1. Deploy FreeSWITCH (once per host)

```bash
ssh user@172.25.100.83
sudo mkdir -p /opt/ccc-freeswitch-docker
cd /opt/ccc-freeswitch-docker

git clone <ccc-freeswitch-docker-url> .
cp .env.example .env   # if present; set IMAGE/TAG as needed

mkdir -p runtime/{config,logs,recordings,fax}

# Seed dialplan (first time or after updates)
cp config/dialplan/cucm_bib.xml runtime/config/dialplan/

docker compose up -d --build
docker exec freeswitch fs_cli -x "reloadxml"
```

In FreeSWITCH `.env` (or compose overrides):

```env
PORTAL_INGEST_URL=http://127.0.0.1:8000/api/ingest
PORTAL_INGEST_TOKEN=<same-secret-as-portal-INGEST_TOKEN>
```

## 2. Deploy Recording Portal (separate repo)

Clone the `ccc-recording-portal` repo to `/opt/recording-portal`. Its
`docker-compose.yml` defines the portal services.

```bash
git clone <ccc-recording-portal-url> /opt/recording-portal
cd /opt/recording-portal
cp .env.example .env
```

Edit `.env`:

```env
POSTGRES_PASSWORD=<strong-password>
JWT_SECRET=<32+-char-secret>
INGEST_TOKEN=<same-as-PORTAL_INGEST_TOKEN>
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

## 3. What lives where (the two repos)

**`ccc-freeswitch-docker`:**

- `docker-compose.yml` (freeswitch service only)
- `config/dialplan/cucm_bib.xml`
- `scripts/notify-recording.py`, `bib-on-hangup.py`, `bib-hangup-hook.py`, `mix-bib-stereo.py`
- SIP profiles, ACLs, gateways for all projects

**`ccc-recording-portal` (this repo):**

- `portal/backend/`, `portal/frontend/`, `portal/media-handler/`, `portal/whisper/`
- `docker-compose.yml` (portal services)
- Portal `.env.example`, README

You do **not** need to rebuild the FreeSWITCH image when updating the portal — only restart portal containers.

## 4. Updates

```bash
# Portal only
cd /opt/recording-portal && git pull
docker compose up -d --build

# FreeSWITCH config/dialplan only (no rebuild)
cd /opt/ccc-freeswitch-docker
cp config/dialplan/cucm_bib.xml runtime/config/dialplan/
docker exec freeswitch fs_cli -x "reloadxml"

# FreeSWITCH image upgrade
docker compose pull && docker compose up -d
```

## 5. Firewall / access

- **SIP/RTP:** host ports (FreeSWITCH host network)
- **Portal UI:** open `5173` (or put nginx on 443 in front)
- **API:** keep `8000` on localhost only; do not expose ingest endpoints publicly
- **Postgres `5432`:** localhost only unless you need external DB access

## 6. Multiple projects on one FreeSWITCH

Add dialplan contexts/extensions per project under `config/dialplan/`. Only BIB recording needs the portal hooks and `scripts/`. Other trunks/projects share the same container without the portal stack.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| No calls in portal | `PORTAL_INGEST_TOKEN` == `INGEST_TOKEN`; backend on `:8000`; FS logs for `notify-recording` |
| Recordings empty in UI | `RECORDINGS_HOST_PATH` points at FS `runtime/recordings`; files exist after test call |
| M4A never appears | `portal-media-handler` logs; WAV readable in shared volume |
| 403 on BIB | ACL in `cucm_bib.xml` matches CUCM source IPs |
