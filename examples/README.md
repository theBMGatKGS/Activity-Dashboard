# examples/
`example-snapshot.js` / `.json`: a FICTIONAL Inbox Exporter snapshot (`window.DASH_EXAMPLE_SNAPSHOT`). It loads only when `Data/inbox-snapshot.js` is missing, and the app then shows the ⚠ EXAMPLE DATA badge. It never writes to local storage.
The real data lives in `Data/` (capital D) next to `index.html`: `inbox-snapshot.js` (+ `.json`) and optional `notebook-log.js`. The app never ships a `Data/` folder, so copying an update can't overwrite or shadow the real files.
