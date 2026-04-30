#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/remote.sh"

remote_sudo "
cd '${DEPLOY_DIR}'
docker compose down --remove-orphans || true
docker ps -aq --filter label=clawscale.openclaw=true | xargs -r docker rm -f
"

