#!/usr/bin/env bash
set -euo pipefail

DEPLOY_HOST="${DEPLOY_HOST:-43.128.225.9}"
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
DEPLOY_DIR="${DEPLOY_DIR:-/root/ClawScale}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-dev}"
DEPLOY_REPO_URL="${DEPLOY_REPO_URL:-https://github.com/maxwelljun/ClawScale.git}"

ssh_base_args=(
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o PreferredAuthentications=password
  -o PubkeyAuthentication=no
)

remote_ssh() {
  if [[ -n "${SSHPASS:-}" ]]; then
    sshpass -e ssh "${ssh_base_args[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" "$@"
  else
    ssh "${ssh_base_args[@]}" "${DEPLOY_USER}@${DEPLOY_HOST}" "$@"
  fi
}

remote_sudo() {
  local script="$1"
  remote_ssh "sudo bash -lc $(printf '%q' "$script")"
}

