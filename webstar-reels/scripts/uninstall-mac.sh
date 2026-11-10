#!/bin/bash
# Removes the launchd jobs and the wake schedule. Leaves the project, its state and logs alone.
set -uo pipefail
LABEL="com.webstar-reels"
for job in weekly daily; do
  launchctl bootout "gui/$(id -u)/$LABEL.$job" 2>/dev/null && echo "removed $LABEL.$job"
  rm -f "$HOME/Library/LaunchAgents/$LABEL.$job.plist"
done
echo "Removing the repeating wake schedule (asks for your password)."
sudo pmset repeat cancel
pmset -g sched
