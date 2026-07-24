# FreeSWITCH integration (CUCM BIB)

Everything needed to feed CUCM Built-In-Bridge recordings into the portal via
the on-prem connector. The FreeSWITCH **image** stays generic
(`ghcr.io/jmetdev/ccc-freeswitch-docker`) — BIB dialplan, ACL, and hooks are
layered on at install time. There is no separate CUCM/BIB FreeSWITCH repo.

## Preferred path: connector installer

Customer / lab hosts should use `connector/install.sh`, which:

- Pulls the shared FreeSWITCH image
- Renders `acl.conf.xml` + `dialplan/cucm_bib.xml` from `--cucm-nodes`
- Bind-mounts hook scripts from `freeswitch/scripts/`
- Overrides the ESL healthcheck and adds `SYS_NICE`

See [`connector/README.md`](../connector/README.md).

## Contents

| Path | Purpose |
|------|---------|
| `dialplan/cucm_bib.xml.template` | BIB dialplan template; `__CUCM_SRC_REGEX__` filled from `--cucm-nodes` |
| `dialplan/cucm_bib.xml` | Lab example only (hard-coded lab IPs) — do not ship to customers |
| `autoload_configs/acl.conf.xml` | Example ACL; installer regenerates per tenant |
| `scripts/*` | Lifecycle hooks (`bib-notify-*.sh`, mix, notify-recording) |
| `docker-compose.freeswitch.override.yml` | Legacy lab override when co-located with portal |

## How the hooks are wired

The rendered dialplan (`cucm_bib.xml`) invokes:

- Far-leg answer: `/usr/local/sbin/bib-notify-start.sh …`
- Far-leg hangup: `/usr/local/sbin/bib-notify-hangup.sh …` → `bib-hangup-hook.py`

Hooks read:

- `PORTAL_API_URL` — connector shim, e.g. `http://127.0.0.1:9000`
- `INGEST_TOKEN` — shared with the connector `.env`

## Manual lab overlay (optional)

Only if you are not using `connector/install.sh`:

```bash
# Render dialplan for your CUCM nodes (example)
REGEX='^(172\.25\.100\.10|172\.25\.100\.11)$'
sed "s|__CUCM_SRC_REGEX__|${REGEX}|g" \
  dialplan/cucm_bib.xml.template > /path/to/runtime/dialplan/cucm_bib.xml
```

Then mount scripts via `docker-compose.freeswitch.override.yml` and `reloadxml`.
