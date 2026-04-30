#!/usr/bin/env bash
set -euo pipefail

BRANCH="${BRANCH:-dev}"
REPO_HTTPS="${REPO_HTTPS:-https://github.com/maxwelljun/ClawScale.git}"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh is required for HTTPS token push" >&2
  exit 1
fi

token="$(gh auth token -h github.com)"
GIT_CONFIG_GLOBAL=/dev/null git push "https://x-access-token:${token}@${REPO_HTTPS#https://}" "$BRANCH"
git config "branch.${BRANCH}.remote" origin
git config "branch.${BRANCH}.merge" "refs/heads/${BRANCH}"

