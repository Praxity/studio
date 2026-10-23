#!/usr/bin/env bash
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != true || "$(uname -s)" != Linux ]]; then
  exec "$@"
fi

: "${SLOW_TESTS_PROCESS_GROUPS_FILE:?Missing Vitest process-group file}"
# The recorded session leader stays the process-group ID after Vitest exits.
exec setsid --fork --wait bash -c '
  printf "%s\n" "$$" >> "$SLOW_TESTS_PROCESS_GROUPS_FILE"
  exec "$@"
' bash "$@"
