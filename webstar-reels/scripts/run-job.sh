#!/bin/bash
# Runs one job (weekly or daily) for launchd: keeps the Mac awake while it runs, logs to logs/,
# and raises a notification if the job crashes before it could report its own errors.
set -uo pipefail
JOB="${1:?usage: run-job.sh weekly|daily}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

# launchd starts with a bare PATH; add Homebrew, the node that setup recorded, and npm globals.
[ -f "$DIR/.mac-env" ] && source "$DIR/.mac-env"
export PATH="${NODE_DIR:-}:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.npm-global/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p logs
DAY="$(TZ=Australia/Melbourne date +%F)"
LOG="logs/$DAY-$JOB.log"
echo "$(date -u +%FT%TZ) run-job: starting $JOB" >> "$LOG"

# -i: no idle sleep, -s: no system sleep on power, -m: no disk sleep. Released when the job ends.
caffeinate -ism npm run --silent "$JOB" >> "logs/$DAY-$JOB.out" 2>&1
CODE=$?
echo "$(date -u +%FT%TZ) run-job: $JOB exited with $CODE" >> "$LOG"

# 0 = fine, 3 = the job hit errors and already notified you. Anything else is a crash.
if [ "$CODE" -ne 0 ] && [ "$CODE" -ne 3 ]; then
  MSG="The $JOB job stopped unexpectedly (exit $CODE). See logs/$DAY-$JOB.out"
  if command -v terminal-notifier >/dev/null; then
    terminal-notifier -title "Reels: $JOB failed" -message "$MSG" -sound Basso -open "file://$DIR/logs/$DAY-$JOB.out"
  else
    osascript -e "display notification \"$MSG\" with title \"Reels: $JOB failed\" sound name \"Basso\""
  fi
fi
exit "$CODE"
