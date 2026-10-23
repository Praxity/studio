set -euo pipefail
started=$(date +%s)
while true; do
  load=$(sysctl -n vm.loadavg | awk '{print $2}')
  if ! pgrep -f VoiceOver >/dev/null && awk -v current_load="$load" 'BEGIN {exit !(current_load <= 6)}'; then
    break
  fi
  if (( $(date +%s) - started >= 1800 )); then
    echo 'MacBook Pro capacity unavailable after 30 minutes: VoiceOver is running or 1-minute load exceeds 6.' >&2
    exit 1
  fi
  printf 'Waiting for MacBook Pro capacity: load=%s; VoiceOver must be stopped.\n' "$load"
  sleep 30
done
