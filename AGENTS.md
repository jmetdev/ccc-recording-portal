# AGENTS.md

## Cursor Cloud specific instructions

This repo (`ccc-recording-portal`) is normally run via `docker compose` (see `README.md`),
but Docker is **not** available in the Cursor Cloud VM. Instead the stack runs **natively**
against a local PostgreSQL, with the Python/Node services started directly for hot reload.
The update script only refreshes dependencies; you must start Postgres and the services
yourself (details below).

### Services (dev mode, run natively)

| Service | How to run | Port | Notes |
|---|---|---|---|
| PostgreSQL 16 + pgvector | `sudo pg_ctlcluster 16 main start` | 5432 | Role `portal`/`portal` (SUPERUSER), DBs `portal` + `suite`. Installed system-wide; data + applied migrations persist in the VM snapshot. |
| portal backend (FastAPI) | `cd portal/backend && ../../.venv/bin/uvicorn app.main:app --reload --port 8000` | 8000 | Runs `bootstrap` on startup (seeds admin). Health: `GET /api/health`. |
| suite backend (FastAPI) | `cd suite/backend && ../../.venv/bin/uvicorn app.main:app --port 8001` | 8001 | Identity/licensing service; portal backend calls it via `SUITE_API_URL`. |
| media-handler (worker) | `cd portal/media-handler && BACKEND_URL=http://localhost:8000 WORKER_TOKEN=local-dev-worker-token RECORDINGS_DIR=/workspace/runtime/recordings ../../.venv/bin/python worker.py` | — | Poller (no HTTP port). ffmpeg WAV→M4A + waveform peaks. Required for playable audio. |
| frontend (Vite dev) | `cd portal/frontend && VITE_API_URL=http://localhost:8000 npm run dev -- --host 0.0.0.0` | 3000 | See gotcha below about the port and proxy target. |

The shared Python virtualenv is at `/workspace/.venv` (backend + suite + media-handler deps, plus `pytest`).

### Non-obvious gotchas

- **Vite dev server listens on port 3000, not 5173.** 5173 is the docker/nginx *production* port. In dev, open `http://localhost:3000`.
- **You must set `VITE_API_URL=http://localhost:8000`** for the frontend. The Vite `/api` proxy defaults to `http://localhost:8080` (wrong port), so login fails without this override. `/suite-api` already defaults to `:8001`.
- **Login endpoint is `POST /api/auth/token`** (OAuth2 password form: `username`+`password` form fields), not `/api/auth/login`. Default admin: `admin` / `admin123`.
- **Local env lives in `portal/backend/.env` and `suite/backend/.env`** (both gitignored). Pydantic settings read `.env` from the process CWD, so run uvicorn from each service dir. These point `DATABASE_URL*` at `localhost:5432` (the committed defaults use the docker hostname `db`).
- **pgvector is required at migration time** (`CREATE EXTENSION vector` + a `Vector(384)` column). The `portal` role is a SUPERUSER so `alembic upgrade head` can create the extension.
- **Recordings dir is `/workspace/runtime/recordings`** (gitignored). Ingest requests need header `X-Ingest-Token: local-dev-ingest-token` (matches `INGEST_TOKEN`).
- In dev, `RETENTION_SWEEP_INTERVAL_S=0` and `GROUP_SYNC_INTERVAL_S=0` in `portal/backend/.env` disable noisy background loops; unset them to exercise those features.
- Migrations already applied to the snapshot DB. To re-run from scratch: `../../.venv/bin/alembic upgrade head` in `portal/backend` and `suite/backend`.

### Lint / test / build

- Backend tests: `cd portal/backend && ../../.venv/bin/python -m pytest tests/` (mock-only, no DB needed).
- Frontend type-check + build: `cd portal/frontend && npm run build` (`tsc -b && vite build`).
- There is no repo-wide Python linter (no ruff/flake8/mypy config) and no ESLint config; CI only builds Docker images + deploys (`.github/workflows/`).

### End-to-end smoke (ingest → transcode → playback)

Drop a 16-bit PCM WAV under `runtime/recordings/...`, then `POST /api/ingest/start` and
`POST /api/ingest/complete` (with `X-Ingest-Token`) referencing the file. The media-handler
transcodes it to M4A and the call appears (status `completed`) in the Recordings UI with a
playable dual-channel waveform. See `scripts/smoke-v2-ingest.py` for the v2 (connector) path.
