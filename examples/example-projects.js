/* EXAMPLE DATA - fictional Planner export for the Projects page (schema_version 1). Placeholder names only. */
window.DASH_EXAMPLE_PROJECTS = {
 "schema_version": 1,
 "generated_at": "2026-10-19T06:45:00-05:00",
 "source": "planner-export",
 "example": true,
 "plans": [
  {
   "id": "PLAN-A",
   "name": "Accounts",
   "buckets": [
    {
     "id": "B1",
     "name": "Follow-ups"
    },
    {
     "id": "B2",
     "name": "Waiting on"
    },
    {
     "id": "B3",
     "name": "Account touches"
    },
    {
     "id": "B4",
     "name": "Travel"
    }
   ],
   "tasks": [
    {
     "id": "PT-1",
     "title": "Send riser layout markup",
     "bucketId": "B1",
     "assignees": [
      "Jordan P."
     ],
     "status": "inProgress",
     "due": "2026-10-16",
     "priority": "urgent",
     "labels": [
      "Acme Fab"
     ],
     "account": "Acme Fab",
     "percent": 50,
     "checklist": {
      "done": 1,
      "total": 3
     }
    },
    {
     "id": "PT-2",
     "title": "Confirm detector spacing review",
     "bucketId": "B1",
     "assignees": [
      "Alex R."
     ],
     "status": "notStarted",
     "due": "2026-10-19",
     "priority": "medium",
     "labels": [
      "Northwind DC"
     ],
     "account": "Northwind DC"
    },
    {
     "id": "PT-3",
     "title": "Quote follow-up call",
     "bucketId": "B1",
     "assignees": [],
     "status": "notStarted",
     "due": "2026-10-22",
     "priority": "important",
     "labels": [
      "Contoso Labs"
     ],
     "account": "Contoso Labs"
    },
    {
     "id": "PT-4",
     "title": "Submittal comments back",
     "bucketId": "B2",
     "assignees": [
      "Priya M."
     ],
     "status": "inProgress",
     "due": "2026-10-21",
     "priority": "medium",
     "labels": [
      "Acme Fab"
     ],
     "account": "Acme Fab",
     "percent": 25
    },
    {
     "id": "PT-5",
     "title": "Site walk notes",
     "bucketId": "B2",
     "assignees": [
      "Chris T."
     ],
     "status": "notStarted",
     "due": null,
     "priority": "medium",
     "labels": [],
     "account": "Fabrikam Campus"
    },
    {
     "id": "PT-6",
     "title": "Quarterly touch",
     "bucketId": "B3",
     "assignees": [
      "Sam K.",
      "Dana L."
     ],
     "status": "notStarted",
     "due": "2026-11-02",
     "priority": "low",
     "labels": [
      "Northwind DC"
     ],
     "account": "Northwind DC"
    },
    {
     "id": "PT-7",
     "title": "Book trip to Example City",
     "bucketId": "B4",
     "assignees": [
      "Jordan P."
     ],
     "status": "completed",
     "due": "2026-10-14",
     "priority": "medium",
     "labels": [],
     "account": null,
     "percent": 100
    },
    {
     "id": "PT-8",
     "title": "Commissioning checklist",
     "bucketId": "B3",
     "assignees": [
      "Dana L."
     ],
     "status": "inProgress",
     "due": "2026-10-26",
     "priority": "medium",
     "labels": [],
     "account": "Fabrikam Campus",
     "percent": 60,
     "start": "2026-10-12",
     "checklist": {
      "done": 4,
      "total": 6
     }
    }
   ]
  },
  {
   "id": "PLAN-B",
   "name": "Example Retrofit",
   "buckets": [
    {
     "id": "RB1",
     "name": "Design"
    },
    {
     "id": "RB2",
     "name": "Install"
    }
   ],
   "tasks": [
    {
     "id": "PT-9",
     "title": "Pipe network design",
     "bucketId": "RB1",
     "assignees": [
      "Alex R."
     ],
     "status": "inProgress",
     "due": "2026-10-20",
     "priority": "medium",
     "labels": [],
     "account": null,
     "percent": 70,
     "start": "2026-10-05"
    },
    {
     "id": "PT-10",
     "title": "Detector install",
     "bucketId": "RB2",
     "assignees": [],
     "status": "notStarted",
     "due": "2026-11-09",
     "priority": "medium",
     "labels": [],
     "account": null,
     "start": "2026-10-28"
    }
   ]
  }
 ]
};
