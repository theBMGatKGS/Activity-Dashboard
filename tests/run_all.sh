#!/usr/bin/env bash
# Runs every test from any working directory. Optional: SHOTS_DIR=<dir> (default: a fresh temp dir); DASH_HANDOFF=<handoff example json>.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"; ROOT="$(dirname "$HERE")"
cd "$ROOT"
node --check js/frame.js && node --check js/hub.js && node --check js/vault.js && node --check sw.js && node --check js/rules.js && node --check js/sync.js && node --check js/db.js && node --check js/app.js
node "$HERE/rules.test.js"
node "$HERE/sync.test.js"
node "$HERE/vault.test.js"
node "$HERE/hub.test.js"
node --check tools/encrypt_file.js
python3 "$HERE/check_no_real_data.py" "$ROOT"
python3 "$HERE/test_make_log_js.py"
python3 "$HERE/t11_offline.py"
python3 "$HERE/t12_t16.py"
python3 "$HERE/t20_sync.py"
python3 "$HERE/t21_vault.py"
python3 "$HERE/t22_pwa.py"
python3 "$HERE/t23_hub.py"
python3 "$HERE/t24_focus.py"
python3 "$HERE/t25_tz.py"
python3 "$HERE/t26_clear.py"
python3 "$HERE/t27_calendar.py"
python3 "$HERE/shots.py" "${SHOTS_DIR:-$(mktemp -d -t dash-shots-XXXX)}"
echo "ALL TESTS PASSED"
