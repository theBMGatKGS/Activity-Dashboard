# Build your own activity dashboard: a guide for colleagues

This guide explains how the Activity Dashboard is put together, so you can build one of your own with an AI coding assistant.  Every name, account, number, and file in it is a made-up example.  It has no real data, no live builder code, and no company wording.

## 1. What it is

- A single web page that runs in Chrome, Edge, or Safari, with no server of its own.  It's plain HTML, CSS, and JavaScript, with no framework and no build step.
- It reads your work from small files in a synced folder (for example OneDrive), and it keeps everything in that folder, encrypted with a passphrase only you know.
- It can be installed as an app (a PWA) when it's served over https, for example from GitHub Pages.
- It never sends your data anywhere except, if you choose, a private GitHub repo as encrypted blobs.

## 2. The parts

| Part | What it does | Example |
|---|---|---|
| Snapshot | One JSON file, rebuilt each morning, with your tasks, accounts, and meetings | `inbox-snapshot.json` |
| Builder | A small script that turns your notes into the snapshot | Described in section 4 |
| Dashboard | The web page that reads the snapshot and shows views | `index.html` plus `js/*.js` |
| Stores | Your own changes (time logged, done ticks, imports), encrypted | `time-store.json.enc` |
| Hub (optional) | A private GitHub repo that copies the encrypted stores between computers | `owner/my-dashboard-data` |

## 3. Views worth building

- **Daily Focus:** a few big squares (Due today, Overdue, Waiting, Going cold) and today's meetings.
- **Timer bar:** pick a group (Work, Touch, Travel, or Relationship), a type, and an account, then Start.  Stop writes one entry.  Add past entries with a duration such as `1h30`.
- **Time report:** totals by group, type, and account for a week (Monday to Sunday) or a month, with a CSV export.
- **Agenda:** week, day, and month views of meetings, events, and trips.  Hotels show as all-day for each night.  Flights show as timed blocks.
- **Log touch:** one dialog for a call, an in-person meeting, an email, or a Teams or text message, with an optional time entry.
- **Quick Launch:** a row of buttons for the things you open most.
- **Manager report:** pick the bullets from a monthly Markdown file, preview them, and copy them as plain text, Markdown, or a Word file.

## 4. How the builder works (example data only)

The builder reads your notes and writes the snapshot.  Here is the idea with example data.  The real field rules are in `docs/inbox-snapshot-schema.md`, and the example below follows them.

Input, a few lines in a Markdown notes file (this input format is only an illustration, and you can use any format your builder understands):

```markdown
- [ ] Follow-ups: send revised scope sheet, Northwind Example, Jordan P., due 2026-11-04
- [x] Account touches: book the site visit, Contoso Example
- [waiting] Waiting on: confirm the room size, Fabrikam Example, due 2026-11-06
```

Output, part of the snapshot (`docs/inbox-snapshot-schema.md` §2 and §3):

```json
{
  "schema_version": 1,
  "generated_at": "2026-11-02T07:30:00-06:00",
  "source": "inbox-export",
  "example": true,
  "tasks": [
    { "id": "ex-t1", "list": "Follow-ups", "title": "send revised scope sheet", "account": "Northwind Example", "person": "Jordan P.",
      "next_date": "2026-11-04", "status": "not_started", "last_modified": "2026-11-01T16:10:00-06:00", "withhold": false },
    { "id": "ex-t2", "list": "Account touches", "title": "book the site visit", "account": "Contoso Example", "person": null,
      "next_date": null, "status": "done", "last_modified": "2026-11-01T11:00:00-06:00", "withhold": false, "completed_at": "2026-11-01T11:00:00-06:00" },
    { "id": "ex-t3", "list": "Waiting on", "title": "confirm the room size", "account": "Fabrikam Example", "person": null,
      "next_date": "2026-11-06", "status": "waiting", "last_modified": "2026-10-28T09:00:00-05:00", "withhold": false }
  ],
  "accounts": [
    { "name": "Northwind Example", "tier": "T1", "domains": ["northwind.example"] },
    { "name": "Contoso Example", "tier": "other" },
    { "name": "Fabrikam Example", "tier": "other" }
  ],
  "calendar": [],
  "time": null
}
```

The rules the builder follows:

1. Read each line, decide its status, and pull out the list, the action, the account, and the due date.
2. Match account names against a list of known accounts.  Put anything it can't match in a separate "unmatched" list instead of guessing.
3. Read each optional feed (events, usage, and time) on its own.  If one is missing or broken, set it to `null`, write one log line that names the problem but not the contents, and carry on.
4. Check every text field for things that must never be in the snapshot, such as prices or email addresses, and drop that item.
5. Write the snapshot to a temporary file and rename it, so the dashboard never reads a half-written file.

## 5. Settings: `config.js` and `config.local.js`

`config.js` is in the repo and holds safe defaults.  Copy `config.local.example.js` to `config.local.js` for anything personal.  `config.local.js` is git-ignored, loads after `config.js`, and may be missing.  It isn't on GitHub Pages, so a hosted copy uses the defaults.

Parameters in `config.local.example.js` (all optional, example values):

| Parameter | Example | What it does |
|---|---|---|
| `legacyDbNames` | `["old-dashboard-db"]` | Older IndexedDB database names to copy the browser cache from, once. |
| `legacyTimeKinds` | `["old-time-log"]` | Older `kind` values still accepted in `time-<machine>.json`. |
| `snapshotNames` | `["old-snapshot.js", "old-snapshot.json"]` | Extra snapshot file names read from the Data folder. |
| `internalAccountLabel` | `"Internal (Example Co)"` | What the fixed "Internal" time account is called on screen. |
| `managerName` | `"Alex"` | The name on the Quick Launch report button and "Copy for <name>".  "Manager" if unset. |
| `reportNameLine` | `"Jordan P.:"` | The first line of the pasted manager report, if the monthly file has none. |

Other settings you can override the same way (defaults from `config.js`): `tier1Accounts` (`[]`), `snapshotPath` (`"Data/inbox-snapshot.js"`), `notebookLogPath` (`"Data/notebook-log.js"`), `examplePath` (`"examples/example-snapshot.js"`), `staleHours` (`24`), `holdHours` (`24`), `focusRowCap` (`12`), `pollSeconds` (`60`), `projectOwners` (`[]`), and `notebookLogNames` (`[]`).  Put real names only in `config.local.js`, never in `config.js`.

## 6. Hosting

The app is static files, so any static host works.  There is no server code and no build step.

- **Open the file.**  Put the app in a synced folder (for example `<synced folder>/Dashboard/`) and open `index.html` in Chrome or Edge.  This is enough on one computer.
- **GitHub Pages.**  Push the app (never the `Data/` folder) to a repo, then Settings → Pages → Deploy from a branch → `main` / root.  The https address lets you install it as an app (Edge: ⋯ → Apps → Install this site as an app; iPad Safari: Share → Add to Home Screen).
- **Any other static host** (an internal web server, Azure Static Web Apps, Netlify, and so on) works the same way.  Serve it over https, and keep the Content Security Policy in `index.html`.
- `sw.js` caches the app for offline use.  Change its `REV` with every release so browsers pick up the new files.

## 7. Data folder and encryption

1. **Name each computer** on first run (for example `laptop` or `desk`).  It goes into file names such as `time-laptop.json`.
2. **Connect the Data folder:** click "Connect Data folder", pick `Dashboard/Data` (capital D) in your synced folder, and allow edit.  The app ships no `Data/` folder, so updates never overwrite it.
3. **Encrypt:** File → Encryption…, choose a passphrase of 12 or more characters, save the recovery key in a password manager, and print a copy.  From then on every data file is an AES-256-GCM envelope (`*.json.enc`), and the browser cache is encrypted too.  A plain file dropped into an encrypted folder is checked, encrypted, and then deleted.
4. **Other computers:** open the app, connect the same folder, and enter the same passphrase.
5. **Optional GitHub sync:** create an empty private repo, make a fine-grained token on each device (only that repo, Contents read and write), and enter it under File → GitHub sync….  Only encrypted files are sent, under opaque names.

## 8. Feed schemas

Each feed is a file the dashboard reads from the Data folder or from the snapshot.  All of them use `schema_version: 1` and ISO 8601 times with an offset.

| Feed | File | Spec |
|---|---|---|
| Inbox snapshot (tasks, accounts, touches, and meetings) | `inbox-snapshot.js` and `.json` | `docs/inbox-snapshot-schema.md` |
| Calendar and trips | `calendar-snapshot.json`, `trips.json` | `docs/calendar-feed-schema.md` |
| Projects | `projects.json`, `projects-store.json` | `docs/projects-feed-schema.md` |
| Events | the snapshot's `events[]`, plus an imported `events.md` | Below |
| Usage | the snapshot's `usage` block | Below |
| Time | the snapshot's `time` block | `docs/time-feed-schema.md` |

**Events.**  The snapshot's optional `events[]` holds dates, times, and places from a shared events calendar:

```json
{ "id": "ev-expo-1", "title": "Example Expo 2026", "start_date": "2026-11-18", "end_date": "2026-11-20", "all_day": true,
  "start": null, "end": null, "zone": "America/Chicago", "location": "Hall B, Springfield", "category": null, "show_as": null }
```

`title`, `start_date`, `end_date`, and `all_day` are required.  A timed event (`all_day: false`) needs `start` and `end` with an offset.  `zone` is an IANA zone.  A bad item is dropped and the rest are kept.  Details come from an `events.md` file (File → Import events (events.md)…) with front matter `type: data` and a table with these 14 columns: event, start date, end date, location, series/organizer, status, role, target accounts, registration deadline, room-block deadline, travel, trip ref, follow-ups, and source note.  See `examples/example-events.js` and `tests/fixtures/example-events.md`.

**Usage.**  The snapshot's optional `usage` block feeds the usage square on Daily Focus:

```json
{ "as_of": "2026-11-02T07:00:00-06:00", "weekly_used_pct": 42, "weekly_resets": "2026-11-06T00:00:00-06:00",
  "on_demand_pct": 18.5, "on_demand_maxed": false, "on_demand_resets": "2026-11-04T00:00:00-06:00", "detail_url": "https://usage.example/dashboard" }
```

The three times need an offset, the two percents are numbers from 0, and `on_demand_maxed` is true or false.  `detail_url` is kept only if it is https with no user name or password.  Percentages only, never dollar amounts.

The time feed is described in full in `docs/time-feed-schema.md`.

## 9. Security habits

- Keep real data out of the code repo.  Put only fictional examples there, and add a check script that fails if anything real slips in.
- Encrypt in the browser with the Web Crypto API (AES-GCM, with a key derived from your passphrase).  Never store the passphrase.
- Use a strict Content Security Policy (`script-src 'self'`) and no outside scripts.
- Label anything you print or copy with your company's classification label, if it has one.
- Test with example data and a scratch copy of any real folder, never the real folder itself.

## 10. A build prompt you can paste

This prompt works with any AI coding assistant.  Change the parts in angle brackets.

```text
You are helping me build a local-first activity dashboard as a single-page web app.

Rules:
- Plain HTML, CSS, and JavaScript only.  No frameworks, no build step, and no outside scripts.
  Use a Content Security Policy of script-src 'self'.
- Keep each feature in its own small file of pure functions (no DOM), with unit tests in Node,
  and a thin UI layer that calls them.
- All data lives in a folder I pick with the File System Access API.  Encrypt every file
  with AES-GCM using a key derived from my passphrase (PBKDF2, 600000 rounds).  Never store
  the passphrase.  On Safari or iPad, fall back to IndexedDB.
- Use only made-up example data in the code and tests, such as "Northwind Example".
- Every time shown is in <my time zone>, with a zone label.

Build in this order, with tests for each step:
1. Read a JSON snapshot of tasks, accounts, and meetings (I'll give you the format) and
   show a Daily Focus view with Due today, Overdue, Waiting, and Going cold squares.
2. A timer bar: group, type, account, Start and Stop, and Add past with a duration.
   Save entries in an encrypted time store, merged by id with the newest change winning.
3. A time report by week (Monday to Sunday) and month, with a CSV export.
4. An Agenda view with week, day, and month modes.
5. A Log touch dialog for calls, meetings, emails, and messages.

Ask me before adding anything that sends data off my computer.
```

### Notes for GitHub Copilot

- Use Copilot Chat in agent mode in VS Code, and paste the prompt above as the first message.
- Keep the repo open in the workspace so it can read the existing files, and ask for one numbered step at a time.
- Run the tests yourself after each step (`node tests/<name>.test.js`), and paste any failures back into the chat.

### Notes for Grok Bot

- Paste the prompt above and ask Grok Bot to plan first, then build one step at a time as local commits.
- Ask it to run the tests and take screenshots with example data after each step, so you can check the views before moving on.
- Tell it which folders it may write to, and that it must never push or publish without asking you.

## 11. Checklist before you use real data

- [ ] All tests pass with example data.
- [ ] The check script finds no real names, accounts, or figures in the repo.
- [ ] Encryption is on, and you've saved the recovery key somewhere safe.
- [ ] You've tried a missing file and a broken file, and the dashboard still opens.
