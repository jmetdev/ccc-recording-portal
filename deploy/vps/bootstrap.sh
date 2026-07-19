#!/usr/bin/env bash
# Idempotent VPS bootstrap for CCC dev (162.35.179.243).
# Run as root — export the public key *on the remote* (local env vars are not
# forwarded by `ssh host 'bash -s' < script`):
#   PUB="$(cat deploy/vps/.keys/deploy_ed25519.pub)"
#   ssh root@162.35.179.243 "export VPS_DEPLOY_PUBLIC_KEY=$(printf %q "$PUB"); bash -s" \
#     < deploy/vps/bootstrap.sh
#
# Generate the deploy key on a trusted machine (never on the VPS):
#   ssh-keygen -t ed25519 -f deploy_ed25519 -N "" -C "ccc-vps-deploy"
# Store deploy_ed25519 (private) in GitHub secret VPS_SSH_KEY (both repos).
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root." >&2
  exit 1
fi

if [ ! -f /etc/os-release ]; then
  echo "Unsupported OS: missing /etc/os-release" >&2
  exit 1
fi
# shellcheck source=/dev/null
. /etc/os-release
case "${ID:-}" in
  debian|ubuntu) ;;
  *)
    echo "Unsupported OS: ${ID:-unknown}. Debian/Ubuntu required." >&2
    exit 1
    ;;
esac

echo "==> Docker Engine + compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/"${ID}"/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} \
    ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "==> Docker daemon log rotation"
mkdir -p /etc/docker
if [ ! -f /etc/docker/daemon.json ]; then
  cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "3"
  }
}
EOF
  systemctl restart docker || true
fi

echo "==> Base packages"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  git jq curl fail2ban ufw

echo "==> fail2ban sshd jail"
if [ ! -f /etc/fail2ban/jail.d/sshd.local ]; then
  cat > /etc/fail2ban/jail.d/sshd.local <<'EOF'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
EOF
  systemctl enable --now fail2ban || true
fi

echo "==> ufw (HTTP via Cloudflare tunnel only; SIP/RTP direct)"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
# SIP plain + TLS for fax slots 0–15 (5080+10n .. 5240+10n)
ufw allow 5080:5241/tcp comment 'SIP/TLS fax slots'
ufw allow 16384:32767/udp comment 'RTP'
ufw --force enable

echo "==> deploy user"
if ! id deploy >/dev/null 2>&1; then
  useradd -m -s /bin/bash deploy
fi
usermod -aG docker deploy

if [ -z "${VPS_DEPLOY_PUBLIC_KEY:-}" ]; then
  echo "Set VPS_DEPLOY_PUBLIC_KEY to the deploy user's ed25519 public key." >&2
  echo "Example: VPS_DEPLOY_PUBLIC_KEY=\"\$(cat deploy_ed25519.pub)\" ssh root@... 'bash -s' < bootstrap.sh" >&2
  exit 1
fi

install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
AUTH_KEYS=/home/deploy/.ssh/authorized_keys
touch "$AUTH_KEYS"
chown deploy:deploy "$AUTH_KEYS"
chmod 600 "$AUTH_KEYS"
if ! grep -qF "$VPS_DEPLOY_PUBLIC_KEY" "$AUTH_KEYS" 2>/dev/null; then
  echo "$VPS_DEPLOY_PUBLIC_KEY" >> "$AUTH_KEYS"
fi

echo "==> app directories"
install -d -m 755 -o deploy -g deploy /opt/ccc-recording-portal /opt/cloudcorefax

echo "==> cloudflared (optional)"
if ! command -v cloudflared >/dev/null 2>&1; then
  curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb \
    -o /tmp/cloudflared.deb
  dpkg -i /tmp/cloudflared.deb || apt-get install -f -y
  rm -f /tmp/cloudflared.deb
fi
if [ -f deploy/vps/cloudflared-config.example.yml ] && [ ! -f /etc/cloudflared/config.yml ]; then
  install -d -m 755 /etc/cloudflared
  cp deploy/vps/cloudflared-config.example.yml /etc/cloudflared/config.yml.example
  echo "Dropped /etc/cloudflared/config.yml.example — owner: cloudflared tunnel login && copy to config.yml"
fi

echo ""
echo "Bootstrap complete."
echo "Next steps (as deploy user):"
echo "  1. docker login ghcr.io -u jmetdev --password-stdin   # read:packages PAT"
echo "  2. Hand-provision /opt/ccc-recording-portal/.env and /opt/cloudcorefax/.env (chmod 600)"
echo "  3. Commit deploy/vps/known_hosts: ssh-keyscan -H 162.35.179.243"
echo "  4. Activate Cloudflare tunnel per deploy/vps/cloudflared-config.example.yml"
