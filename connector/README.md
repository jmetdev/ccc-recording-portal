# CCC CUCM Connector

On-prem edge stack that records CUCM Built-In-Bridge calls with FreeSWITCH and
pushes them to the cloud portal. Two containers, host networking:

- **freeswitch** — prebuilt image (`ghcr.io/jmetdev/ccc-freeswitch-docker`), records
  near/far BIB legs and calls the hook scripts baked into the image.
- **connector** — the app in `app/`: a local shim the FreeSWITCH hooks POST to
  (`/api/ingest/{start,complete,fail}`), which transcodes to M4A, computes
  waveform peaks, runs faster-whisper, and uploads to the portal's **v2** API
  (`/api/v2/ingest/...`) using the tenant's `ccck_` connector token.

## Install (customer host)

Create a connector in the portal (**Settings → Connectors → New connector**),
then run the one-liner it shows you:

```bash
curl -fsSL https://raw.githubusercontent.com/jmetdev/ccc-recording-portal/main/connector/install.sh \
  | sudo bash -s -- \
      --token   ccck_XXXXXXXX \
      --portal  https://dev.cloudcorecollab.com \
      --cucm-nodes 10.0.0.10,10.0.0.11
```

The installer installs Docker-CE, lays out `/opt/ccc-connector/{recordings,freeswitch,src}`,
writes the CUCM ACL from `--cucm-nodes`, downloads this bundle, writes `.env`
(with your token), and starts the stack. The connector shows as **Active** in the
portal once it heartbeats.

## Data flow

```
CUCM BIB --RTP--> FreeSWITCH --records WAV--> shared volume
   FreeSWITCH hooks --HTTP--> connector (:9000, v1-shaped)
   connector: ffmpeg m4a + peaks + whisper --HTTPS(ccck_)--> portal /api/v2/ingest
```

The connector spools work in SQLite (`/opt/ccc-connector/recordings/.connector/spool.db`)
so hook POSTs return instantly and uploads retry through network outages.

## FreeSWITCH image

The `freeswitch` service pulls a prebuilt image that must bake the BIB dialplan +
hook scripts from this repo's `freeswitch/`. Publish it from the
`ccc-freeswitch-docker` repo with the workflow in
[`freeswitch-publish.yml`](freeswitch-publish.yml). Only the CUCM ACL
(`acl.conf.xml`, per-tenant IPs) is mounted at runtime.

## Local test without CUCM

With the stack running you can exercise the pipeline by dropping a WAV into
`/opt/ccc-connector/recordings/` and POSTing the hooks the way FreeSWITCH would:

```bash
T=$(grep INGEST_TOKEN /opt/ccc-connector/src/.env | cut -d= -f2)
curl -s localhost:9000/api/ingest/start   -H "X-Ingest-Token: $T" -H 'content-type: application/json' \
  -d '{"refci":"test-1","near_addr":"1000","far_addr":"2000"}'
curl -s localhost:9000/api/ingest/complete -H "X-Ingest-Token: $T" -H 'content-type: application/json' \
  -d '{"refci":"test-1","files":{"stereo":"test.wav"},"duration_s":3}'
```
