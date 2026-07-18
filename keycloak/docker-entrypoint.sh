#!/bin/bash
set -euo pipefail

# Ensure the Aurora database exists before Keycloak starts (idempotent).
if [ -n "${DB_HOST:-}" ] && [ -n "${DB_USER:-}" ]; then
  export PGPASSWORD="${DB_PASSWORD:-}"
  exists=$(psql -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname='keycloak'" || true)
  if [ "$exists" != "1" ]; then
    echo "Creating database keycloak on $DB_HOST..."
    psql -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d postgres -c "CREATE DATABASE keycloak"
  fi
fi

exec /opt/keycloak/bin/kc.sh "$@"
