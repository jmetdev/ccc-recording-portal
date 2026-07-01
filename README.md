# ccc-recording-portal

Control Hub-style web portal for CUCM BIB call recordings. It ingests call
metadata from FreeSWITCH hangup hooks, transcodes WAV to stereo M4A, and
provides search, playback, tagging, and optional transcription.

This is the **application** repo. The SIP/RTP side (FreeSWITCH image, dialplan,
ACLs, ingest hook scripts) lives in the separate
[`ccc-freeswitch-docker`](https://github.com/jmetdev/ccc-freeswitch-docker) repo.
The two are deployed together on one host and communicate over the ingest API.
See [docs/DEPLOY-SPLIT-REPOS.md](docs/DEPLOY-SPLIT-REPOS.md) for the full
split-repo deployment guide.

## Stack

| Service | Port | Purpose |
|---------|------|---------|
| `portal-db` | 5432 | Postgres 16 + pgvector |
| `portal-backend` | 8000 | FastAPI REST + WebSocket (auth, ingest, calls, streaming) |
| `portal-frontend` | 5173 | React + Mantine + Momentum tokens |
| `portal-media-handler` | — | ffmpeg WAV→M4A + waveform peaks |
| `portal-whisper` | — | Optional faster-whisper + sentiment (compose profile) |

## Quick start

```bash
cp .env.example .env
# Edit secrets: JWT_SECRET, INGEST_TOKEN, WORKER_TOKEN, POSTGRES_PASSWORD

# Start portal stack (Postgres, API, frontend, media-handler)
docker compose up -d --build
```

- **Frontend:** http://localhost:5173
- **API docs:** http://localhost:8000/docs
- **Default login:** `admin` / `admin123` (from `ADMIN_PASSWORD`)

### Optional Whisper transcription

```bash
docker compose --profile whisper up -d --build whisper
```

## Ingest hooks (contract with FreeSWITCH)

The FreeSWITCH container runs hangup hooks that POST call metadata to this
portal. Set matching tokens on both sides:

- Portal `.env`: `INGEST_TOKEN=<secret>`
- FreeSWITCH `.env`: `PORTAL_INGEST_TOKEN=<same secret>`

Hooks POST to (header `X-Ingest-Token: <INGEST_TOKEN>`):

- `POST /api/ingest/start` — call enters `recording` state
- `POST /api/ingest/complete` — registers near/far/stereo WAVs, enqueues media jobs

Recordings are read from the shared host directory set by `RECORDINGS_HOST_PATH`,
which must point at the FreeSWITCH repo's `runtime/recordings`.

## Development

```bash
# Backend locally (requires Postgres)
cd portal/backend && pip install -r requirements.txt
export DATABASE_URL=postgresql+asyncpg://portal:portal@localhost:5432/portal
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# Frontend locally
cd portal/frontend && npm install && npm run dev
```

## License

GPL-3.0
