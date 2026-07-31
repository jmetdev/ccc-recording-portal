# WXC mode smoke checklist (HyeTech Network org)

Use after deploying portal + `ccc-connector-webex` on the VPS.

## Prerequisites

1. Portal tenant with `webex_org_id` matching the customer Webex org
2. Service App authorized in Control Hub (Settings → WXC setup shows **Authorized**)
3. `WEBEX_CONNECTOR_BACKEND=docker` and `WEBEX_CONNECTOR_IMAGE` set on the portal host
4. Click **Enable WXC connector** in Settings → WXC setup (no manual `deploy-connector-webex.sh`)

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
