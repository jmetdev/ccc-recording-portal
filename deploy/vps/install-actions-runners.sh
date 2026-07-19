#!/usr/bin/env bash
# Install GitHub Actions self-hosted runners for VPS dev (as root).
# Creates two runners under /opt/actions-runners/{ccc,fax} owned by deploy.
#
# Usage (from laptop, with gh authenticated):
#   CCC_TOKEN=$(gh api -X POST repos/jmetdev/ccc-recording-portal/actions/runners/registration-token -q .token)
#   FAX_TOKEN=$(gh api -X POST repos/jmetdev/cloudcorefax/actions/runners/registration-token -q .token)
#   RUNNER_VERSION=$(gh api repos/actions/runner/releases/latest -q .tag_name | sed 's/^v//')
#   ssh root@162.35.179.243 \
#     "CCC_TOKEN=$CCC_TOKEN FAX_TOKEN=$FAX_TOKEN RUNNER_VERSION=$RUNNER_VERSION bash -s" \
#     < deploy/vps/install-actions-runners.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root." >&2
  exit 1
fi
: "${CCC_TOKEN:?Set CCC_TOKEN}"
: "${FAX_TOKEN:?Set FAX_TOKEN}"

RUNNER_VERSION="${RUNNER_VERSION:-2.335.1}"
ARCH=x64
BASE=/opt/actions-runners
USER_NAME=deploy

id "$USER_NAME" >/dev/null

install_runner() {
  local name=$1 url=$2 token=$3 labels=$4
  local dir="$BASE/$name"
  echo "==> Installing runner $name → $dir"
  mkdir -p "$dir"
  chown "$USER_NAME:$USER_NAME" "$dir"
  if [ ! -f "$dir/run.sh" ]; then
    curl -fsSL \
      "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-${ARCH}-${RUNNER_VERSION}.tar.gz" \
      -o /tmp/actions-runner.tgz
    sudo -u "$USER_NAME" tar xzf /tmp/actions-runner.tgz -C "$dir"
    rm -f /tmp/actions-runner.tgz
  fi
  "$dir/bin/installdependencies.sh"
  if [ -f "$dir/.runner" ]; then
    sudo -u "$USER_NAME" "$dir/config.sh" remove --token "$token" || true
  fi
  sudo -u "$USER_NAME" "$dir/config.sh" \
    --unattended \
    --url "$url" \
    --token "$token" \
    --name "vps-dev-$name" \
    --labels "$labels" \
    --work "_work" \
    --replace
  cd "$dir"
  ./svc.sh install "$USER_NAME" || true
  ./svc.sh start
  ./svc.sh status || true
}

install_runner ccc \
  "https://github.com/jmetdev/ccc-recording-portal" \
  "$CCC_TOKEN" \
  "vps-dev,linux,x64"

install_runner fax \
  "https://github.com/jmetdev/cloudcorefax" \
  "$FAX_TOKEN" \
  "vps-dev,linux,x64"

echo ""
echo "Runners installed. Use: runs-on: [self-hosted, vps-dev]"
