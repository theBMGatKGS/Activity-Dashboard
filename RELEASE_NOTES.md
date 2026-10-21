# Release notes — Activity Dashboard

## 00.03.000_261021 (Oct 21 2026)
Your data folder can now be encrypted, and the app can be installed.
- File → Encryption… encrypts every data file in the connected Data folder in the browser (AES-256-GCM). Pick a passphrase; save the recovery key it shows once. Other computers unlock with the same passphrase (or the recovery key, then set a new passphrase).
- Existing plaintext files are encrypted, checked and removed. Nothing readable stays in the synced folder.
- Opened from its https address in Edge or Chrome, it installs as an app (own window, works offline). Opening `index.html` from disk still works.

## 00.02.000_261019 (Oct 19 2026)
Two-machine time sync through a cloud-synced folder (e.g. OneDrive). Open the same `Dashboard/index.html` on two computers in Chrome or Edge, name each machine once, and connect the `Dashboard/Data` folder. Each machine writes only its own `Data/time-<machine>.json`, an append-only event log; all files (including sync-conflict copies) are merged deterministically, last writer wins per entry.

- Hybrid logical clock with UTC stamps; ⚠ Clock ahead warning for stamps more than 5 min in the future; stamps more than `holdHours` (default 24 h) ahead are held until real time catches up.
- File → Repair clock stamps re-stamps this machine's future-dated events at max(last correct stamp, the event's floor), capped at now; refused while this clock looks behind another machine. Repaired events supersede their originals (same machine only).
- One-time migration of 00.01 local time entries: automatic fills stamped at the meeting start, real adjustments at start + 1 ms, removals at start + 2 ms (removal wins). Malformed 00.01 data is skipped with a warning.
- Fallback without folder access: File → Save my time file… / Open time files….
- Tests: `sync.test.js` and `t20_sync.py` (two simulated machines, offline edits, conflict copies, migration).

**Install:** copy the app files to `<synced folder>/Dashboard/`. Real data lives in `Dashboard/Data/` (never shipped, git-ignored).

## 00.01.000_261019 (Oct 19 2026)
First build: local-file app (no server, no sign-in, no network calls). Status totals with week-over-week trends, calendar strip with conflicts, grouped To Do list, Going Cold (14 days without activity), time logging, notebook-log import, audience/subject guesses, workload view, landscape print sheet and a sanitized Manager sheet (withheld items never appear on it). Hardened CSV export against injection; snapshot validation is atomic.

Not in v1: By-account view, account-based Going Cold, the "My next three things" ranking; the Proposed tray is hidden.
