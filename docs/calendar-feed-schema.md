# Calendar feed and trips: file contracts (schema_version 1, Activity Dashboard 00.06.000)

Two files feed the Today strip on Daily Focus. Both are **read only when encrypted** (`calendar-snapshot.json.enc`, `trips.json.enc`, AES-256-GCM envelopes made with the Data folder's keyring; on the GitHub hub they travel as opaque `blob-<32 hex>.enc` like every other data file). A plaintext copy dropped into an *encrypted* Data folder is validated and encrypted in place by the dashboard; a plaintext copy in an *unencrypted* folder is ignored and reported. Never commit either file to git.

The envelope `purpose` is `calendar` for the calendar file and `trips` for the trips file (it is bound into the AES-GCM AAD; a file with another purpose is refused).

## 1. `calendar-snapshot.json` (writer: the calendar assistant reading Outlook web; alternative: a Power Automate flow with the same contract)
Schedule: daily 06:30 CT for today + 30 days, plus a midday refresh (about 12:30 CT). Replace the whole file each time.

```json
{
  "schema_version": 1,
  "generated_at": "2026-10-19T06:30:00-05:00",
  "source": "outlook-web",
  "range": { "from": "2026-10-19", "to": "2026-11-18" },
  "events": [
    {
      "id": "CAL-2",
      "title": "Account A design review prep",
      "start": "2026-10-19T10:00:00-05:00",
      "end": "2026-10-19T11:00:00-05:00",
      "allDay": false,
      "location": "Desk",
      "organizerDomain": "account-a.example",
      "attendeeDomains": ["account-a.example", "example.com"],
      "attendeeCount": 6,
      "teamsUrl": "https://teams.microsoft.com/l/meetup-join/…",
      "bodyExcerpt": null,
      "isPrivateHold": false,
      "accountLabel": "Account A",
      "linkedTodoIds": ["EX-2"],
      "calendar": "main"
    }
  ]
}
```

| Field | Type | Req. | Rule (the dashboard rejects the event, or drops the field, when broken) |
|---|---|---|---|
| `schema_version` | 1 | yes | anything else: whole file refused |
| `generated_at` | ISO 8601 with offset | yes | drives the "Calendar as of" chip: amber after 6 h, red after 24 h |
| `source` | string | no | e.g. `outlook-web`, `power-automate` |
| `range` | {from,to} days | no | informational |
| `events[].id` | string | yes | stable; series occurrences get their own id. The same id as the inbox snapshot's `calendar[]` replaces that entry |
| `title` | string | yes | ≤ 200 chars shown |
| `start`, `end` | ISO with offset | yes | `end > start`; the dashboard renders in the computer's own time zone |
| `allDay` | bool | no | default false; shown as a chip, not on the timeline |
| `location` | string\|null | no | ≤ 200 chars |
| `organizerDomain` | domain\|null | no | **domain only** |
| `attendeeDomains` | domain[] | yes | **lower-case domains only; no names, no email addresses** (any `@` → event rejected). `[]` for a solo block |
| `attendeeCount` | int ≥ 0 | no | default = number of domains |
| `teamsUrl` | string\|null | no | kept only if it starts with `https://teams.microsoft.com/`; otherwise dropped |
| `bodyExcerpt` | string\|null | no | **off by default (send null)**. If enabled: ≤ 280 chars, signatures, phone numbers, dial-in PINs and links removed. Shown as plain text |
| `isPrivateHold` | bool | no | solo/private block; shown dimmed, never counts as a conflict |
| `accountLabel` | string\|null | no | the account name as in the inbox snapshot's `accounts[]` |
| `linkedTodoIds` | string[] | no | To Do task ids from the inbox snapshot |
| `calendar` | `"main"`\|`"travel"` | no | default main |
| `attendees`, `organizer` | — | **must not be sent** | an event carrying either is rejected (names/emails) |

## 2. `trips.json` (writer: the travel assistant, from the Outlook Travel calendar)
```json
{
  "schema_version": 1,
  "generated_at": "2026-10-19T06:30:00-05:00",
  "trips": [
    {
      "id": "TRIP-1",
      "name": "Example site visit",
      "homeTz": "America/Chicago",
      "openLoops": ["EX-18"],
      "segments": [
        { "kind": "drive",  "start": "2026-10-19T15:15:00-05:00", "end": "2026-10-19T16:00:00-05:00", "tz": "America/Chicago", "from": "Office", "to": "Airport XYZ", "driveMin": 45 },
        { "kind": "flight", "start": "2026-10-19T17:30:00-05:00", "end": "2026-10-19T19:45:00-05:00", "tz": "America/Chicago", "from": "XYZ", "to": "ABC", "airline": "EX", "number": "123" },
        { "kind": "hotel",  "start": "2026-10-19T20:30:00-05:00", "end": "2026-10-20T07:00:00-05:00", "tz": "America/Chicago", "place": "Example Hotel ABC", "mapUrl": "https://maps.apple.com/?q=…", "cancelBy": "2026-10-19T16:00:00-05:00" }
      ]
    }
  ]
}
```

| Field | Type | Req. | Rule |
|---|---|---|---|
| `trips[].id`, `segments` | string, array | yes | trip without them is skipped |
| `name`, `homeTz` | string | no | |
| `openLoops` | string[] | no | To Do ids |
| `segments[].kind` | `flight`\|`hotel`\|`event`\|`drive` | yes | |
| `start`, `end` | ISO with offset | yes | `end ≥ start` |
| `tz` | IANA zone | no | for local-time badges (later) |
| `from`, `to`, `place` | string | no | airport codes / city / hotel name |
| `airline`, `number` | string | no | flight number only |
| `driveMin` | int | no | used for the leave-by time |
| `mapUrl` | string | no | kept only for `https://maps.apple.com…` |
| `cancelBy` | ISO with offset | no | hotel cancel-by |
| any field whose name contains confirm, pnr, record_loc, loyalty, seat, ticket or passport | — | **must not be sent** | the segment is rejected |

**Leave-by** = flight start − preceding drive (`driveMin`, else the drive's length) − 90 min airport buffer. Hotels show as "Tonight: …" chips, not timeline bands.

## 3. Calendar requests (scheduling; 00.07.000, design only, not read or written by 00.06.000)
`calendar-requests.json` (purpose `requests`): `{ requests:[{ requestId, type:"hold"|"meeting", title, start, end, location, attendees[], notes, linkedTodoId, status:"pending"|"confirmed"|"created"|"drafted"|"failed"|"cancelled", createdAt, confirmedAt, result:{eventId,message} }] }`. The dashboard sets pending/confirmed/cancelled; the calendar assistant sets created/drafted/failed. Holds without attendees are created; anything with attendees becomes a draft invite the owner sends; existing attendee events are never edited.

## 4. Access for writers (design; set up with the owner)
Each writer (calendar assistant, travel assistant or a Power Automate flow) gets its **own** fine-grained GitHub token (only the data repo, Contents read/write) and its **own keyring slot** so the owner's passphrase is never shared. Keyring slots for writers arrive in a later release; until then a writer can't produce `.enc` files and the dashboard keeps using the inbox snapshot's `calendar[]`.
