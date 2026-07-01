# FreeSWITCH integration

Everything the [`ccc-freeswitch-docker`](https://github.com/jmetdev/ccc-freeswitch-docker)
container needs to feed CUCM BIB recordings into this portal. The FreeSWITCH
image itself stays generic — these files are layered on top only when the portal
is deployed alongside it.

## Contents

| Path | Installs to | Purpose |
|------|-------------|---------|
| `dialplan/cucm_bib.xml` | FreeSWITCH `runtime/config/dialplan/` | BIB recording dialplan (destination `1034`) that records near/far legs and calls the hooks |
| `autoload_configs/acl.conf.xml` | FreeSWITCH `runtime/config/autoload_configs/` | `cucm` ACL allowing the CCM cluster node IPs |
| `scripts/notify-recording.py` | mounted at `/usr/local/sbin` | POSTs `start`/`complete` to the portal ingest API |
| `scripts/bib-hangup-hook.py` | mounted at `/usr/local/sbin` | `execute_on_hangup` target: mix stereo, then notify |
| `scripts/bib-on-hangup.py` | mounted at `/usr/local/sbin` | Alternate hangup hook (uuid-based file naming) |
| `scripts/mix-bib-stereo.py` | mounted at `/usr/local/sbin` | Mixes near/far mono WAVs into a stereo WAV |
| `docker-compose.freeswitch.override.yml` | used with `-f` | Adds hook env + script mount to the FreeSWITCH service |

## How the hooks are wired

The dialplan (`cucm_bib.xml`) invokes:

- On answer: `python3 /usr/local/sbin/notify-recording.py start --json '<bib metadata>'`
- On hangup: `python3 /usr/local/sbin/bib-hangup-hook.py --refci <refci> --base <base>`

`notify-recording.py` reads two env vars (supplied by the override):

- `PORTAL_API_URL` — portal base URL, e.g. `http://127.0.0.1:8000` (it appends `/api/ingest/...`)
- `INGEST_TOKEN` — must match the portal's `INGEST_TOKEN` (sent as `X-Ingest-Token`)

Because FreeSWITCH uses host networking, `PORTAL_API_URL` points at `127.0.0.1`.

## Install (deploying next to FreeSWITCH)

Assuming the FreeSWITCH repo is at `/opt/ccc-freeswitch-docker` and this repo at
`/opt/recording-portal`:

```bash
cd /opt/ccc-freeswitch-docker

# 1. Config files (go through the /etc/freeswitch mount)
cp /opt/recording-portal/freeswitch/dialplan/cucm_bib.xml         runtime/config/dialplan/
cp /opt/recording-portal/freeswitch/autoload_configs/acl.conf.xml runtime/config/autoload_configs/

# 2. Hooks + env via the additive override
export PORTAL_FS_SCRIPTS=/opt/recording-portal/freeswitch/scripts
export PORTAL_API_URL=http://127.0.0.1:8000
export INGEST_TOKEN=<same secret as the portal .env>

docker compose \
  -f docker-compose.yml \
  -f /opt/recording-portal/freeswitch/docker-compose.freeswitch.override.yml \
  up -d

# 3. Load the new dialplan/ACL
docker exec freeswitch fs_cli -x reloadxml
```

Update the ACL/dialplan IPs in `autoload_configs/acl.conf.xml` and
`dialplan/cucm_bib.xml` to match your CUCM cluster node addresses.
