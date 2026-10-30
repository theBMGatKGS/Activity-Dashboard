/* 00.10.000: fictional example events (EXAMPLE DATA only; in memory, never cached or synced).  Dates are relative to today. */
window.DASH_EXAMPLE_EVENTS = {
  build(today, addDays) {
    const d = n => addDays(today, n);
    const markdown = ["---", "type: data", "updated: " + today, "restriction: example", "---", "# Events", "", "## Upcoming", "",
      "| event | start date | end date | location | series/organizer | status | role | target accounts | registration deadline | room-block deadline | travel | trip ref | follow-ups | source note |",
      "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
      `| Example Expo 2026 | ${d(20)} | ${d(22)} | Springfield, ST | Example Association | registered | exhibitor | [[accounts/owner-operators/acme-fab]] | ${d(5)} | ${d(12)} | planned F | TRIP-${d(19).replace(/-/g, "")}-EXPO | book booth staff | [[trade-shows/example-expo]] |`,
      `| Example Chapter Meeting | ${d(45)} | ${d(45)} | Riverton, ST [unverified] | Example Chapter | considering | ? | [[accounts/engineers/northwind-labs]] | ? | ? | none | ? | ? | [[trade-shows/example-chapter]] |`, ""].join("\n");
    const outlook = [
      { id: "ex-ev-1", title: "Example Expo 2026", title_truncated: false, start_date: d(20), end_date: d(22), all_day: true, start: null, end: null, zone: "America/Chicago", location: "Springfield, ST", category: "Tradeshow", show_as: "oof" },
      { id: "ex-ev-2", title: "Example Chapter Meeting", title_truncated: false, start_date: d(45), end_date: d(45), all_day: false, start: d(45) + "T18:00:00-06:00", end: d(45) + "T20:00:00-06:00", zone: "America/Chicago", location: "Riverton, ST", category: "Chapter", show_as: "busy" }];
    return { markdown, outlook };
  }
};
