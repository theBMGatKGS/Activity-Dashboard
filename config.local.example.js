/* Copy to config.local.js (git-ignored, never committed or published) to set values for this computer only.
   config.local.js loads after config.js; a missing config.local.js is fine. Example values only: */
Object.assign(window.DASH_CONFIG, {
  // legacyDbNames: ["old-dashboard-db"],
  // legacyTimeKinds: ["old-time-log"],
  // snapshotNames: ["old-snapshot.js", "old-snapshot.json"],
  // 00.11.000: labels that must never be in the repo (example values only)
  // internalAccountLabel: "Internal (Example Co)",   // what the fixed "Internal" time account is called on screen
  // managerName: "Alex",                              // the Quick Launch "<Name> report" button and "Copy for <Name>"
  // reportNameLine: "Jordan P.:",                     // the first line of the pasted manager report, if the file has none
});
