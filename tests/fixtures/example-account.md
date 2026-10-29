---
account: Acme Fab
slug: example-account
tier: key
segment: owner-operator (fictional)
region: Example Region North
status: draft
last_updated: 2026-10-15
touch_cadence: biweekly
confidential: internal
last_touch: {date: 2026-10-01, type: meeting, with: "Jordan P. (operations lead)"}
next_touch: {date: 2026-10-15, type: call, with: "Jordan P."}
next_move: {action: "Send the riser layout review to the site team", owner: "Chris T.", due: 2026-10-16}
open_loops:
  - {item: "Send riser layout markup", bucket: Follow-ups, next_date: 2026-10-16}
  - {item: "Spacing review notes from the site team (unverified)", bucket: Waiting on, next_date: 2026-10-21}
  - {item: "Quarterly check-in with the operations lead", bucket: Account touches, next_date: 2026-10-28}
  - {item: "Site visit week of Nov 9", bucket: Travel, next_date: 2026-11-09, task_id: ""}
sources:
  - accounts/owner-operators/example-account.md
  - meetings/2026-10-01-example-account-review.md
unverified_count: 2
---
# Acme Fab — strategic account plan (fictional example)

## 1. What is happening
- Acme Fab is expanding its example campus with two new halls. Detection layouts for hall 2 are in review.
- The operations lead asked for a standard riser layout (unverified).

## 2. Who influences the business
| Name | Org | Role | Influence | Sentiment | Last touch | Notes |
|---|---|---|---|---|---|---|
| Jordan P. | Acme Fab | Operations lead | High | Champion | 2026-10-01 | Wants a standard layout |
| Alex R. / Priya M. (unverified) | Acme Fab | Facilities | Medium | Neutral | unknown | Shared inbox |
| Sam K. | Example Engineers | Engineer of record | Low | Skeptic | 2026-09-20 | Prefers the old design |

## 3. What they are trying to accomplish
- Standardize detection across both halls and cut commissioning time.

## 4. Opportunities
| Opportunity | Stage | Next step | Next step date |
|---|---|---|---|
| Hall 2 detection standard | Develop | Review layout with the site team | 2026-10-16 |
| Training for the site team (unverified) | Qualify | Ask the operations lead for dates | 2026-11-02 |

## 5. Relationship building
Last touch: 2026-10-01 | meeting | Jordan P. (operations lead)
Next touch: 2026-10-15 | call | Jordan P.
Cadence: biweekly

## 6. Next strategic move
Action: Send the riser layout review to the site team
Owner: Chris T.
Due: 2026-10-16

## Sources & unverified items
- The riser layout request was seen once in meeting notes (unverified).
- Spacing review notes are expected from the site team (unverified).
