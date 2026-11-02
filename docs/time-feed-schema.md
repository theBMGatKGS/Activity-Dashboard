# Time feed schema (00.11.000)

The time feed is how time that you log outside the dashboard (for example by texting an assistant "90m drive, Travel, Northwind") reaches the timer bar and the time report.  The daily snapshot build reads one JSON file, checks it, and copies the good entries into the snapshot's optional `time` block.  The dashboard merges that block into its own encrypted time store (`time-store.json.enc`).

Everything in this document uses fictional example data.

## File

```json
{
  "schema_version": 1,
  "generated_at": "2026-11-02T18:00:00-06:00",
  "source": "assistant-texts",
  "entries": [
    {
      "id": "T-20261102-0a1b2c3d",
      "date": "2026-11-02",
      "start": "06:30",
      "minutes": 90,
      "group": "travel",
      "type": "driving",
      "account": "Northwind Example",
      "project": null,
      "notes": "Drive to the plant",
      "x_text": "90m drive, Travel, Northwind"
    }
  ]
}
```

## Top level

| Field | Required | Rule |
|---|---|---|
| `schema_version` | yes | Must be `1`.  Anything else and the whole `time` block is null. |
| `generated_at` | yes | ISO 8601 with an offset or `Z`.  It is the time stamp used when merging. |
| `source` | no | Free text, for example `assistant-texts`.  Only the first 40 characters are kept. |
| `entries` | yes | An array of up to 5000 entries.  An empty array is fine. |

## Entry

| Field | Required | Rule |
|---|---|---|
| `id` | yes | `T-YYYYMMDD-xxxxxxxx`, where the last part is 8 lower-case hex digits.  It never changes once written, so a later correction with the same id replaces the earlier one. |
| `date` | yes | `YYYY-MM-DD`, a real calendar day, in Central Time. |
| `start` | yes | `HH:MM`, 24-hour, Central Time. |
| `minutes` | yes | A whole number from 1 to 1440. |
| `group` | yes | `work`, `touch`, `travel`, or `relationship`. |
| `type` | yes | One of the types for that group (below). |
| `account` | yes | An account name, `Internal`, or `Travel/General`.  An unknown account is kept and listed in the dashboard's review chip. |
| `project` | no | Null or text up to 100 characters. |
| `notes` | no | Null or text up to 500 characters. |
| `x_text` | no | Null or the original text message, up to 200 characters. |

Types by group:

| Group | Types |
|---|---|
| `work` | `research`, `design`, `drafting`, `coordination`, `configuration`, `review_qa`, `quoting_bom`, `training`, `admin` |
| `touch` | `call`, `in_person`, `email`, `teams_text` |
| `travel` | `flight`, `rideshare`, `driving`, `airport_wait` |
| `relationship` | `meal`, `social`, `conference` |

## What is refused

- An entry that breaks a rule above is dropped and counted.  The log line names the rule, never the entry's text.
- Any text field that holds a dollar figure or an email address is dropped the same way.
- A second entry with the same id in one file is dropped, and the first is kept.
- A missing file, a file that isn't JSON, or a bad top level gives `time: null`.  The build still succeeds.
- Fields that aren't in the table are never copied.

## Merging in the dashboard

- The newest `updated_at` for each id wins.  A feed entry takes the feed's `generated_at` as its `updated_at`.  On an exact tie the dashboard's own copy is kept.
- A deleted entry is kept as a tombstone so another computer can't bring it back.
- The store is only saved when the Data folder is encrypted and unlocked.  Nothing is written in plaintext or on EXAMPLE DATA.
