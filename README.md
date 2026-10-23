# Activity Dashboard
Revision **00.04.001_261023** · local-first app · encrypted Data folder (optional, in-browser AES-256-GCM) · optional encrypted sync through a private GitHub repo (00.04) · installable (PWA) over https · no server of its own.

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
| `js/vault.js` | 00.03 encryption (keyring, AES-256-GCM envelopes), browser + Node |
| `js/hub.js` | 00.04 GitHub data hub: REST Contents API client, plaintext guard, folder-handle adapter, folder ⇄ hub mirror; browser + Node |
| `js/frame.js` | 00.04 frame-busting check (runs first) |
| `manifest.webmanifest`, `sw.js` | 00.03 installable app, offline app shell |
| `config.local.example.js` | template for the git-ignored per-computer `config.local.js` |
| `tools/encrypt_file.js` | 00.03 encrypt a file for an encrypted Data folder |
| `js/sync.js` | pure two-machine merge: time-file format, event fold (last writer wins), diff → events, migration |
| `js/db.js` | IndexedDB local cache: this machine's events, merged entries, trend history, machine name, folder handle |
| `js/app.js` | rendering and interactions |
| `config.js` | snapshot path, notebook-log.js path, stale hours |
| `tools/make_log_js.py` | box-side: notebook-log.md → Data/notebook-log.js (only `- [log]` lines; .md read-only) |
| `examples/example-snapshot.js/.json` | FICTIONAL example (fallback) |
| `Data/` (not shipped) | the user's real files: `inbox-snapshot.js/.json`, `notebook-log.js`, `time-<machine>.json` per machine; OneDrive only |
| `tests/`, `tools/`, `.gitignore` | box-side only; not in the deploy folder |
| `tests/` | `run_all.sh`: unit tests (node), T11 offline local-file test, screenshots (Playwright); 00.04 `hub.test.js` + `fake_github.js` (mocked GitHub API), `t23_hub.py` (PC + iPad end to end, mocked API) |

## Not in 00.02.000 (still deferred)
By-account view (planned 00.02), account-based Going Cold, the "My next three things" ranking with its print strip, and the Proposed tray (hidden).

## Encryption (00.03)
- Turn on: File → Encryption… (Data folder connected). Creates `Data/keyring.json` (wrapped key only) and stores every data file as `<name>.enc`. Plaintext originals are encrypted, read back, then deleted if you agreed.
- Keys: random AES-256 data key; wrapped by the passphrase (PBKDF2-SHA256, 600,000 iterations) and by a recovery key shown once. The passphrase and recovery key are never stored anywhere by the app. "Remember on this computer" keeps a non-extractable key in this browser's IndexedDB.
- Remember on this computer is ticked by default (00.03.002); untick it at setup or unlock, or use File → Encryption… → Forget.
- Older build: after its cache is copied and every value reads back identical, the app asks once (OK/Cancel) whether to delete the old unencrypted database (00.03.002). Never deleted without OK or after a failed check.
- Older build: put its names in `config.local.js` (copy `config.local.example.js`; git-ignored) to copy its browser cache and read its time logs/snapshot once.
- Exporters: `DASH_PASSPHRASE=… node tools/encrypt_file.js Data/keyring.json snapshot in.js Data/inbox-snapshot.json.enc`.
- Browser cache (00.03.001): once the folder is encrypted, the cached time events, entries, trend history, learned audiences and opened snapshot are stored in IndexedDB only as AES-256-GCM envelopes under the same key (purpose `cache`). Plaintext cache is encrypted on unlock; while locked nothing of it is read or written. Machine name, folder grant and settings stay plain (no data).
- Recovery key: keep it in a password manager **and** a printed copy (the setup dialog has Copy, Print… and Save as .txt…). Never in the Data folder, OneDrive or email.
- Not encrypted: CSV/JSON exports you save on purpose (they ask first), and the cache of a folder that isn't encrypted.

## GitHub data hub (00.04)
A **private** GitHub repo (e.g. `activity-data-hub`) is the shared store. It holds only `keyring.json` (wrapped key; useless without the passphrase or recovery key) and `*.enc` envelopes. No plaintext, ever: `js/hub.js` refuses any write that isn't a valid keyring or an AES-256-GCM envelope with exactly the envelope fields, **before** a request is made, and refuses a repo whose metadata says it isn't private.
- **Auth:** one fine-grained personal access token per machine: Repository access = only the data repo; Repository permissions = Contents: Read and write (Metadata: Read-only is automatic); 1-year expiry. Entered once in File → GitHub sync… (the dialog lists the steps). Stored only in this browser's IndexedDB as a vault envelope (purpose `token`) under the data key: unreadable while locked, never in localStorage or git. Classic `ghp_` tokens are refused. Revoke a lost device by deleting its token on GitHub.
- **Requests:** `https://api.github.com/repos/<owner>/<repo>/contents/…` with `Authorization: Bearer`, `X-GitHub-Api-Version: 2022-11-28`, `credentials: omit`, `cache: no-store`, `redirect: error`. Listing uses `If-None-Match` (ETag). Writes send the file's blob sha; a 409/422 re-lists and retries (each machine only writes its own time file). Files over 1 MB are read through `git/blobs`. Commit message is always `sync`; no author/committer details are sent (GitHub uses the token owner's account and its email privacy setting).
- **With a Data folder (Mac, work PC e.g. `D:\!!Dashboard\Data`, OneDrive):** the folder stays the backup and is still read as before. Each sync first mirrors encrypted files: keyring from the hub unless the hub has none (or the local one is newer by `changed`/`created`; different key ids → nothing copied, problem shown); this machine's `time-<machine>.json.enc` goes up; every other `.enc` comes down (hub wins); missing files are copied either way. Unchanged files are recognised by git blob sha, so they aren't downloaded again. A new passphrase / recovery slot is pushed at once.
- **Without a folder (iPad Safari, any browser without `showDirectoryPicker`):** the hub *is* the store. `Hub.dir()` looks like the folder handle the app already uses, so the same reading, writing and merge code runs. The keyring is cached with the token envelope so the app can unlock at launch; offline edits stay in the encrypted browser cache and are written on the next successful sync.
- **Opaque names (QA N3):** on the hub every data file is `blob-<32 hex>.enc`, an HMAC-SHA256 of the real name under a name key derived from the data key (SHA-256 of one fixed AES-GCM encryption bound to the keyring id). The hub copy is a second envelope (purpose `hub`) around `{name, text}`, so paths, request URLs and outer envelopes reveal no file types or machine names; a blob whose contents name a different file is ignored. Only `keyring.json` keeps its name. Locked = no data file can be written.
- **Which copy wins (00.04.001):** only the known data files are mirrored: `time-<machine>.json.enc`, `inbox-snapshot.json.enc`, `notebook-log.js.enc` (plus `keyring.json`). Any other `*.enc` (`.prev.enc`, renamed backups such as `inbox-snapshot.json.bad-copy.enc`, conflict copies) is never uploaded or downloaded. Both copies of a file are decrypted and validated (a snapshot must pass the same checks the dashboard applies, e.g. `source`). A copy that fails is never uploaded and never replaces anything; a bad hub copy is replaced by a good local one. When both pass, the newer wins: snapshot `generated_at`, time-file `updated_at`, else when the file last changed (local file time vs an `mtime` stored inside the encrypted hub envelope). Same stamp = nothing moves. This machine's own time file always goes up. A file the hub is missing is uploaded. Whatever the local folder loses is kept as `<name>.prev.enc`. A plaintext snapshot dropped into the folder is encrypted only if it passes validation. With several snapshot files in the folder the dashboard uses the newest valid one.
- **Backup protection (QA N1):** a hub file replaces or adds a file in the local folder only after it decrypts with the data key (right purpose) and parses as a time log, snapshot or notebook log. Otherwise it's refused, the local copy is kept and the sync chip warns. The replaced local file is kept as `<name>.prev.enc` (local only, never uploaded, ignored by the app).
- **Merge rules unchanged:** auto-fill < adjustment < removed; newest timestamp wins, then machine name.
- **Service worker:** API calls are cross-origin and never handled or cached; `Data/`, `.enc`, keyring and API-looking paths are excluded on the app origin too.
- **Frame-busting:** `js/frame.js` runs first. In a frame the page hides itself, tries to take over the top window, and `app.js` doesn't start (no unlock or token dialog can be shown inside another site).

## Known limitations / deferred (00.04.000)
- **N2, rollback/replay:** anyone with write access to the hub (a token holder, or GitHub) can serve back an older file that is still validly encrypted. Since 00.04.001 a computer with a Data folder never lets an older copy replace a newer one (content stamps, authenticated hub mtime), but a device without a folder (iPad) still accepts it, and stamps aren't bound into the AAD. Planned fix: a per-file counter bound into the encryption (AAD), remembered per device, so a counter that goes backwards is refused or flagged.
- **N4, duplicate machine names:** at connect there is no warning when this machine's time file already exists on the hub, so two devices given the same machine name overwrite each other's time file.
- Access tokens expire after a year and must be renewed on each device; the app gives no warning before expiry (GitHub sync then reports the token as expired).
- The work-PC network must allow `https://api.github.com` (and the Pages site); a proxy or filter that blocks it stops GitHub sync there.
- iPad mode has only been tested in a simulation (Chromium with folder access removed), not yet on a real iPad in Safari.

## Content Security Policy (00.03.003; 00.04 adds the GitHub API)
`index.html` sets `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; connect-src 'self' https://api.github.com; form-action 'none'`.
- Why `style-src 'unsafe-inline'`: the UI sets layout with inline `style="…"` attributes (58 of them). Inline styles can't run script; scripts stay `'self'` only (no inline script, no eval).
- Same policy works from GitHub Pages, the installed app (same origin) and `file://` (Chromium treats the page's own folder as `'self'`); tested in T22. 00.04: `connect-src` gained exactly one entry, `https://api.github.com`.
- A `<meta>` CSP can't set `frame-ancestors`; GitHub Pages can't send headers, so `js/frame.js` does the frame check in script (00.04).

## Install (00.03)
`manifest.webmanifest` + `sw.js`. Served over https (e.g. GitHub Pages) Edge/Chrome offer Install; the service worker caches the app shell only (never `Data/`). Opened from disk (`file://`) it runs as before without the service worker.

## Data rules
- No real data in git, ever, and none in the app files. The deploy folder has no `Data/`; `.gitignore` (box-side) still excludes `Data/` files and exports.
- Time entries live in `Data/time-<machine>.json` (one per machine, OneDrive-synced) with IndexedDB only as a cache; File → Export time entries CSV still works. Nothing is written back to To Do. Clear local data keeps time entries unless DELETE is confirmed.
- Notebook log: `- [log] YYYY-MM-DD HH:MM | 20m | Channel | Audience | Subject | Account | Person | note`. On the box after each Inbox Exporter run: `python3 tools/make_log_js.py <notebook-log.md> <dashboard/Data/notebook-log.js>`, then copy the .js (with the snapshot) into `Dashboard/Data/` in OneDrive. The dashboard autoloads `Data/notebook-log.js`; File → Import notebook log… is the fallback. `notebook-log.md` is the user's file: it is never written, overwritten or git-ignored, and the build ships none.
- Manager's sheet leaves out every item tagged **Withhold** in To Do. Inbox Exporter passes the tag through and never sets it.
- Example data never writes to local storage.

## Test
`bash tests/run_all.sh` (needs node, python3, playwright+chromium, poppler-utils). Includes `sync.test.js` (merge logic) and `t20_sync.py` (two simulated machines).
