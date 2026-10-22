// node tests/rules.test.js — unit tests for js/rules.js (fictional data only)
const assert = require("assert"); const fs = require("fs"); const path = require("path");
require(path.join(__dirname, "../js/rules.js")); const R = globalThis.DASH.rules;
const ex = JSON.parse(fs.readFileSync(path.join(__dirname, "../examples/example-snapshot.json"), "utf8"));
const clone = o => JSON.parse(JSON.stringify(o)); let n = 0, fail = 0;
function t(name, fn) { n++; try { fn(); console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } }
const today = "2026-10-19", s = R.readSnapshot(ex), ctx = { today, calendar: s.calendar, timeEntries: [] };
t("U1 example snapshot loads with no rejects", () => { assert.strictEqual(s.items.length, 20); assert.deepStrictEqual(s.rejects, []); assert.ok(s.example); });
t("U2 schema_version and generated_at enforced", () => {
  assert.throws(() => R.readSnapshot({ ...clone(ex), schema_version: 2 }), /schema_version/);
  assert.throws(() => R.readSnapshot({ ...clone(ex), generated_at: "2026-10-19 07:30" }), /generated_at/); });
t("U3 '@' in attendee_domains rejects whole snapshot (domains only)", () => { const b = clone(ex); b.calendar[0].attendee_domains = ["sam@contoso.example"]; assert.throws(() => R.readSnapshot(b), /email/); });
t("U3b '@' in person rejects whole snapshot", () => { const b = clone(ex); b.tasks[0].person = "a@b.example"; assert.throws(() => R.readSnapshot(b), /email/); });
t("U4 bad rows rejected with reason, rest load", () => { const b = clone(ex); b.tasks[0].list = "Someday"; b.tasks[1].withhold = "yes"; b.tasks[2].status = "maybe"; b.tasks[3].account = "Nobody";
  const r = R.readSnapshot(b); assert.strictEqual(r.items.length, 16); assert.strictEqual(r.rejects.length, 4); assert.ok(r.rejects.some(x => /withhold must be true or false/.test(x))); });
t("U5 status words and groups", () => {
  const by = id => s.items.find(i => i.id === id);
  assert.strictEqual(R.statusWord(by("EX-1"), today), "Overdue"); assert.strictEqual(R.statusWord(by("EX-2"), today), "Today");
  assert.strictEqual(R.statusWord(by("EX-3"), today), "This Week"); assert.strictEqual(R.statusWord(by("EX-6"), today), "Next");
  assert.strictEqual(R.statusWord(by("EX-9"), today), "Blocked"); assert.strictEqual(R.statusWord(by("EX-10"), today), "Waiting");
  assert.strictEqual(R.statusWord(by("EX-20"), today), "Done"); assert.strictEqual(R.group(by("EX-2"), today), "Due Today");
  assert.strictEqual(R.dateWord("2026-10-25", "2026-10-25"), "Today"); assert.strictEqual(R.dateWord("2026-10-26", "2026-10-25"), "Next"); });
t("U6 totals match tooltips", () => { const x = R.totals(s.items, ctx);
  assert.deepStrictEqual(x, { overdue: 3, dueToday: 2, thisWeek: 9, iOwe: 12, owedToMe: 5, goingCold: 4, followUps: 8, waitingOn: 5, accountTouches: 4, travel: 2 }); });
t("U7 Going Cold: flat 14 days; activity = To Do edit, time entry, account meeting", () => {
  const it = { id: "x", status: "not_started", account: "Northwind DC", lastModified: "2026-10-01" };
  assert.ok(R.isCold(it, { today, calendar: [], timeEntries: [] }));
  assert.ok(!R.isCold({ ...it, lastModified: "2026-10-06" }, { today, calendar: [], timeEntries: [] }), "13 days is not cold");
  assert.ok(R.isCold({ ...it, lastModified: "2026-10-05" }, { today, calendar: [], timeEntries: [] }), "14 days is cold");
  assert.ok(R.isCold(it, { today, calendar: [], timeEntries: [{ taskId: "y", account: "Northwind DC", date: "2026-10-18" }] }), "time on another item of the account doesn't count");
  assert.ok(!R.isCold(it, { today, calendar: [], timeEntries: [{ taskId: "x", account: "Northwind DC", date: "2026-10-18" }] }), "time on the item counts");
  assert.ok(!R.isCold(it, { today, calendar: [{ account: "Northwind DC", start: "2026-10-12T10:00:00-05:00" }], timeEntries: [] }), "meeting");
  assert.ok(R.isCold(it, { today, calendar: [{ account: "Northwind DC", start: "2026-10-28T10:00:00-05:00" }], timeEntries: [] }), "future meeting doesn't count"); });
t("U8 WoW previous week vs current; fallback; n/a", () => {
  const h = [{ generated_at: "2026-10-05T07:30:00-05:00", totals: { overdue: 1 } }, { generated_at: "2026-10-12T07:30:00-05:00", totals: { overdue: 2 } }, { generated_at: "2026-10-13T07:30:00-05:00", totals: { overdue: 4 } }, { generated_at: "2026-10-19T07:30:00-05:00", totals: { overdue: 3 } }];
  const ser = R.weeklySeries(h); assert.strictEqual(ser.length, 3); const w = R.wow(ser, "overdue");
  assert.strictEqual(w.text, "▼ -1 vs last wk"); assert.strictEqual(R.wowTone("overdue", -1), "good"); assert.strictEqual(R.wowTone("overdue", 2), "bad"); assert.strictEqual(R.wowTone("thisWeek", 2), "neu");
  assert.strictEqual(R.wow(R.weeklySeries(h.slice(0, 1)), "overdue").text, "n/a");
  assert.ok(R.wow(R.weeklySeries([h[0], h[3]]), "overdue").fallback); assert.strictEqual(R.wow(ser.slice(0, 2).concat([{ week: "2026-10-26", totals: { overdue: 4 } }]), "overdue").text, "no change"); });
t("U9 calendar conflicts and domain-only guesses", () => {
  const c = R.withConflicts(s.calendar); assert.deepStrictEqual(c.map(e => e.conflict), [false, true, true, false, false]);
  assert.strictEqual(s.calendar.find(e => e.id === "CAL-3").account, "Contoso Labs");
  assert.strictEqual(R.guessAudience(["example.com"]).value, "Internal - Domestic");
  assert.strictEqual(R.guessAudience(["example.net", "example.com"]).value, "Internal - Domestic");
  assert.strictEqual(R.guessAudience(["corp-intl.example"]).value, "Internal - International");
  assert.strictEqual(R.guessAudience(["example.com", "contoso.example"]).value, "Integrator/partner");
  assert.strictEqual(R.guessAudience(["unknown.example"]).value, "Owner/operator"); assert.strictEqual(R.guessAudience([]).value, "Owner/operator");
  assert.strictEqual(R.guessSubject("DesignTool webinar dry run").value, "Training/education");
  assert.strictEqual(R.guessSubject("DesignTool demo").value, "Product/software"); assert.strictEqual(R.guessSubject("Submittal review").value, "Technical/design support");
  assert.strictEqual(R.guessSubject("Flight check-in").value, "Admin/travel"); assert.strictEqual(R.guessSubject("Quarterly sync").value, "Account strategy");
  const r2 = R.learnAudience(R.DEFAULT_RULES, ["unknown.example", "example.com"], "Engineer of record");
  assert.strictEqual(R.guessAudience(["unknown.example"], r2).value, "Engineer of record"); assert.ok(!("example.com" in r2.domainMap)); assert.ok(!("unknown.example" in R.DEFAULT_RULES.domainMap)); });
t("U10 line under 70 chars; Manager excludes withheld + done; workload sums", () => {
  s.items.forEach(it => assert.ok(R.formatLine(it).length <= 69, R.formatLine(it)));
  assert.ok(R.formatLine({ person: "Jordan P.", title: "x".repeat(90), due: "2026-10-19" }).endsWith("… · Mon 10/19"));
  const tm = R.managerItems(s.items); assert.ok(!tm.some(i => i.withhold || i.status === "done")); assert.strictEqual(tm.length, 17);
  const wl = R.workload([{ date: "2026-10-19", minutes: 30, audience: "Owner/operator", subject: "Account strategy", account: "Account B", source: "manual", confirmed: true },
    { date: "2026-10-20", minutes: 60, audience: "Owner/operator", subject: "Training/education", account: "Account A", source: "calendar", confirmed: true },
    { date: "2026-10-20", minutes: 45, source: "interaction", kind: "Phone", confirmed: true }, { date: "2026-10-27", minutes: 99, confirmed: true, source: "manual" }], "2026-10-19");
  assert.strictEqual(wl.totalMin, 135); assert.strictEqual(wl.interactionMin, 45); assert.deepStrictEqual(wl.byKind, { Phone: 45 }); assert.ok(!("pendingMin" in wl)); assert.deepStrictEqual(wl.topAccounts[0], ["Account A", 60]); });
t("U12 CSV snapshot import", () => {
  const csv = "# generated_at=2026-10-19T07:30:00-05:00\nid,list,title,account,person,next_date,status,last_modified,withhold\nC1,Follow-ups,\"send deck, v2\",Account B,Alex R.,2026-10-20,not_started,2026-10-18T09:00:00-05:00,false\nC2,Waiting on,return quote,,Sam K.,,waiting,2026-10-18T09:00:00-05:00,maybe\n";
  const r = R.readSnapshot(R.snapshotFromCSV(csv)); assert.strictEqual(r.items.length, 1); assert.strictEqual(r.items[0].title, "send deck, v2"); assert.strictEqual(r.rejects.length, 1); });
t("U13 in-repo example .json equals the .js", () => {   // 00.04: public test compares only files in this repo
  const js = fs.readFileSync(path.join(__dirname, "../examples/example-snapshot.js"), "utf8"), m = js.match(/=\s*([\s\S]*?);?\s*$/);
  assert.deepStrictEqual(JSON.parse(m[1]), ex); assert.ok(!/@/.test(JSON.stringify(ex)), "no @ anywhere in example"); });
{ // optional: a SCRUBBED handoff copy, only when DASH_HANDOFF names one. Never defaults to any private file.
  const hp = process.env.DASH_HANDOFF;
  if (!hp || !fs.existsSync(hp)) console.log("SKIP U13b handoff copy equals build example (set DASH_HANDOFF to a scrubbed copy to check it)");
  else t("U13b handoff copy equals build example", () => { const h = fs.readFileSync(hp, "utf8"); assert.deepStrictEqual(JSON.parse(h), ex); assert.ok(!/@/.test(h)); });
}
t("U14 calendar time fills at once; conflicts fill only the Attended meeting", () => {
  const f = R.calendarFills(s.calendar, today, []).map(e => e.id); assert.deepStrictEqual(f, ["CAL-1", "CAL-4"], "no conflict events, no tomorrow events");
  assert.deepStrictEqual(R.calendarFills(s.calendar, today, ["CAL-3"]).map(e => e.id), ["CAL-1", "CAL-3", "CAL-4"]);
  assert.deepStrictEqual(R.conflictPartners(s.calendar, "CAL-2"), ["CAL-3"]); assert.deepStrictEqual(R.conflictPartners(s.calendar, "CAL-1"), []); });
t("U15 notebook log (2fdcdb3 format): only '- [log]' lines; bad ones reported; stable ids", () => {
  const txt = fs.readFileSync(path.join(__dirname, "fixtures/example-notebook-log.md"), "utf8");
  const r = R.parseNotebookLog(txt, s.accounts.map(a => a.name));
  assert.strictEqual(r.entries.length, 5, JSON.stringify(r)); assert.strictEqual(r.rejects.length, 6);
  assert.ok(r.rejects.some(x => /time 25:99/.test(x))); assert.ok(r.rejects.some(x => /date 2026-13-45 does not exist/.test(x))); assert.ok(r.rejects.some(x => /note must not contain '@'/.test(x)));
  assert.strictEqual(r.entries[3].note + r.entries[4].note, ""); assert.notStrictEqual(r.entries[3].id, r.entries[4].id, "genuine duplicate lines stay distinct");
  assert.strictEqual(r.entries[3].id.replace(/:1$/, ":2"), r.entries[4].id, "id = log:<content hash>:<n-th identical occurrence>"); assert.ok(/^log:[0-9a-z]+:1$/.test(r.entries[0].id));
  assert.strictEqual(new Set(r.entries.map(e => e.id)).size, 5); r.entries.pop();
  assert.ok(r.rejects.some(x => /channel must be/.test(x))); assert.ok(r.rejects.some(x => /person must not contain '@'/.test(x))); assert.ok(r.rejects.some(x => /YYYY-MM-DD HH:MM/.test(x)));
  assert.deepStrictEqual(r.entries.map(e => [e.time, e.minutes, e.kind, e.audience, e.subject, e.account, e.person]), [
    ["09:40", 20, "Phone", "Owner/operator", "Technical/design support", "Acme Fab", "Priya M."],
    ["10:05", 10, "Teams chat", null, null, "Contoso Labs", "Sam K."],
    ["13:15", 60, "Teams call", "Internal - Domestic", "Training/education", null, null],
    ["15:30", 15, "Other", null, null, "Globex Mfg", null]]);
  assert.strictEqual(r.entries[0].note, "riser sizing question");
  assert.ok(/audience/.test(R.parseNotebookLog("- [log] 2026-10-19 09:00 | 5m | Phone | Martians | | | |", []).rejects[0]));
  assert.ok(/subject/.test(R.parseNotebookLog("- [log] 2026-10-19 09:00 | 5m | Phone | | Lunch | | |", []).rejects[0]));
  assert.ok(/minutes/.test(R.parseNotebookLog("- [log] 2026-10-19 09:00 | soon | Phone", []).rejects[0]));
  assert.deepStrictEqual(R.parseNotebookLog(txt, s.accounts.map(a => a.name)).entries.slice(0, 4).map(e => e.id), r.entries.map(e => e.id));
  ["20", "20m", "20 min", "1h", "1h15m", "1h 15m"].forEach((v, i) => assert.strictEqual(R.parseMinutes(v), [20, 20, 20, 60, 75, 75][i], v)); assert.ok(isNaN(R.parseMinutes("abc"))); });
t("U16 time entries CSV export (quoted, formula-safe)", () => {
  const csv = R.timeEntriesCSV([{ date: "2026-10-19", minutes: 30, source: "interaction", kind: "Phone", audience: "Owner/operator", subject: "Account strategy", account: "Acme Fab", note: 'said "hi", ok', title: "=SUM(A1)" }]);
  const rows = R.parseCSV(csv); assert.deepStrictEqual(rows[0], R.CSV_COLS); const col = k => rows[1][R.CSV_COLS.indexOf(k)];
  assert.strictEqual(col("hours"), "0.50"); assert.strictEqual(col("note"), 'said "hi", ok'); assert.strictEqual(col("title"), "'=SUM(A1)"); assert.strictEqual(col("channel"), "Phone"); });
t("U17 Going Cold lists individual items, oldest first", () => {
  const cl = R.coldList(s.items, ctx); assert.strictEqual(cl.length, R.totals(s.items, ctx).goingCold);
  assert.ok(cl.every(x => x.days >= 14)); for (let i = 1; i < cl.length; i++) assert.ok(cl[i - 1].days >= cl[i].days); });
t("U18 notebook-log.md is never git-ignored or shipped; generated .js is ignored", () => {
  const gi = fs.readFileSync(path.join(__dirname, "../.gitignore"), "utf8").split(/\r?\n/).filter(l => l && !l.startsWith("#"));
  assert.ok(gi.includes("Data/"), "Data/ (real snapshot + notebook-log.js) is ignored");
  const glob = g => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$");
  assert.ok(!gi.some(g => glob(g).test("Data/notebook-log.md") || glob(g).test("notebook-log.md")), "a .gitignore rule matches notebook-log.md");
  assert.ok(!fs.existsSync(path.join(__dirname, "../Data")) && !fs.existsSync(path.join(__dirname, "../data")), "app must ship no Data/ (or data/) folder: it would overwrite or shadow the user's real files");
  const cfg = fs.readFileSync(path.join(__dirname, "../config.js"), "utf8");
  assert.ok(/snapshotPath: "Data\/inbox-snapshot\.js"/.test(cfg) && /notebookLogPath: "Data\/notebook-log\.js"/.test(cfg) && /examplePath: "examples\/example-snapshot\.js"/.test(cfg), "config paths case-exact");
  assert.ok(!/notebook-log[^\n]*(writeFile|createWritable)/.test(fs.readFileSync(path.join(__dirname, "../js/app.js"), "utf8"))); });
t("U19 F6 CSV injection neutralised after whitespace/tab/CR/quote", () => {
  ["\u200c=1", "\u200d+1", "\u2060@x", " \u200c\u2060-1", "=1", "+cmd", "-2+3", "@SUM(A1)", "\t=1", "\r=1", " =1", "  +cmd", '"=1', ' "=1', "\u00a0=1", "'=1", "\u200b@x", "\tplain", "\rplain"].forEach(v => {
    const c = R.csvCell(v); assert.ok(c.startsWith(`"'`), JSON.stringify(v) + " -> " + c); });
  ["plain", "a=b", "Owner/operator", "x-y", "1h 15m", ""].forEach(v => assert.ok(!R.csvCell(v).startsWith(`"'`), v));
  assert.strictEqual(R.csvCell(30), "30"); assert.strictEqual(R.csvCell('say "hi"'), '"say ""hi"""'); });
t("U20 F16 source and touches enforced", () => {
  assert.throws(() => R.readSnapshot({ ...clone(ex), source: "manual" }), /source must be/);
  assert.throws(() => R.readSnapshot((() => { const b = clone(ex); delete b.source; return b; })()), /source must be/);
  const b = clone(ex); b.touches.push({ account: "Account B", date: "2026-10-18", direction: "sideways", kind: "email" }, { account: "Account B", date: "2026-10-18", direction: "inbound", kind: "fax" },
    { account: "Nobody", date: "2026-10-18", direction: "inbound", kind: "email" }, { account: "Account B", date: "2026-02-30", direction: "inbound", kind: "email" },
    { account: "Account B", date: "2026-10-18", direction: "inbound", kind: "email", meeting_date: "2026-10-30" });
  b.tasks[0].importance = "urgent";
  const r = R.readSnapshot(b); assert.strictEqual(r.touches.length, 3); assert.strictEqual(r.rejects.length, 6, r.rejects.join("; ")); });
t("U21 R1 inserting/deleting lines above and re-importing adds nothing", () => {
  const names = s.accounts.map(a => a.name), txt = fs.readFileSync(path.join(__dirname, "fixtures/example-notebook-log.md"), "utf8");
  const first = R.parseNotebookLog(txt, names).entries, store = new Set(first.map(e => e.id));
  const variants = ["# new header line\n- [log] 2026-10-18 08:00 | 5m | Phone | | | | | brand-new call\n" + txt,   // insert above (incl. a new log line)
    txt.split("\n").slice(3).join("\n"),                                                                    // delete lines above
    txt.split("\n").reverse().join("\n"),                                                                   // newest-first order
    txt.replace("- [log] 2026-10-19 09:40 | 20m |", "-  [log]  2026-10-19 09:40|20m|"),                      // whitespace-only edits
    txt.replace("| 20m | Phone | Owner/operator |", "| 20M | PHONE | owner/operator |").replace("Priya M. | riser sizing question", "PRIYA M. | Riser Sizing Question")]; // case-only edits
  variants.forEach((v, k) => {
    const added = R.parseNotebookLog(v, names).entries.filter(e => !store.has(e.id));
    assert.strictEqual(added.length, k === 0 ? 1 : 0, `variant ${k}: ${added.map(e => e.note).join(",")}`);
    if (k === 0) assert.strictEqual(added[0].note, "brand-new call"); }); });
t("U22 full-width ＠ rejected in person and note, and in snapshot persons", () => {
  const r = R.parseNotebookLog("- [log] 2026-10-19 09:00 | 5m | Phone | | | | priya＠acmefab.example | x\n- [log] 2026-10-19 09:05 | 5m | Phone | | | | Priya M. | mail priya﹫x", []);
  assert.strictEqual(r.entries.length, 0); assert.strictEqual(r.rejects.length, 2);
  const b = clone(ex); b.tasks[0].person = "a＠b.example"; assert.throws(() => R.readSnapshot(b), /email/); });
t("U23 logged time is activity only for that item; account meetings stay account-wide", () => {
  const a = { id: "A", status: "not_started", account: "Acme Fab", lastModified: "2026-09-01" }, b = { id: "B", status: "waiting", account: "Acme Fab", lastModified: "2026-09-01" };
  const time = [{ taskId: "A", account: "Acme Fab", date: "2026-10-18", minutes: 30 }, { taskId: null, account: "Acme Fab", date: "2026-10-18", source: "interaction", minutes: 20 }];
  const c1 = { today, calendar: [], timeEntries: time };
  assert.strictEqual(R.lastActivity(a, c1), "2026-10-18"); assert.ok(!R.isCold(a, c1));
  assert.strictEqual(R.lastActivity(b, c1), "2026-09-01", "item B: time on item A and an account-level call don't count"); assert.ok(R.isCold(b, c1));
  const c2 = { today, calendar: [{ account: "Acme Fab", start: "2026-10-15T10:00:00-05:00" }], timeEntries: [] };
  assert.ok(!R.isCold(a, c2) && !R.isCold(b, c2), "a meeting with the account counts for every item on it");
  assert.ok(R.isCold({ ...b, account: "Globex Mfg" }, c2), "but not for items on other accounts"); });
t("U24 one-time migration: old line-number ids merge into current ids (5 stay 5)", () => {
  const names = s.accounts.map(a => a.name), txt = fs.readFileSync(path.join(__dirname, "fixtures/example-notebook-log.md"), "utf8");
  const parsed = R.parseNotebookLog(txt, names).entries; assert.strictEqual(parsed.length, 5);
  const legacy = parsed.map((e, k) => { const o = { ...e, id: `log:${k + 4}:old${k}`, audience: "Engineer of record" }; delete o.idv; delete o.fp; return o; });
  const stored = [...legacy, { id: "t1", source: "manual", minutes: 15 }];
  assert.strictEqual(R.migrateLogEntries(stored), 5); assert.strictEqual(R.migrateLogEntries(stored), 0, "runs once");
  const m = R.mergeLog(stored, R.parseNotebookLog(txt, names).entries);
  assert.deepStrictEqual([m.added, m.merged, m.dup], [0, 5, 0]);
  assert.deepStrictEqual(stored.filter(e => e.origin === "notebook-log").map(e => e.id).sort(), parsed.map(e => e.id).sort());
  assert.ok(stored.every(e => e.origin !== "notebook-log" || (e.idv === 2 && !e.legacy && e.audience === "Engineer of record")), "re-keyed, user edits kept");
  const again = R.mergeLog(stored, R.parseNotebookLog(txt, names).entries); assert.deepStrictEqual([again.added, again.merged, again.dup], [0, 0, 5]); });
console.log(`\n${n - fail}/${n} passed`); process.exit(fail ? 1 : 0);
