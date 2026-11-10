#!/bin/bash
# One-time setup on the Mac that runs the jobs. Safe to run again after changes.
#   - checks the tools, installs project dependencies and browsers
#   - installs two launchd jobs: weekly (Sunday 6:00) and daily (every day 6:00)
#   - schedules the Mac to wake at 5:55 every day (needs your password, for pmset)
#   - offers to crawl verrano.com.au and run the first weekly batch
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
AGENTS="$HOME/Library/LaunchAgents"
LABEL="com.webstar-reels"
step() { printf "\n\033[1m%s\033[0m\n" "$1"; }
need() { command -v "$1" >/dev/null || { echo "Missing $1. $2"; exit 1; }; }

[ "$(uname)" = "Darwin" ] || { echo "This script is for macOS."; exit 1; }

step "1/7 Tools"
need node "Install Node 20+: brew install node"
need npm "Install Node 20+: brew install node"
need ffmpeg "brew install ffmpeg"
need gh "brew install gh, then gh auth login"
need claude "npm install -g @anthropic-ai/claude-code, then run claude and /login with your Claude account"
command -v terminal-notifier >/dev/null || echo "Optional: brew install terminal-notifier (clicking a notification then opens the review page)"
gh auth status >/dev/null 2>&1 || { echo "Log in to GitHub first: gh auth login"; exit 1; }
echo "NODE_DIR=\"$(dirname "$(command -v node)")\"" > .mac-env
echo "export NODE_DIR" >> .mac-env

step "2/7 Project dependencies"
npm ci
npx playwright install chromium
npx remotion browser ensure
[ -f .env ] || { cp .env.example .env; echo "Created .env from .env.example. Fill it in, then run this script again."; exit 1; }

step "3/7 Checking setup"
npm run --silent check -- --live || echo "Fix the items above; the jobs will log errors until they are."

step "4/7 launchd jobs"
mkdir -p "$AGENTS" logs
chmod +x scripts/run-job.sh
write_plist() { # name, calendar-interval xml
  cat > "$AGENTS/$LABEL.$1.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL.$1</string>
  <key>ProgramArguments</key><array><string>$DIR/scripts/run-job.sh</string><string>$1</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>StartCalendarInterval</key>$2
  <key>StandardOutPath</key><string>$DIR/logs/launchd-$1.log</string>
  <key>StandardErrorPath</key><string>$DIR/logs/launchd-$1.log</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)/$LABEL.$1" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$LABEL.$1.plist"
  echo "installed $LABEL.$1"
}
# Weekday 0 = Sunday. If the Mac is asleep at 6:00, launchd runs the job when it wakes.
write_plist weekly "<dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>"
write_plist daily "<dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>0</integer></dict>"

step "5/7 Wake schedule (asks for your password)"
# One repeating wake covers both jobs. Note: this replaces any existing 'pmset repeat' schedule.
sudo pmset repeat wakeorpoweron MTWRFSU 05:55:00
pmset -g sched

step "6/7 Verrano photo library"
if [ ! -f brands/verrano/library/library.json ]; then
  read -r -p "Crawl verrano.com.au now? (Y/n) " a
  if [ "${a:-y}" != "n" ]; then
    npm run library:crawl -- --brand verrano
    read -r -p "Have Claude look at and tag every photo (uses your subscription; a few minutes)? (Y/n) " t
    [ "${t:-y}" = "n" ] || npm run library:tag -- --brand verrano
  fi
else
  echo "Library exists (npm run library:crawl -- --brand verrano to refresh it)."
fi

step "7/7 First week"
read -r -p "Make this week's reels now instead of waiting for Sunday? It takes a while. (y/N) " w
if [ "${w:-n}" = "y" ]; then
  ./scripts/run-job.sh weekly || true
fi

cat <<DONE

Done.
  Weekly: Sundays 6:00, makes the next 7 days of reels.
  Daily:  every day 6:00, asks you to approve today's reels at http://localhost:4777
  Wake:   the Mac wakes at 5:55 every day. Keep it plugged in.
  Logs:   $DIR/logs
  Run a job by hand: ./scripts/run-job.sh daily   (or: launchctl kickstart gui/$(id -u)/$LABEL.daily)
  Remove all of this: ./scripts/uninstall-mac.sh
DONE
