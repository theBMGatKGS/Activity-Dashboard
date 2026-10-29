# Release notes — Activity Dashboard

## 00.09.000_261029 (Oct 29 2026)
**Accounts**: your strategic account plans, read-only, in six sections.
- File → Import account plans (Markdown)… brings in the plans from the notebook.  Each plan's open loops go into Projects (plan "Accounts – <account>") automatically, never twice.
- If a loop was reworded, or comes back with a later date after its task was completed, the Accounts tab asks first: Same task or New task.  Daily Focus shows how many questions are waiting.
- File → Import contacts (CSV)… adds titles and last touches to the stakeholder map.  Email and phone show only on screen behind "contact" and are never printed.
- Both imports need an encrypted, unlocked Data folder and are saved only encrypted.

## 00.08.001_261028 (Oct 28 2026)
- Your GitHub profile picture now shows in the upper-left corner (on screen only, not on printed sheets).

## 00.08.000_261028 (Oct 28 2026)
**Front and center**: pin a plan and keep its open tasks in view.
- On the Projects tab, pick a plan and press **📌 Pin to Front and center**. Its open tasks show at the top of Daily Focus and Projects, overdue first, until every task is completed. Unpin any time.
- **File → Import project JSON…** brings in a whole plan: buckets, tasks, notes and named checklist items, and whether it is pinned. The usual rules apply (no pricing or dollar figures, no email addresses); if anything fails, nothing is imported and the problems are listed. Import needs an encrypted, unlocked Data folder. Delete the file you picked afterwards: it is not encrypted.

## 00.07.000_261027 (Oct 27 2026)
**Projects tab**: plan your projects in the dashboard and hand them to Planner as files.
- Make plans, buckets and tasks, with checklists, owners (pick from the list or type a name), status, progress, priority, start and due dates, labels and notes.
- Squares count open, overdue, due today, in progress and unassigned tasks. Filter by plan and owner; tick Show completed for finished tasks.
- **Export** Planner-ready **CSV**, **Excel (xlsx)** (one sheet per plan) and **Graph JSON** (plan, buckets, tasks and task details). Planner itself can't import CSV or xlsx: those files match the layout of Planner's "Export plan to Excel", for Excel or an import tool. The Graph JSON is for a Graph-based import. Nothing is sent to Planner or Microsoft Graph.
- No pricing or dollar figures: a task, checklist item, plan or bucket containing an amount isn't saved.
- Saved encrypted: in the browser, and in the Data folder as `projects-store.json.enc` once the folder is encrypted. Exports ask first because they are plain files.
- Optional: File → Import Planner export into Projects copies an encrypted Planner export (`projects.json.enc`).
- Prints in the print colors.

## 00.06.000_261024 (Oct 24 2026)
**Today strip** on Daily Focus, under the squares.
- Today's meetings on a timeline from 07:00 to 19:00, wider when something starts earlier or ends later, in your computer's time zone. Client meetings are gold, internal blue, private holds grey. Meetings at the same time sit side by side in their own lanes and are hatched.
- Travel that affects today shows as an amber band (drive, flight), with a **leave by** time (flight − drive − 90 minutes) and tonight's hotel with its cancel-by time.
- To Do markers: ▼ red for overdue, ▼ green for due today. A green line marks now.
- Click a meeting (or press Enter on it) for its details: time, place, Teams link, attendee domains and count, the account, linked To Do items, open loops and today's itinerary. Esc closes it.
- "Calendar as of …" shows how fresh the calendar is: amber after 6 hours, red after 24.
- The calendar and trips come from new **encrypted** feeds written by the calendar and travel assistants. Until those are set up, meetings come from the Inbox snapshot as before and the chip says "No calendar feed".
- Prints in the print colors (outlined meetings, navy travel).

## 00.05.003_261024 (Oct 24 2026)
- **Today's Clear:** a thin progress bar under the four squares on Daily Focus shows how much of today's load you've cleared, for example "5 of 11 · 45%".
- It counts what's due today plus what's overdue (not Waiting on), starting from the first snapshot you see today. Ticking a task off in To Do or with ✓ Done here fills it; Undo empties it again.
- A snoozed item shows as a grey hatched piece and never counts as cleared. Overdue items still open show as red ticks under the bar. New items that turn up during the day add to the total ("+1 added today").
- Printed Daily Focus shows the bar as a flat navy fill with the counts written out.
- Screen readers announce it as a progress bar ("5 of 11 cleared, 1 snoozed, 2 overdue still open"). Reduced-motion settings turn off the fill animation.

## 00.05.002_261023 (Oct 23 2026)
- Fixed: if a computer was unlocked after the dashboard had started (for example after "Not now", reconnecting the Data folder, or resetting the passphrase with the recovery key), GitHub sync didn't start. It showed "Synced" but no ☁, kept showing EXAMPLE DATA and sent nothing. It now connects as soon as you unlock.
- If GitHub sync is set up but can't start (for example it was set up with a different passphrase setup), the top bar now says "⚠ GitHub not connected"; click it to set it up again.
- Lock now also disconnects GitHub sync until you unlock again.

## 00.05.001_261023 (Oct 23 2026)
- The dashboard now uses your computer's time zone, so it stays right when you travel. There's nothing to set: on a computer in Central time everything works as before.
- Today, Due Today, Overdue, the 8:00 return of Snooze, meeting times and the "As of" stamp all follow the zone. When the computer's zone changes, the dashboard notices within a minute (or as soon as you come back to the window) and updates without reloading.
- The current zone is shown next to the machine name in the top bar (for example "CT · America/Chicago").

## 00.05.000_261023 (Oct 23 2026)
**Daily Focus** is the new home screen.
- Four squares: **Due Today** (with ▲/▼ compared with the previous business day's snapshot), **Overdue**, **Waiting past due** and **Going cold** (your ★ key accounts with no touch in 14 days). Click one to jump to its section.
- Today's next meetings beside the squares, then sections: Due Today, Overdue, Owed to outside, Waiting past check-back, Going cold, Travel within 7 days, and Later this week (folded). About 12 rows; **+n more** opens the rest.
- On each row: **✓ Done** (with Undo), **Snooze** (Later today, Tomorrow, Next Monday, Pick date) and **Log touch**. Done hides the row until To Do catches up; the header counts what's "done here, not yet in To Do". The dashboard still never changes To Do.
- ★ key accounts: the first time, it offers to star your T1 accounts and you confirm. Change them with ☆/★ or File → Key accounts & internal people…, which also holds your internal-people list for "Owed to outside".
- Stars, Done and Snooze sync between your computers and the iPad inside your encrypted time file.
- File → Print Daily Focus…: one landscape page in the print colors.
- Keyboard: j/k move, d Done, s Snooze, t Log touch. Reduced-motion settings are honored. The fonts ship with the app, so it still works offline.
- The old Dashboard tab is now **Totals**; everything else is where it was.
- **Update every computer the same day:** a computer still on 00.04 ignores stars, Done and Snooze (it keeps all your time).

## 00.04.001_261023 (Oct 23 2026)
- Fixed: with GitHub sync on, an older snapshot from GitHub could replace a newer one in your Data folder. Now the newer valid copy always wins, and the one replaced is kept as a `.prev.enc` file.
- A snapshot the dashboard rejects is never uploaded and never replaces a good one; if GitHub holds a bad copy, the good local one replaces it.
- Renamed backup files in the Data folder are left alone and never uploaded.

## 00.04.000_261021 (Oct 21 2026)
Sync through your own private GitHub repo, so the work PC, the Mac and the iPad share the same data.
- File → GitHub sync…: enter the private repo and paste this computer's own access token. The dialog shows how to make the token (only the data repo, Contents read and write, one year).
- Only encrypted files and the locked keyring are ever sent. Your passphrase, data key and readable data stay on your devices. The token is saved encrypted in this browser.
- Computers with a Data folder keep it as the backup (e.g. `D:\!!Dashboard\Data` or OneDrive). The iPad uses GitHub directly in Safari, with no folder.
- The installed app is called Activity Dashboard. The page won't run inside another website's frame.

## 00.03.003_261021 (Oct 21 2026)
- Stricter security: the page runs only its own code and talks only to its own address.
- Deleting the older version's copy is more reliable when another tab has it open.

## 00.03.002_261021 (Oct 21 2026)
- When your data from the older version has been moved in and checked, the app offers to delete the older version's unencrypted copy in this browser. It only deletes it if you click OK.
- "Remember on this computer" is ticked by default.

## 00.03.001_261021 (Oct 21 2026)
- The copy each browser keeps is now encrypted too, with the same key. Nothing readable stays on the computer once the folder is encrypted, and nothing is cached while locked.
- The recovery key screen recommends a password manager plus a printed copy, and has a Print button.
- Exports stay plain and ask first.

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
