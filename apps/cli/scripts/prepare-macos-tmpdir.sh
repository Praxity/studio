set -euo pipefail
if (( ${#TMPDIR} + 60 >= 104 )); then
  printf 'TMPDIR is too long for macOS tool sockets: %s bytes plus 60 must be below 104. Use a short /tmp path.\n' "${#TMPDIR}" >&2
  exit 1
fi
[[ ! -L "$TMPDIR" ]] || exit 1
mkdir -m 700 -p "$TMPDIR"
