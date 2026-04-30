#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${SCRIPT_DIR}/push-dev.sh"
"${SCRIPT_DIR}/remote-clean-data.sh"
"${SCRIPT_DIR}/remote-deploy.sh"
"${SCRIPT_DIR}/remote-status.sh"

