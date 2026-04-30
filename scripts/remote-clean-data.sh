#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/remote.sh"

OPENCLAW_HOST_DATA_DIR="${OPENCLAW_HOST_DATA_DIR:-/root/ClawScale/data/openclaw}"

remote_sudo "
cd '${DEPLOY_DIR}'
docker compose down -v --remove-orphans || true
docker ps -aq --filter label=clawscale.openclaw=true | xargs -r docker rm -f
docker volume rm -f clawscale_pgdata pgdata 2>/dev/null || true
rm -rf '${OPENCLAW_HOST_DATA_DIR}'
mkdir -p '${OPENCLAW_HOST_DATA_DIR}'
"

