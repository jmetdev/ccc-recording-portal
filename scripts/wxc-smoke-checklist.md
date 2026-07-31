# WXC mode smoke checklist (HyeTech Network org)

Use after deploying portal + `ccc-connector-webex` on the VPS.

## Prerequisites

1. Portal tenant with `webex_org_id` matching HyeTech Network org
2. Connector credential: Settings → Connectors → **WXC (Webex cloud)** → copy `ccck_...`
3. Webex Service App authorized with `spark-compliance:recordings_read` (or admin fallback)
4. `/data/tokens.json` seeded on connector host; `docker compose up -d --build`

## Ingest

- [ ] Connector logs show `cycle done` with `ingested >= 1` or `skipped_known` for replays
- [ ] Portal Health → connector heartbeat **healthy** (no SIP Switch / Whisper required)
- [ ] Recording appears with source **WXC**, playable MP3, VTT transcript
- [ ] Call has extractive **subject** / **summary** from VTT

## RBAC

Configure test users with roles: admin, team_viewer (group A), self_viewer.

- [ ] **self_viewer** with `user.email == call.near_addr` sees own WXC calls
- [ ] **team_viewer** sees calls whose `group_id` matches a group containing the recorded user / portal user
- [ ] **admin** sees all calls
- [ ] Owner email not in Recorded users → call in **holding** pool; adding recorded user releases it

## Recorded users

- [ ] Settings → Recorded users → add owner email + group
- [ ] Seat count increments in license card
- [ ] Holding calls for that email get `holding=false` and assigned `group_id`
