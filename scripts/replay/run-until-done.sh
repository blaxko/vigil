#!/bin/bash
export PATH="$HOME/.local/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd /mnt/c/Users/HomePC/Documents/vigil
LOG=/mnt/c/Users/HomePC/Documents/vigil/replay_run_loop.log
for i in $(seq 1 25); do
  echo "=== outer attempt $i ===" >> "$LOG"
  node_modules/.bin/ts-node --project tsconfig.json scripts/replay/run-replay.ts >> "$LOG" 2>&1
  if tail -5 "$LOG" | grep -q "^Done\."; then
    echo "REPLAY_COMPLETE" >> "$LOG"
    exit 0
  fi
  sleep 5
done
echo "REPLAY_GAVE_UP_AFTER_25_ATTEMPTS" >> "$LOG"
exit 1
