# Activity Dashboard
Revision **00.02.000_261019** · local-file app · no server, no sign-in, no network calls.

## Use
1. The app lives in **`<synced folder>/Dashboard/`** on the user's Mac. It is **not** in the notebook repo. To update, copy the new app files over the old ones; the deploy folder never contains `Data/`.
2. Real data sits in **`Dashboard/Data/`** (capital D): `inbox-snapshot.js` (+ `.json`), copied there after each Inbox Exporter run, and optional `notebook-log.js`. Spec: `docs/inbox-snapshot-schema.md`.
3. Double-click `index.html` (Edge or Chrome). If there's no snapshot, the fictional example loads with an **⚠ EXAMPLE DATA** badge.
4. **Two computers (00.02):** open the same `Dashboard/index.html` from OneDrive on the Mac and the work PC in **Chrome or Edge** (not Safari). On first run, name the machine (`mac`, `workpc`; a–z/0–9) and connect the `Dashboard/Data` folder via the picker (File System Access API; the handle is kept in IndexedDB, permission re-requested with one click when needed). Each machine writes only `Data/time-<machine>.json` (append-only event log); all `Data/time-*.json`, including OneDrive conflict copies, are merged deterministically (last writer wins per entry by timestamp, then machine name). Nothing is a hardcoded path, so the Windows OneDrive path (`C:\Users\<you>\OneDrive\Dashboard`) just works. Data is polled every 60 s (`config.js` `pollSeconds`). Stamps more than `holdHours` (default 24) in the future are held and flagged; File → Repair clock stamps… fixes them on the machine that had the wrong clock.
5. Snapshot somewhere else? Edit `config.js` (`snapshotPath`) or use **File → Open snapshot…** (.js / .json / .csv).

## Files
| Path | What |
|---|---|
| `index.html`, `app.css` | UI, in-app Help / How Do I / FAQ / Quick Start / Revision log |
| `js/rules.js` | pure rules (totals, Going Cold, WoW, conflicts, guesses, lines, Manager filter, workload) |
| `js/sync.js` | pure two-machine merge: time-file format, event fold (last writer wins), diff → events, migration |
| `js/db.js` | IndexedDB local cache: this machine's events, merged entries, trend history, machine name, folder handle |
| `js/app.js` | rendering and interactions |
| `config.js` | snapshot path, notebook-log.js path, stale hours |
| `tools/make_log_js.py` | box-side: notebook-log.md → Data/notebook-log.js (only `- [log]` lines; .md read-only) |
| `examples/example-snapshot.js/.json` | FICTIONAL example (fallback) |
| `Data/` (not shipped) | the user's real files: `inbox-snapshot.js/.json`, `notebook-log.js`, `time-<machine>.json` per machine; OneDrive only |
| `tests/`, `tools/`, `.gitignore` | box-side only; not in the deploy folder |
| `tests/` | `run_all.sh`: unit tests (node), T11 offline local-file test, screenshots (Playwright) |

## Not in 00.02.000 (still deferred)
By-account view (planned 00.02), account-based Going Cold, the "My next three things" ranking with its print strip, and the Proposed tray (hidden).

## Data rules
- No real data in git, ever, and none in the app files. The deploy folder has no `Data/`; `.gitignore` (box-side) still excludes `Data/` files and exports.
- Time entries live in `Data/time-<machine>.json` (one per machine, OneDrive-synced) with IndexedDB only as a cache; File → Export time entries CSV still works. Nothing is written back to To Do. Clear local data keeps time entries unless DELETE is confirmed.
- Notebook log: `- [log] YYYY-MM-DD HH:MM | 20m | Channel | Audience | Subject | Account | Person | note`. On the box after each Inbox Exporter run: `python3 tools/make_log_js.py <notebook-log.md> <dashboard/Data/notebook-log.js>`, then copy the .js (with the snapshot) into `Dashboard/Data/` in OneDrive. The dashboard autoloads `Data/notebook-log.js`; File → Import notebook log… is the fallback. `notebook-log.md` is the user's file: it is never written, overwritten or git-ignored, and the build ships none.
- Manager's sheet leaves out every item tagged **Withhold** in To Do. Inbox Exporter passes the tag through and never sets it.
- Example data never writes to local storage.

## Test
`bash tests/run_all.sh` (needs node, python3, playwright+chromium, poppler-utils). Includes `sync.test.js` (merge logic) and `t20_sync.py` (two simulated machines).
