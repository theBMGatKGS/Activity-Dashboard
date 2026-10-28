# Projects: file contracts (schema_version 1, Activity Dashboard 00.07.000)

## 1. `projects-store.json` (the source of truth, written by the dashboard)
Ruling Oct 27 2026: "Projects is the source of truth and exports Planner-ready CSV, xlsx and Graph JSON". The dashboard writes the store only as `projects-store.json.enc` (purpose `projstore`) when the Data folder is encrypted and unlocked, and keeps it in IndexedDB under SECRET key `projectsStore`. Never plaintext, never in git. Newest `updated_at` wins.

`{schema_version: 1, updated_at, plans: [{id, name, buckets: [{id, name}], tasks: [{id, title, bucketId, assignees: [names], status, percent, start, due, priority, labels: [], notes, account, completedOn, checklist: [{id, title, done}]}]}]}`

Rules: names only (no "@"); real YYYY-MM-DD dates, due ≥ start; percent 0–100; priority urgent/important/medium/low; checklist ≤ 20 items, titles ≤ 100; notes ≤ 2000; **no pricing or dollar figures** in any text.

Exports (files only, nothing calls Planner or Graph): Planner CSV (Planner's "Export plan to Excel" columns), xlsx (same columns, one sheet per plan), Graph JSON (`plannerPlan`, `plannerBucket`, `plannerTask`, `plannerTaskDetails`; writable Graph fields only; checklist keys are client GUIDs, stable per item; no orderHint (the service sets it); start/due dates are local midnight of the exporting computer's zone in UTC so Planner shows the same date; ids, refs, owner names, counts and completion date are `x_` hints for the importer). Planner has no CSV/xlsx import: those two match Planner's "Export plan to Excel" layout.

## 2. `projects.json` (optional Planner export feed, import only)

The optional feed is read from one file, `projects.json`, **only when encrypted** (`projects.json.enc`, AES-256-GCM envelope with the Data folder's keyring, envelope `purpose` = `projects`; on the GitHub hub it travels as an opaque `blob-<32 hex>.enc`). A plaintext copy dropped into an *encrypted* Data folder is validated and encrypted in place; in an *unencrypted* folder it is ignored and reported. Never commit it to git. Nothing is ever written back to Planner.

Writer: the executive assistant (Cadence) or a Power Automate flow with the same contract. Replace the whole file each run; the newest `generated_at` wins.

```json
{
  "schema_version": 1,
  "generated_at": "2026-10-19T06:45:00-05:00",
  "source": "planner-export",
  "plans": [
    {
      "id": "PLAN-A",
      "name": "Accounts",
      "buckets": [{ "id": "B1", "name": "Follow-ups" }],
      "tasks": [
        {
          "id": "PT-1",
          "title": "Send riser layout markup",
          "bucketId": "B1",
          "assignees": ["Jordan P."],
          "status": "inProgress",
          "percent": 50,
          "start": null,
          "due": "2026-10-16",
          "priority": "urgent",
          "labels": ["Acme Fab"],
          "checklist": { "done": 1, "total": 3 },
          "account": "Acme Fab",
          "completedOn": null
        }
      ]
    }
  ]
}
```

| Field | Rule |
|---|---|
| `schema_version` | must be `1` (else the whole file is refused) |
| `generated_at` | ISO 8601 with offset |
| `plans[].id`, `.name`, `.tasks` | required; a plan without them is skipped and listed |
| `tasks[].id` | required, unique in the plan |
| `tasks[].title` | required, ≤ 200 chars kept |
| `tasks[].assignees` | **names only**. Any `@`, or an `assigneeEmails` / `emails` field, rejects the task |
| `tasks[].status` | `notStarted`, `inProgress` or `completed` (Planner's three) |
| `tasks[].percent` | 0–100; missing = 0 / 50 / 100 by status |
| `tasks[].start`, `.due` | `YYYY-MM-DD` real dates or null; due not before start |
| `tasks[].priority` | `urgent`, `important`, `medium` (default) or `low` |
| `tasks[].bucketId` | unknown bucket → "No bucket" |
| `labels`, `checklist {done,total}`, `account`, `completedOn` | optional |

Rejected tasks are counted ("⚠ n task(s) skipped") and listed under **Skipped tasks**; the rest load.

File → Import Planner export into Projects copies its plans, buckets and tasks into the store (tasks already in the store are kept).
