/* EXAMPLE DATA - fictional the calendar assistant calendar-snapshot and Travel trips (schema_version 1). */
window.DASH_EXAMPLE_CALENDAR = {
 "calendar": {
  "schema_version": 1,
  "generated_at": "2026-10-19T06:30:00-05:00",
  "source": "outlook-web",
  "range": {
   "from": "2026-10-19",
   "to": "2026-11-18"
  },
  "events": [
   {
    "id": "CAL-1",
    "title": "Standup (internal)",
    "start": "2026-10-19T08:00:00-05:00",
    "end": "2026-10-19T08:30:00-05:00",
    "allDay": false,
    "location": null,
    "organizerDomain": "example.com",
    "attendeeDomains": [
     "example.com"
    ],
    "attendeeCount": 5,
    "teamsUrl": "https://teams.microsoft.com/l/meetup-join/example-standup",
    "bodyExcerpt": null,
    "isPrivateHold": false,
    "accountLabel": null,
    "linkedTodoIds": [],
    "calendar": "main"
   },
   {
    "id": "CAL-6",
    "title": "Focus: NFPA 318 Fab Ceiling submittal",
    "start": "2026-10-19T09:00:00-05:00",
    "end": "2026-10-19T09:45:00-05:00",
    "allDay": false,
    "location": null,
    "organizerDomain": "example.com",
    "attendeeDomains": [],
    "attendeeCount": 0,
    "teamsUrl": null,
    "bodyExcerpt": null,
    "isPrivateHold": true,
    "accountLabel": null,
    "linkedTodoIds": [
     "EX-7"
    ],
    "calendar": "main"
   },
   {
    "id": "CAL-2",
    "title": "Account A design review prep",
    "start": "2026-10-19T10:00:00-05:00",
    "end": "2026-10-19T11:00:00-05:00",
    "allDay": false,
    "location": "Desk",
    "organizerDomain": "account-a.example",
    "attendeeDomains": [
     "account-a.example",
     "example.com"
    ],
    "attendeeCount": 6,
    "teamsUrl": "https://teams.microsoft.com/l/meetup-join/example-review",
    "bodyExcerpt": "Agenda: detector spacing, sampling-pipe layout, submittal date.",
    "isPrivateHold": false,
    "accountLabel": "Account A",
    "linkedTodoIds": [
     "EX-2"
    ],
    "calendar": "main"
   },
   {
    "id": "CAL-3",
    "title": "Contoso call",
    "start": "2026-10-19T10:30:00-05:00",
    "end": "2026-10-19T11:30:00-05:00",
    "allDay": false,
    "location": null,
    "organizerDomain": "contoso.example",
    "attendeeDomains": [
     "contoso.example"
    ],
    "attendeeCount": 3,
    "teamsUrl": null,
    "bodyExcerpt": null,
    "isPrivateHold": false,
    "accountLabel": "Contoso Labs",
    "linkedTodoIds": [],
    "calendar": "main"
   },
   {
    "id": "CAL-4",
    "title": "DesignTool webinar dry run",
    "start": "2026-10-19T14:00:00-05:00",
    "end": "2026-10-19T14:45:00-05:00",
    "allDay": false,
    "location": null,
    "organizerDomain": "corp-intl.example",
    "attendeeDomains": [
     "corp-intl.example"
    ],
    "attendeeCount": 4,
    "teamsUrl": null,
    "bodyExcerpt": null,
    "isPrivateHold": false,
    "accountLabel": null,
    "linkedTodoIds": [],
    "calendar": "main"
   },
   {
    "id": "CAL-8",
    "title": "Example Account B check-in",
    "start": "2026-10-21T13:00:00-05:00",
    "end": "2026-10-21T13:30:00-05:00",
    "allDay": false,
    "location": null,
    "organizerDomain": "example.com",
    "attendeeDomains": [
     "account-b.example",
     "example.com"
    ],
    "attendeeCount": 3,
    "teamsUrl": null,
    "bodyExcerpt": null,
    "isPrivateHold": false,
    "accountLabel": "Account B",
    "linkedTodoIds": [],
    "calendar": "main"
   }
  ]
 },
 "trips": {
  "schema_version": 1,
  "generated_at": "2026-10-19T06:30:00-05:00",
  "trips": [
   {
    "id": "TRIP-1",
    "name": "Example site visit",
    "homeTz": "America/Chicago",
    "openLoops": [
     "EX-18"
    ],
    "segments": [
     {
      "kind": "drive",
      "start": "2026-10-19T15:15:00-05:00",
      "end": "2026-10-19T16:00:00-05:00",
      "tz": "America/Chicago",
      "from": "Office",
      "to": "Airport XYZ",
      "driveMin": 45
     },
     {
      "kind": "flight",
      "start": "2026-10-19T17:30:00-05:00",
      "end": "2026-10-19T19:45:00-05:00",
      "tz": "America/Chicago",
      "from": "XYZ",
      "to": "ABC",
      "airline": "EX",
      "number": "123"
     },
     {
      "kind": "hotel",
      "start": "2026-10-19T20:30:00-05:00",
      "end": "2026-10-20T07:00:00-05:00",
      "tz": "America/Chicago",
      "place": "Example Hotel ABC",
      "mapUrl": "https://maps.apple.com/?q=Example+Hotel",
      "cancelBy": "2026-10-19T16:00:00-05:00"
     }
    ]
   }
  ]
 }
};
