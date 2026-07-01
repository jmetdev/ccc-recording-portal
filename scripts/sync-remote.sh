#!/usr/bin/env bash
# Sync portal to remote host and rebuild containers.
set -euo pipefail

REMOTE="${REMOTE:-hyetech@172.25.100.83}"
REMOTE_DIR="${REMOTE_DIR:-/opt/ccc-recording-portal}"
FS_RECORDINGS="${FS_RECORDINGS:-/home/hyetech/ccc-freeswitch-docker/runtime/recordings}"

ssh "$REMOTE" bash -s <<EOF
set -euo pipefail
cd "$REMOTE_DIR"
git pull --ff-only origin main

# Ensure split-repo env vars are set (not commented out).
if grep -q '^#.*RECORDINGS_HOST_PATH' .env 2>/dev/null || ! grep -q '^RECORDINGS_HOST_PATH=' .env 2>/dev/null; then
  grep -v '^RECORDINGS_HOST_PATH=' .env | grep -v '^# RECORDINGS_HOST_PATH' > .env.tmp || true
  echo "RECORDINGS_HOST_PATH=$FS_RECORDINGS" >> .env.tmp
  mv .env.tmp .env
fi
if grep -q '^#.*FREESWITCH_FS_CLI' .env 2>/dev/null || ! grep -q '^FREESWITCH_FS_CLI=' .env 2>/dev/null; then
  grep -v '^FREESWITCH_FS_CLI=' .env | grep -v '^# FREESWITCH_FS_CLI' > .env.tmp || true
  echo "FREESWITCH_FS_CLI=docker exec freeswitch fs_cli" >> .env.tmp
  mv .env.tmp .env
fi

docker compose up -d --build
docker compose --profile whisper up -d --build whisper

docker ps --filter name='portal\|freeswitch' --format 'table {{.Names}}\t{{.Status}}'
curl -sf http://localhost:8001/api/health
echo
docker logs portal-whisper --tail 5 2>&1 || true
EOF
