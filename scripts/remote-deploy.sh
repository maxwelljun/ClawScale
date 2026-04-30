#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib/remote.sh"

remote_sudo "
cd '${DEPLOY_DIR}'
git fetch origin '${DEPLOY_BRANCH}'
git checkout '${DEPLOY_BRANCH}'
git reset --hard 'origin/${DEPLOY_BRANCH}'
docker compose up -d --build
docker compose ps
"

