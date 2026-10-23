# Inbox Exporter snapshot: FINAL spec, schema_version 1
For: **Inbox Exporter** (owner and only writer of the snapshot). Reader: **Activity Dashboard 00.01.000**.
Status: final for build 00.01.000 (Oct 2026). Design rules: the snapshot is git-ignored and synced via the user's cloud folder; only items tagged by hand are withheld; activity is any To Do edit, logged time entry, or meeting with that account; audience and subject are guessed from attendees and title and can be changed.

## 1. Where and how to write it
- **Output path:** `<synced folder>/Dashboard/Data/inbox-snapshot.js` **and** `.../Dashboard/Data/inbox-snapshot.json` (capital **D** in `Data`), with the same content in both. The exporter copies them there after each run.
- The Dashboard folder is not a git repo; the files reach the user's machines through **OneDrive** only. Never commit them anywhere. The app ships no `Data/` folder, so app updates never overwrite them.
- `.js` = exactly `window.DASH_SNAPSHOT = <JSON>;` followed by a newline. The dashboard opens as a local file (`file://`), and browsers only allow it to load a `<script>`, not to fetch `.json`. `.json` = the bare JSON object (used for File → Open snapshot… and by people).
- Write atomically: write `inbox-snapshot.js.tmp`, then rename it over the target, and do the same for `.json`. UTF-8, no BOM.
- Inbox Exporter reads **Outlook web / To Do read-only**. The snapshot is the only thing it writes for the dashboard. The dashboard never writes back to To Do, Outlook or this file.
- How often: at least once each business morning before 8 AM CT (the dashboard shows amber ⚠ Stale when `generated_at` is more than 24 h old).

## 2. Top level
| Field | Type | Req. | Notes |
|---|---|---|---|
| `schema_version` | integer | yes | `1`. The dashboard rejects unknown major versions with a clear message. |
| `generated_at` | string | yes | ISO 8601 **with offset, Central Time**, e.g. `"2026-10-19T07:30:00-05:00"` (CDT) / `-06:00` (CST). Shown as the "As of …" stamp. |
| `source` | string | yes | exactly `"inbox-export"`; any other value (or missing) rejects the file. |
| `example` | boolean | no | `true` only in fictional example files (the dashboard then shows the EXAMPLE DATA badge). Inbox Exporter never sets it. |
| `tasks` | array | yes | §3. All open To Do tasks from the four lists, plus tasks completed in the last 14 days. |
| `accounts` | array | yes | §4. |
| `touches` | array | no | §5. Default `[]`. |
| `calendar` | array | yes | §6. Today and tomorrow at least (CT); up to 7 days ahead allowed. |
| `totals_history` | array | no | §7. Default `[]`. |

## 3. `tasks[]`
| Field | Type | Req. | Notes |
|---|---|---|---|
| `id` | string | yes | The To Do task id. Must be stable across snapshots; unique within the file. |
| `list` | enum | yes | exactly one of `"Follow-ups"`, `"Waiting on"`, `"Account touches"`, `"Travel"` |
| `title` | string | yes | the action, verb first, **without** the person or account (e.g. `"send revised scope sheet"`). ≤ 60 chars recommended; the dashboard builds `Person/account: action · Weekday M/D` and cuts it at 69 chars with "…". |
| `account` | string \| null | yes | must equal an `accounts[].name`, or `null` |
| `person` | string \| null | yes | display name only (e.g. `"Jordan P."`). Never an email address or phone number. `null` → the line starts with the account, or "Me". |
| `next_date` | string \| null | yes | `"YYYY-MM-DD"` (CT calendar day): the To Do due date |
| `status` | enum | yes | `"not_started"`, `"in_progress"`, `"waiting"`, `"blocked"`, `"done"`, `"deferred"`. Mapping from To Do: notStarted → not_started, inProgress → in_progress, waitingOnOthers → waiting, completed → done, deferred → deferred. A task with the To Do category **Blocked** → `"blocked"`. |
| `last_modified` | string | yes | ISO 8601 with offset: the To Do `lastModifiedDateTime`. It counts as activity for Going Cold. |
| `withhold` | boolean | yes | **Passed through from the To Do tag only**: `true` exactly when the task carries the To Do category **Withhold**, otherwise `false`. **Inbox Exporter never sets, infers or changes it** (no keyword guessing). `true` → the item never prints on the Manager sheet. |
| `completed_at` | string \| null | no | ISO with offset when `status = "done"` |
| `importance` | enum | no | `"low"`, `"normal"`, `"high"` |
| `est_minutes` | integer \| null | no | the estimate if the user wrote one; used for the "quick win ≤ 15 min" flag |
Not allowed in tasks: mail bodies, notes, attachments, email addresses, phone numbers, prices or amounts beyond what the title itself says.

## 4. `accounts[]`
| Field | Type | Req. | Notes |
|---|---|---|---|
| `name` | string | yes | unique display name (the tag text) |
| `tier` | enum | yes | `"T1"` (the user's top-tier accounts) or `"other"` |
| `domains` | string[] | no | the account's email domains (e.g. `["contoso.example"]`). Used to match calendar attendees to the account and to guess the audience. |

## 5. `touches[]` (customer touches Inbox Exporter found in inbox and sent mail)
| Field | Type | Req. | Notes |
|---|---|---|---|
| `account` | string | yes | an `accounts[].name` |
| `date` | string | yes | `"YYYY-MM-DD"` (CT) |
| `direction` | enum | yes | `"inbound"` or `"outbound"` |
| `kind` | enum | yes | `"email"`, `"call"`, `"meeting"`, `"meeting_proposed"`, `"linkedin"`, `"visit"` |
| `meeting_date` | string \| null | no | for `meeting_proposed` only, `null` if no date was set |
No subjects, bodies or addresses: the touch is metadata only.

## 6. `calendar[]`
| Field | Type | Req. | Notes |
|---|---|---|---|
| `id` | string | yes | stable event id (series occurrences get their own id) |
| `start`, `end` | string | yes | ISO 8601 with offset (CT); `end > start` |
| `title` | string | yes | the event subject as shown in Outlook (short) |
| `location` | string \| null | no | omit or `null` if none |
| `attendee_domains` | string[] | yes | **domains only, lower-case, de-duplicated, no full email addresses and no names** (e.g. `["example.com", "contoso.example"]`). `[]` for a private block. |
| `account` | string \| null | no | set it when an attendee domain matches `accounts[].domains`; otherwise the dashboard matches the account itself |
- `conflict` is **computed by the dashboard** (events overlap on the same day) and must not be sent.
- Audience and subject are **guessed by the dashboard** from `attendee_domains` and `title`; Inbox Exporter does not send them. Rules:
  - Audience: only internal domains → Internal - Domestic; an international internal domain or country hint → Internal - International; a mapped account domain → its audience in the editable mapping table; otherwise Owner/operator.
  - Subject: keywords in the title (training/webinar, software/product, design/review/submittal, travel/flight), else Account strategy.
- A meeting whose account matches counts as activity for Going Cold.

## 7. `totals_history[]` (optional seed for trends)
- Each entry: `{ "generated_at": ISO-with-offset, "totals": { "overdue", "dueToday", "thisWeek", "iOwe", "owedToMe", "goingCold", "followUps", "waitingOn", "accountTouches", "travel" } }` (integers), oldest first.
- Inbox Exporter may copy each earlier snapshot's own totals here (at least the last 8 weeks). The dashboard also keeps every snapshot it has seen locally and merges by `generated_at`.
- The current snapshot's totals are always **recomputed by the dashboard** from `tasks`; do not send them for the current snapshot.

## 8. Validation the dashboard applies (a row is rejected, with the reason shown)
- An unknown `list` or `status`, a `withhold` that isn't a boolean, a bad date format, an `account` not found in `accounts`, or `end <= start` rejects that row.
- An `@` anywhere in `attendee_domains` or `person` **rejects the whole snapshot**, because it would mean full emails were exported.
- `schema_version` ≠ 1, a missing `generated_at`, or `source` ≠ `"inbox-export"` rejects the file.
- A touch with an unknown `account`, a bad `date`, a `direction` other than inbound/outbound, a `kind` outside the §5 list, or a `meeting_date` on anything but `meeting_proposed` is skipped with the reason shown. An `importance` other than low/normal/high, or a `next_date` that doesn't exist (e.g. 2026-02-30), skips that task.
- The import is atomic: on failure the previous snapshot stays.

## 9. Example
See `example-snapshot.js` / `example-snapshot.json` next to this file. They are fictional: placeholder people and `.example` domains (`example.com` appears only as the internal-domain rule input; the international example domain is `corp-intl.example`).

## 10. Daily Focus (dashboard 00.05) — no schema change
Daily Focus uses schema_version 1 as is. Two optional fields may be added later (schema 1.1, older snapshots stay valid):
- `tasks[].external` (boolean): the person is outside the company. Today the dashboard infers "outside" from `account` or a local internal-people list.
- `tasks[].check_back` (YYYY-MM-DD): a separate Waiting-on check-back date. Today the Waiting on `next_date` is the check-back date.

