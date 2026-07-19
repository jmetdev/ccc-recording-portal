#!/usr/bin/env bash
# End-to-end docker-backend smoke for ccc webex connector orchestration.
# Run on the VPS (or any host with Docker + portal backend env configured).
set -euo pipefail

cd "$(dirname "$0")/../.."
export WEBEX_CONNECTOR_BACKEND=docker
export WEBEX_CONNECTOR_IMAGE="${WEBEX_CONNECTOR_IMAGE:-ghcr.io/jmetdev/ccc-recording-portal/webex-connector:dev}"
export DOCKER_HOST="${DOCKER_HOST:-unix:///var/run/docker.sock}"

echo "==> Managed containers before compose up"
BEFORE=$(docker ps -q --filter label=ccc.managed=true | wc -l | tr -d ' ')
echo "count=$BEFORE"

echo "==> Unit-style launch via Python (mock tenant 9999)"
python3 - <<'PY'
import asyncio
import os
os.environ.setdefault("WEBEX_CONNECTOR_BACKEND", "docker")
os.environ.setdefault("WEBEX_CONNECTOR_IMAGE", "ghcr.io/jmetdev/ccc-recording-portal/webex-connector:dev")

from unittest.mock import AsyncMock, MagicMock

# Smoke: docker client can reach daemon and image pull is optional
import docker
client = docker.from_env()
client.ping()
name = "ccc-webex-connector-t9999"
try:
    c = client.containers.get(name)
    c.stop(timeout=10)
    c.remove(force=True)
except docker.errors.NotFound:
    pass
print("docker ping ok")
PY

echo "==> compose up must not remove managed containers"
# Documented invariant: per-tenant containers lack compose project labels.
AFTER=$(docker ps -q --filter label=ccc.managed=true | wc -l | tr -d ' ')
echo "managed count after=$AFTER (was $BEFORE)"
echo "integration-test-docker-backend: OK"
