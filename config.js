/* Activity Dashboard — where to look for data. Paths are relative to index.html and case-exact ("Data", capital D).
   Installed at: <synced folder>/Dashboard/.
   Data/ is the user's OneDrive folder holding the real snapshot; the app never ships a Data/ folder.
   00.02: on Windows the same folder is under %USERPROFILE%\\OneDrive\\Dashboard — nothing here is an absolute path; the Data folder is granted via the picker.
   If Data/inbox-snapshot.js is missing, the fictional example in examples/ loads (EXAMPLE DATA badge). */
window.DASH_CONFIG = {
  tier1Accounts: [],   // optional: account names treated as top tier (T1) when importing a CSV snapshot
  snapshotPath: "Data/inbox-snapshot.js",
  notebookLogPath: "Data/notebook-log.js", // made by tools/make_log_js.py on the box; optional
  examplePath: "examples/example-snapshot.js",
  staleHours: 24,
  holdHours: 24,   // 00.02: time stamps more than this many hours in the future are held (not applied) and flagged
  focusRowCap: 12, // 00.05: about this many rows on Daily Focus (each non-empty section keeps ≥1, Due Today and Overdue ≥3; "+n more" shows the rest)
  pollSeconds: 60, // 00.02: how often the connected Data folder is checked for new time files, snapshot and notebook log
  // 00.03: names an older build used, for the one-time migration. Keep real values in config.local.js (git-ignored), never here.
  projectOwners: [],      // 00.07.000: owner picklist for Projects (free text is allowed too). Real names go in config.local.js only.
  legacyDbNames: [],      // older IndexedDB database names to copy the browser cache from
  legacyTimeKinds: [],    // older "kind" values accepted in time-*.json
  snapshotNames: [],      // extra snapshot file names read from the Data folder (plaintext; encrypted on the next sync)
  notebookLogNames: [],   // extra notebook log file names
};
