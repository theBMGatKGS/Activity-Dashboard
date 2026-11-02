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

The builder reads your notes and writes the snapshot.  Here is the idea with example data.

Input, a few lines in a Markdown notes file:

```markdown
- [ ] Send the revised quote to Northwind Example (due 2026-11-04) #account/northwind
- [x] Book the site visit for Contoso Sample
- [waiting] Fabrikam Demo to confirm the room size (since 2026-10-28)
```

Output, part of the snapshot:

```json
{
  "generated": "2026-11-02T08:00:00-06:00",
  "tasks": [
    { "id": "t1", "title": "Send the revised quote", "account": "Northwind Example", "due": "2026-11-04", "status": "open" },
    { "id": "t2", "title": "Book the site visit", "account": "Contoso Sample", "due": null, "status": "done" },
    { "id": "t3", "title": "Confirm the room size", "account": "Fabrikam Demo", "due": null, "status": "waiting", "since": "2026-10-28" }
  ],
  "time": null
}
```

The rules the builder follows:

1. Read each line, decide its status from the box (`[ ]`, `[x]`, or `[waiting]`), and pull out a due date and an account tag.
2. Match account names against a list of known accounts.  Put anything it can't match in a separate "unmatched" list instead of guessing.
3. Read each optional feed (calendar, usage, time) on its own.  If one is missing or broken, set it to `null`, write one log line that names the problem but not the contents, and carry on.
4. Check every text field for things that must never be in the snapshot, such as prices or email addresses, and drop that item.
5. Write the snapshot to a temporary file and rename it, so the dashboard never reads a half-written file.

The time feed format is in `docs/time-feed-schema.md`.

## 5. Security habits

- Keep real data out of the code repo.  Put only fictional examples there, and add a check script that fails if anything real slips in.
- Encrypt in the browser with the Web Crypto API (AES-GCM, with a key derived from your passphrase).  Never store the passphrase.
- Use a strict Content Security Policy (`script-src 'self'`) and no outside scripts.
- Label anything you print or copy with your company's classification label, if it has one.
- Test with example data and a scratch copy of any real folder, never the real folder itself.

## 6. A build prompt you can paste

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

## 7. Checklist before you use real data

- [ ] All tests pass with example data.
- [ ] The check script finds no real names, accounts, or figures in the repo.
- [ ] Encryption is on, and you've saved the recovery key somewhere safe.
- [ ] You've tried a missing file and a broken file, and the dashboard still opens.
