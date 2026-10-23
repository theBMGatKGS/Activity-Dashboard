# Activity Dashboard
Revision **00.05.001_261023** · time zone follows the computer (00.05.001) · Daily Focus home screen (00.05) · local-first app · encrypted Data folder (optional, in-browser AES-256-GCM) · optional encrypted sync through a private GitHub repo (00.04) · installable (PWA) over https · no server of its own.

## Use
1. The app lives in **`<synced folder>/Dashboard/`** on the user's Mac. It is **not** in the notebook repo. To update, copy the new app files over the old ones; the deploy folder never contains `Data/`.
2. Real data sits in **`Dashboard/Data/`** (capital D): `inbox-snapshot.js` (+ `.json`), copied there after each Inbox Exporter run, and optional `notebook-log.js`. Spec: `docs/inbox-snapshot-schema.md`.
3. Double-click `index.html` (Edge or Chrome). If there's no snapshot, the fictional example loads with an **⚠ EXAMPLE DATA** badge.
4. **Two computers (00.02):** open the same `Dashboard/index.html` from OneDrive on the Mac and the work PC in **Chrome or Edge** (not Safari). On first run, name the machine (`mac`, `workpc`; a–z/0–9) and connect the `Dashboard/Data` folder via the picker (File System Access API; the handle is kept in IndexedDB, permission re-requested with one click when needed). Each machine writes only `Data/time-<machine>.json` (append-only event log); all `Data/time-*.json`, including OneDrive conflict copies, are merged deterministically (last writer wins per entry by timestamp, then machine name). Nothing is a hardcoded path, so the Windows OneDrive path (`C:\Users\<you>\OneDrive\Dashboard`) just works. Data is polled every 60 s (`config.js` `pollSeconds`). Stamps more than `holdHours` (default 24) in the future are held and flagged; File → Repair clock stamps… fixes them on the machine that had the wrong clock.
5. Snapshot somewhere else? Edit `config.js` (`snapshotPath`) or use **File → Open snapshot…** (.js / .json / .csv).

## Files
| Path | What |
|---|---|
| `index.html`, `app.css` | UI, in-app Help / How Do I / FAQ / Quick Start / Keyboard shortcuts / Revision log; 00.05 SVG status icons, Hardline palette scoped to `#view-focus`, Daily Focus print styles |
| `assets/fonts/` | 00.05 self-hosted WOFF2 subsets (Space Grotesk, IBM Plex Mono) + SIL OFL 1.1 licences + `README.md` (source, SHA-256, subset command) |
| `js/rules.js` | pure rules (totals, Going Cold, WoW, conflicts, guesses, lines, Manager filter, workload; 00.05 `focusSections`, `overlays`, `keyCold`, `isOutside`, `focusDelta`, `snoozeUntil`) |
| `js/vault.js` | 00.03 encryption (keyring, AES-256-GCM envelopes), browser + Node |
| `js/hub.js` | 00.04 GitHub data hub: REST Contents API client, plaintext guard, folder-handle adapter, folder ⇄ hub mirror; browser + Node |
| `js/frame.js` | 00.04 frame-busting check (runs first) |
| `manifest.webmanifest`, `sw.js` | 00.03 installable app, offline app shell |
| `config.local.example.js` | template for the git-ignored per-computer `config.local.js` |
| `tools/encrypt_file.js` | 00.03 encrypt a file for an encrypted Data folder |
| `js/sync.js` | pure two-machine merge: time-file format, event fold (last writer wins), diff → events, migration |
| `js/db.js` | IndexedDB local cache: this machine's events, merged entries, trend history, machine name, folder handle |
| `js/app.js` | rendering and interactions |
| `config.js` | snapshot path, notebook-log.js path, stale hours, `focusRowCap` (00.05, default 12) |
| `tools/make_log_js.py` | box-side: notebook-log.md → Data/notebook-log.js (only `- [log]` lines; .md read-only) |
| `examples/example-snapshot.js/.json` | FICTIONAL example (fallback) |
| `Data/` (not shipped) | the user's real files: `inbox-snapshot.js/.json`, `notebook-log.js`, `time-<machine>.json` per machine; OneDrive only |
| `tests/`, `tools/`, `.gitignore` | box-side only; not in the deploy folder |
| `tests/` | `run_all.sh`: unit tests (node), T11 offline local-file test, screenshots (Playwright); 00.04 `hub.test.js` + `fake_github.js` (mocked GitHub API), `t23_hub.py` (PC + iPad end to end, mocked API) |

## Daily Focus (00.05)
The home screen (always opens first; `?view=dashboard|workload|print|manager` opens another tab). The older views are tabs: Focus · Totals (the former Dashboard) · Workload · Print sheet · Manager's sheet.

| Square / section | Rule (open tasks; Withhold items show on screen as before) | Snapshot fields |
|---|---|---|
| Due Today | `next_date` = today (CT), any list except Waiting on | `tasks[].next_date`, `list`, `status` |
| Overdue | `next_date` < today, any list except Waiting on | same |
| Owed to outside | Follow-ups / Account touches, `not_started`/`in_progress`, due after today or no date, and **outside**: the task has an account, or its person isn't on the internal-people list | `list`, `status`, `account`, `person` |
| Waiting · past check-back (square "Waiting past due") | Waiting on with `next_date` ≤ today; the due date **is** the check-back date | `list`, `next_date` |
| Going cold · key | ★ key account with no touch for 14+ days; one row per account (its oldest open task not shown elsewhere, else "Log a touch") | `touches[]`, `calendar[]`, `tasks[].last_modified`, time entries |
| Travel ≤ 7 days | Travel tasks due today…today+7, plus travel-looking calendar events on days with no Travel task | `list`, `next_date`, `calendar[]` |
| Later this week (collapsed) | open, due tomorrow…Sunday, not shown above; snoozed items returning this week | `next_date` |
| Meetings | today's events that haven't ended, first 4 (+n more → Workload) | `calendar[]` |

- **Touch** (Going cold · key): outbound touches; a meeting that happened (calendar, or `meeting_proposed` once its `meeting_date` has passed); a To Do edit on one of the account's tasks; a time entry with that account (Log touch, + Log call, notebook log). Inbound touches don't count. A dashboard Done doesn't count.
- **Delta chip** on Due Today: the snapshot's Due Today total (the same definition as the Totals tile) minus the latest `totals_history` snapshot from the previous business day (Monday → Friday; a weekend snapshot counts for Monday). No basis → no chip. Local Done marks never change it; the big number shows what's left after them.
- **Row cap** `focusRowCap` (12): each non-empty section keeps ≥ 1 row, Due Today and Overdue ≥ 3, the rest fill in section order; "+n more" expands a section in place. Squares always show full counts.
- **No date:** owed and cold rows show a red ⚠ no date; other undated open items are counted in a footer line that expands.
- **Status = word + SVG icon + color**: Today ● green, Overdue ▲ red, Waiting (hourglass) amber, Cooling ◐ blue, This week ◆ ivory, Travel ✈, Later ▸ grey. Color means urgency only.
- **Actions** (To Do stays the source of truth; nothing is written to To Do): ✓ Done hides the row (8 s Undo) and is counted as "n done here, not yet in To Do" until a snapshot shows the task done or removed (mark clears itself) or shows it edited in To Do after the Done (row returns, "reopened in To Do"). Never auto-expires. Snooze: Later today (+3 h), Tomorrow 08:00 CT, Next Monday 08:00 CT, a picked date 08:00 CT; ends when To Do re-dates or closes the task; never changes the due date. Log touch opens + Log call pre-filled (account, person as note, Phone, 15 min).
- **Sync format:** new event op `flag` in `time-<machine>.json` (encrypted like everything else; opaque name on the hub). Ids `star:<account>`, `done:<taskId>` `{on, at, snapAt}`, `snooze:<taskId>` `{on, until, due}`, `internal:<person, lower case>`, `setting:t1offer`. `data.on` is required (boolean); off = `on:false`, never a removal. Fold: last writer wins per id (stamp, counter, machine), as `upsert`. Reconciliation with the snapshot runs after the fold and depends only on the snapshot + folded flags, so every machine shows the same. **Mixed versions:** a 00.04.x reader drops `flag` events (invalid op) and keeps every time entry (tested against the 00.04.001 parser); update all computers the same day.
- **Keyboard:** j/k rows, d/s/t Done/Snooze/Log touch on the focused row (off while typing or in a dialog); squares are buttons that jump to their section; Snooze is a menu button (arrows, Home/End, Esc).
- **Accessibility:** sections are `<section aria-labelledby>` with h2 headings, rows are a list, every action button names its task, the Undo message and sync chip are `aria-live="polite"`, a gold 2 px focus ring, WCAG AA contrast on every Hardline text pair (tested), 10 px minimum labels, 200% zoom reflows to 2×2 squares and two-line rows. `prefers-reduced-motion` turns off all animation app-wide; otherwise rows fade in once on load only (never on 60 s re-renders).
- **Fonts:** Space Grotesk + IBM Plex Mono, self-hosted WOFF2 Latin subsets in `assets/fonts/` (~54 KB, SIL OFL 1.1, SHA-256 and subset command in `assets/fonts/README.md`), cached by the service worker. The CSP is unchanged (`default-src 'self'` covers fonts).
- **Print:** File → Print Daily Focus… (or Ctrl+P on the Focus tab): one landscape letter page in the print palette, outlined squares, no fills, shadows, gold frame or animation, no buttons. Print my sheet… and the Manager's sheet are unchanged (Withhold never prints there).
- **Key accounts & internal people:** ☆/★ on account chips (Focus rows, Totals list, Workload) or File → Key accounts & internal people…. First run offers to star the T1 accounts (an inline dialog; nothing is starred until confirmed).

## Time zone (00.05.001)
- **No setting.** The zone is the computer's own: `Intl.DateTimeFormat().resolvedOptions().timeZone` (an invalid or missing zone falls back to America/Chicago, which is what every earlier version used, so a Central-time computer behaves exactly as before).
- **Used for:** the day boundary (today, Due Today, Overdue, This week, Going cold days, Later this week, the delta's previous business day), the 08:00 return of Snooze → Tomorrow / Next Monday / a picked date, meeting times and the calendar strip (7 AM–6 PM local), the as-of stamps, and the sync chip time. Stamps carry the zone's short name (CT, ET, PT, MST…; zones without one show the IANA id).
- **Re-detected** on every poll (`pollSeconds`, 60 s, also without a Data folder), when the window gets focus, and when the tab becomes visible. If the zone or the local day changed, the snapshot's day fields are re-read and everything above is recomputed without a reload; a message names the new zone.
- **Shown read-only** in the top bar (`#tz`, e.g. "CT · America/Chicago") and in Help → How Do I → "…change the time zone?". It is per computer by nature and never stored or synced.
- Already-set snoozes keep their instant (a snooze set for 08:00 CT returns at 07:00 MT when travelling west). Time entries keep the day they were logged on.
- `rules.js`: `detectTimeZone`, `setTimeZone`, `getTimeZone`, `validTimeZone`, `tzLabel`, `zoneOffsetMs`; `ctIso(day, hh:mm)` now converts in the current zone (DST-safe; a time inside a spring-forward gap moves forward).

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
`bash tests/run_all.sh` (needs node, python3, playwright+chromium, poppler-utils). Includes `sync.test.js` (merge logic) and `t20_sync.py` (two simulated machines). 00.05: `rules.test.js` F1–F12 (Daily Focus rules), `sync.test.js` F-S/F-R/F-V (flag op, reconciliation, 00.04.001 reader), `t24_focus.py` (Daily Focus in Chromium: layout, actions, keyboard, a11y tree, contrast, print, reduced motion, zoom, fonts offline, stars/Done/Snooze through an encrypted folder), `t23_hub.py` (stars/Done through the mocked hub). 00.05.001: `rules.test.js` Z1–Z5 (Chicago unchanged, Eastern/Pacific day boundaries, DST both ways, spring-forward gap, Due Today/Overdue per zone), `t25_tz.py` (Chromium in Chicago/Eastern/Pacific, read-only chip, as-of, snooze 08:00 local, zone change mid-session on focus / visibility / poll without reload). Older browser tests open `?view=dashboard`.
