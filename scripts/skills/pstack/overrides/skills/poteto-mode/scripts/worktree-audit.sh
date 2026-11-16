#!/usr/bin/env bash
# DSH: audit Git state without inferring usage from host-private conversations.
set -eu
exec node "$(dirname "$0")/worktree-audit.mjs" "$@"
