"""Writes the FICTIONAL example snapshot in the final Inbox Exporter schema v1
(handoff/inbox-snapshot-schema.md). Placeholder people, .example domains. Never real data."""
import json, pathlib
HERE = pathlib.Path(__file__).resolve().parent
BUILD_DATA = HERE.parent / "examples"
HANDOFF = HERE.parents[2] / "handoff"
def T(i, lst, title, account, person, nd, status, mod, withhold=False, est=None, imp=None):
    t = {"id": f"EX-{i}", "list": lst, "title": title, "account": account, "person": person, "next_date": nd,
         "status": status, "last_modified": mod, "withhold": withhold}
    if est: t["est_minutes"] = est
    if imp: t["importance"] = imp
    return t
M = lambda d, h="09:00": f"2026-{d}T{h}:00-05:00"
tasks = [
 T(1, "Follow-ups", "send revised scope sheet", "Account A", "Jordan P.", "2026-10-16", "not_started", M("10-12"), est=30, imp="high"),
 T(2, "Follow-ups", "send riser layout markup", "Account B", "Alex R.", "2026-10-19", "in_progress", M("10-18", "16:00"), est=15),
 T(3, "Follow-ups", "answer spec comments", "Acme Fab", "Priya M.", "2026-10-21", "not_started", M("10-16")),
 T(4, "Follow-ups", "send intro deck", "Globex Mfg", None, "2026-10-23", "not_started", M("10-02"), withhold=True),
 T(5, "Follow-ups", "confirm site walk date", "Contoso Labs", "Sam K.", "2026-10-20", "not_started", M("10-17"), est=10),
 T(6, "Follow-ups", "plan Q1 training outline", "Account B", "Alex R.", "2026-10-30", "not_started", M("10-14")),
 T(7, "Follow-ups", "book Account E lunch sync", "Account E", "Dana L.", "2026-10-19", "not_started", M("10-16"), est=10),
 T(8, "Follow-ups", "draft pricing summary", "Account C", "Chris T.", "2026-10-22", "not_started", M("10-15"), withhold=True),
 T(9, "Waiting on", "return signed SLA terms", "Account C", "Chris T.", "2026-10-17", "blocked", M("10-01")),
 T(10, "Waiting on", "approve travel request", "Globex Mfg", "Jordan P.", "2026-10-21", "waiting", M("10-14")),
 T(11, "Waiting on", "share compliance docs", "Contoso Labs", "Sam K.", "2026-10-22", "waiting", M("10-13")),
 T(12, "Waiting on", "send test results", "Acme Fab", "Priya M.", "2026-10-28", "waiting", M("10-16")),
 T(13, "Waiting on", "confirm venue booth size", "Account E", "Dana L.", None, "waiting", M("09-30")),
 T(14, "Account touches", "confirm walkthrough date", "Northwind DC", None, "2026-10-15", "not_started", M("09-28")),
 T(15, "Account touches", "check in with new liaison", "Account A", None, "2026-10-20", "not_started", M("10-05"), est=15),
 T(16, "Account touches", "plan quarterly touch", "Account D", None, "2026-10-26", "not_started", M("10-16")),
 T(17, "Account touches", "share event invite", "Account C", None, "2026-10-24", "not_started", M("10-17"), est=15),
 T(18, "Travel", "fly to Austin office", "Account D", "Chris T.", "2026-10-22", "not_started", M("10-15")),
 T(19, "Travel", "book hotel for Contoso visit", "Contoso Labs", "Me", "2026-10-27", "not_started", M("10-16")),
 T(20, "Follow-ups", "send meeting recap", "Acme Fab", "Priya M.", "2026-10-14", "done", M("10-14"), ),
]
tasks[-1]["completed_at"] = M("10-14", "15:00")
accounts = [
 {"name": "Account B", "tier": "T1", "domains": ["account-b.example"]}, {"name": "Account A", "tier": "T1", "domains": ["account-a.example"]},
 {"name": "Account C", "tier": "T1", "domains": ["account-c.example"]}, {"name": "Account D", "tier": "T1", "domains": ["account-d.example"]},
 {"name": "Account E", "tier": "T1", "domains": ["account-e.example"]}, {"name": "Acme Fab", "tier": "other", "domains": ["acmefab.example"]},
 {"name": "Northwind DC", "tier": "other", "domains": ["northwind.example"]}, {"name": "Contoso Labs", "tier": "other", "domains": ["contoso.example"]},
 {"name": "Globex Mfg", "tier": "other", "domains": ["globex.example"]},
]
touches = [
 {"account": "Account A", "date": "2026-10-12", "direction": "outbound", "kind": "email"},
 {"account": "Contoso Labs", "date": "2026-10-15", "direction": "inbound", "kind": "email"},
 {"account": "Northwind DC", "date": "2026-10-08", "direction": "outbound", "kind": "meeting_proposed", "meeting_date": None},
]
calendar = [
 {"id": "CAL-1", "start": M("10-19", "08:00"), "end": M("10-19", "08:30"), "title": "Standup (internal)", "attendee_domains": ["example.com"]},
 {"id": "CAL-2", "start": M("10-19", "10:00"), "end": M("10-19", "11:00"), "title": "Account A design review prep", "location": "Desk", "attendee_domains": ["account-a.example", "example.com"], "account": "Account A"},
 {"id": "CAL-3", "start": M("10-19", "10:30"), "end": M("10-19", "11:30"), "title": "Contoso call", "attendee_domains": ["contoso.example"], "account": "Contoso Labs"},
 {"id": "CAL-4", "start": M("10-19", "14:00"), "end": M("10-19", "14:45"), "title": "DesignTool webinar dry run", "attendee_domains": ["corp-intl.example"]},
 {"id": "CAL-5", "start": M("10-20", "09:00"), "end": M("10-20", "09:30"), "title": "Flight check-in reminder", "attendee_domains": []},
]
keys = ["overdue","dueToday","thisWeek","iOwe","owedToMe","goingCold","followUps","waitingOn","accountTouches","travel"]
series = {"overdue":[2,1,3,2,1,2,1],"dueToday":[3,5,2,4,3,4,4],"thisWeek":[7,9,8,11,10,8,10],"iOwe":[5,6,6,8,7,5,6],
          "owedToMe":[2,3,3,4,4,5,5],"goingCold":[1,2,2,3,4,3,3],"followUps":[6,7,6,8,9,7,7],"waitingOn":[3,4,4,5,4,5,5],
          "accountTouches":[5,6,7,6,8,9,8],"travel":[1,0,2,1,1,0,0]}
weeks = ["08-31","09-07","09-14","09-21","09-28","10-05","10-12"]
hist = [{"generated_at": M(w, "07:30"), "totals": {k: series[k][i] for k in keys}} for i, w in enumerate(weeks)]
snap = {"schema_version": 1, "generated_at": M("10-19", "07:30"), "source": "inbox-export", "example": True,
        "tasks": tasks, "accounts": accounts, "touches": touches, "calendar": calendar, "totals_history": hist}
body = json.dumps(snap, indent=1)
for d, var, stem in ((BUILD_DATA, "DASH_EXAMPLE_SNAPSHOT", "example-snapshot"), (HANDOFF, "DASH_SNAPSHOT", "example-snapshot")):
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{stem}.json").write_text(body + "\n")
    (d / f"{stem}.js").write_text(f"/* EXAMPLE DATA - fictional Inbox Exporter snapshot (schema_version 1). */\nwindow.{var} = {body};\n")
    print("wrote", d / f"{stem}.js", d / f"{stem}.json")
