#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/remote.sh"

remote_sudo "
cd '${DEPLOY_DIR}'
docker compose ps
docker compose logs --tail=80 app
docker compose exec -T db psql -U clawscale -d clawscale -c \\\"select (select count(*) from tenants) tenants, (select count(*) from channels) channels, (select count(*) from ai_backends) backends, (select count(*) from end_users) end_users;\\\" || true
docker ps -a --filter label=clawscale.openclaw=true --format \\\"table {{.ID}}\\t{{.Image}}\\t{{.Status}}\\t{{.Names}}\\\"
"

