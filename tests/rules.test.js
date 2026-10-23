// node tests/rules.test.js — unit tests for js/rules.js (fictional data only)
const assert = require("assert"); const fs = require("fs"); const path = require("path");
require(path.join(__dirname, "../js/rules.js")); const R = globalThis.DASH.rules;
const ex = JSON.parse(fs.readFileSync(path.join(__dirname, "../examples/example-snapshot.json"), "utf8"));
const clone = o => JSON.parse(JSON.stringify(o)); let n = 0, fail = 0;
function t(name, fn) { n++; try { fn(); console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } }
const today = "2026-10-19", s = R.readSnapshot(ex), ctx = { today, calendar: s.calendar, timeEntries: [] };
t("U1 example snapshot loads with no rejects", () => { assert.strictEqual(s.items.length, 24); assert.deepStrictEqual(s.rejects, []); assert.ok(s.example); });
t("U2 schema_version and generated_at enforced", () => {
  assert.throws(() => R.readSnapshot({ ...clone(ex), schema_version: 2 }), /schema_version/);
  assert.throws(() => R.readSnapshot({ ...clone(ex), generated_at: "2026-10-19 07:30" }), /generated_at/); });
t("U3 '@' in attendee_domains rejects whole snapshot (domains only)", () => { const b = clone(ex); b.calendar[0].attendee_domains = ["sam@contoso.example"]; assert.throws(() => R.readSnapshot(b), /email/); });
t("U3b '@' in person rejects whole snapshot", () => { const b = clone(ex); b.tasks[0].person = "a@b.example"; assert.throws(() => R.readSnapshot(b), /email/); });
t("U4 bad rows rejected with reason, rest load", () => { const b = clone(ex); b.tasks[0].list = "Someday"; b.tasks[1].withhold = "yes"; b.tasks[2].status = "maybe"; b.tasks[3].account = "Nobody";
  const r = R.readSnapshot(b); assert.strictEqual(r.items.length, 20); assert.strictEqual(r.rejects.length, 4); assert.ok(r.rejects.some(x => /withhold must be true or false/.test(x))); });
t("U5 status words and groups", () => {
  const by = id => s.items.find(i => i.id === id);
  assert.strictEqual(R.statusWord(by("EX-1"), today), "Overdue"); assert.strictEqual(R.statusWord(by("EX-2"), today), "Today");
  assert.strictEqual(R.statusWord(by("EX-3"), today), "This Week"); assert.strictEqual(R.statusWord(by("EX-6"), today), "Next");
  assert.strictEqual(R.statusWord(by("EX-9"), today), "Blocked"); assert.strictEqual(R.statusWord(by("EX-10"), today), "Waiting");
  assert.strictEqual(R.statusWord(by("EX-20"), today), "Done"); assert.strictEqual(R.group(by("EX-2"), today), "Due Today");
  assert.strictEqual(R.dateWord("2026-10-25", "2026-10-25"), "Today"); assert.strictEqual(R.dateWord("2026-10-26", "2026-10-25"), "Next"); });
t("U6 totals match tooltips", () => { const x = R.totals(s.items, ctx);
  assert.deepStrictEqual(x, { overdue: 4, dueToday: 3, thisWeek: 9, iOwe: 15, owedToMe: 6, goingCold: 5, followUps: 10, waitingOn: 6, accountTouches: 5, travel: 2 }); });
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
  const tm = R.managerItems(s.items); assert.ok(!tm.some(i => i.withhold || i.status === "done")); assert.strictEqual(tm.length, 21);
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
  const r = R.readSnapshot(b); assert.strictEqual(r.touches.length, 4); assert.strictEqual(r.rejects.length, 6, r.rejects.join("; ")); });
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

// ---------- 00.05 Daily Focus (F-series) ----------
const NOWI = "2026-10-19T13:00:00.000Z", fctx = { today, nowIso: NOWI, timeEntries: [] };
const T1 = () => { const f = {}; s.accounts.filter(a => a.tier === "T1").forEach(a => f["star:" + a.name] = { on: true }); return f; };
const FS = (flags, opts, snap, c) => { const sn = snap || s, cx = c || fctx; return R.focusSections(sn, cx, R.overlays(flags || {}, sn, cx.nowIso), Object.assign({ history: sn.history }, opts || {})); };
const sec = (f, k) => f.sections.find(x => x.key === k);
const mk = (tasks, extra) => R.readSnapshot(Object.assign({ schema_version: 1, generated_at: "2026-10-19T07:30:00-05:00", source: "inbox-export",
  accounts: [{ name: "Acct K", tier: "T1" }, { name: "Acct L", tier: "other" }], calendar: [], touches: [], totals_history: [],
  tasks: tasks.map((t, i) => Object.assign({ id: "S-" + i, list: "Follow-ups", title: "task " + i, account: null, person: null, next_date: null, status: "not_started", last_modified: "2026-10-18T09:00:00-05:00", withhold: false }, t)) }, extra || {}));
t("F1 sections on the example (T1 starred): order and rules", () => {
  const f = FS(T1()); assert.deepStrictEqual(f.sections.map(x => x.key), ["dueToday", "overdue", "owed", "waiting", "cold", "travel"]);
  assert.deepStrictEqual(sec(f, "dueToday").rows.map(r => r.id), ["EX-2", "EX-21", "EX-7"]);
  assert.deepStrictEqual(sec(f, "overdue").rows.map(r => r.id), ["EX-14", "EX-1"]);
  assert.deepStrictEqual(sec(f, "waiting").rows.map(r => r.id).concat(sec(f, "waiting").more), ["EX-22", 1]);
  assert.ok(sec(f, "waiting").total === 2 && f.counts.waiting === 2, "EX-9 and EX-22 are past check-back; Waiting with no date isn't");
  assert.deepStrictEqual(f.counts, { dueToday: 3, overdue: 2, waiting: 2, cold: 1 });
  assert.ok(sec(f, "owed").total >= 8 && !sec(f, "owed").rows.some(r => r.it.due && r.it.due <= today), "owed: due after today or no date only");
  assert.deepStrictEqual(f.noDate.map(i => i.id), ["EX-13"]); assert.deepStrictEqual(f.later.map(r => r.id), ["EX-10", "EX-11"]); });
t("F2 travel within 7 days (task + travel-looking calendar event), edge at today+7", () => {
  const a = mk([{ list: "Travel", next_date: "2026-10-26" }, { list: "Travel", next_date: "2026-10-27" }, { list: "Travel", next_date: "2026-10-20" }]);
  assert.deepStrictEqual(sec(FS({}, {}, a), "travel").rows.map(r => r.id), ["S-2", "S-0"]);
  assert.deepStrictEqual(sec(FS(T1()), "travel").rows.concat([]).map(r => r.id).slice(0, 1), ["cal:CAL-5"]); });
t("F3 boundaries: today / tomorrow / Sunday; Sunday today has no 'later'", () => {
  const a = mk([{ next_date: "2026-10-19" }, { next_date: "2026-10-20", account: null }, { next_date: "2026-10-25" }, { next_date: "2026-10-26" }]);
  const f = FS({}, {}, a); assert.deepStrictEqual(sec(f, "dueToday").rows.map(r => r.id), ["S-0"]); assert.deepStrictEqual(f.later.map(r => r.id), ["S-1", "S-2"]);
  const f2 = FS({}, {}, a, { today: "2026-10-25", nowIso: "2026-10-25T15:00:00Z", timeEntries: [] }); assert.deepStrictEqual(sec(f2, "dueToday").rows.map(r => r.id), ["S-2"]); assert.deepStrictEqual(f2.later, []); });
t("F4 CST/CDT change: ctIso and snooze times stay 08:00 CT across Nov 1", () => {
  assert.strictEqual(R.ctIso("2026-10-31", "08:00"), "2026-10-31T13:00:00.000Z"); assert.strictEqual(R.ctIso("2026-11-02", "08:00"), "2026-11-02T14:00:00.000Z");
  assert.strictEqual(R.snoozeUntil("tomorrow", "2026-10-31T20:00:00Z"), "2026-11-01T14:00:00.000Z");
  assert.strictEqual(R.snoozeUntil("monday", "2026-10-30T15:00:00Z"), "2026-11-02T14:00:00.000Z");
  assert.strictEqual(R.snoozeUntil("monday", "2026-10-25T15:00:00Z"), "2026-10-26T13:00:00.000Z", "Sunday -> next day");
  assert.strictEqual(R.snoozeUntil("later", NOWI), "2026-10-19T16:00:00.000Z"); assert.strictEqual(R.snoozeUntil("date", NOWI, "2026-10-28"), "2026-10-28T13:00:00.000Z");
  assert.strictEqual(R.snoozeUntil("date", NOWI, "2026-02-30"), null); });
t("F5 key cold: 13 / 14 / 15 days; inbound doesn't count; meeting_proposed only once its date has passed", () => {
  const base = d => mk([{ account: "Acct K", last_modified: d + "T09:00:00-05:00" }]);
  const cold = (sn, c) => R.keyCold("Acct K", sn, c || fctx);
  assert.ok(!cold(base("2026-10-06")).cold, "13 days"); assert.ok(cold(base("2026-10-05")).cold, "14 days"); assert.ok(cold(base("2026-10-04")).cold, "15 days");
  const old = "2026-09-01";
  const w = tc => { const sn = base(old); sn.touches = tc; return cold(sn); };
  assert.ok(w([{ account: "Acct K", date: "2026-10-18", direction: "inbound", kind: "email" }]).cold, "Q5: inbound is not a touch");
  assert.ok(!w([{ account: "Acct K", date: "2026-10-18", direction: "outbound", kind: "email" }]).cold, "outbound is a touch");
  assert.ok(w([{ account: "Acct K", date: "2026-10-18", direction: "outbound", kind: "meeting_proposed", meeting_date: null }]).cold, "proposed meeting without a date isn't a touch");
  assert.ok(w([{ account: "Acct K", date: "2026-10-10", direction: "outbound", kind: "meeting_proposed", meeting_date: "2026-10-28" }]).cold, "future meeting date isn't a touch yet");
  assert.ok(!w([{ account: "Acct K", date: "2026-10-10", direction: "inbound", kind: "meeting_proposed", meeting_date: "2026-10-16" }]).cold, "a proposed meeting that has happened counts");
  assert.ok(!cold(base(old), Object.assign({}, fctx, { timeEntries: [{ account: "Acct K", date: "2026-10-17", minutes: 15 }] })).cold, "logged touch (time entry with the account) counts");
  const cal = base(old); cal.calendar = [{ id: "c", account: "Acct K", start: "2026-10-12T10:00:00-05:00", end: "2026-10-12T11:00:00-05:00" }]; assert.ok(!cold(cal).cold, "past meeting counts");
  assert.strictEqual(cold(base("2026-09-08")).days, 41); });
t("F6 going cold rows: starred accounts only; oldest open task, else a 'Log a touch' row", () => {
  const a = mk([{ account: "Acct K", last_modified: "2026-09-01T09:00:00-05:00", id: "K1" }, { account: "Acct K", last_modified: "2026-09-02T09:00:00-05:00", id: "K2", next_date: "2026-10-30" }, { account: "Acct L", last_modified: "2026-09-01T09:00:00-05:00", id: "L1" }]);
  assert.deepStrictEqual(sec(FS({}, {}, a), "cold").rows, [], "nothing starred");
  const f = FS({ "star:Acct K": { on: true } }, {}, a); assert.strictEqual(f.counts.cold, 1);
  const r = sec(f, "cold").rows[0]; assert.ok(r.synthetic && r.account === "Acct K", "K1/K2 already shown in Owed to outside -> synthetic row");
  const f2 = FS({ "star:Acct K": { on: true }, "star:Acct L": { on: false } }, { }, mk([{ account: "Acct K", last_modified: "2026-09-01T09:00:00-05:00", list: "Waiting on", status: "waiting", next_date: "2026-11-30" }]));
  assert.strictEqual(sec(f2, "cold").rows[0].id, "S-0", "an open task not shown elsewhere is the cold row");
  const f3 = FS({ "star:Acct K": { on: true } }, {}, mk([])); assert.ok(sec(f3, "cold").rows[0].synthetic && sec(f3, "cold").rows[0].when.nodate, "no open task -> no date flag"); });
t("F7 row cap: >=1 per non-empty section, Due Today/Overdue >=3, total 12, +n more, expand", () => {
  const many = []; for (let i = 0; i < 6; i++) many.push({ next_date: "2026-10-19" }); for (let i = 0; i < 6; i++) many.push({ next_date: "2026-10-12" });
  for (let i = 0; i < 6; i++) many.push({ account: "Acct L", next_date: "2026-10-28" }); many.push({ list: "Waiting on", status: "waiting", next_date: "2026-10-10" }); many.push({ list: "Travel", next_date: "2026-10-21" });
  const f = FS({}, {}, mk(many)), n = k => sec(f, k).rows.length;
  assert.ok(n("dueToday") >= 3 && n("overdue") >= 3 && n("owed") >= 1 && n("waiting") === 1 && n("travel") === 1);
  assert.strictEqual(f.sections.reduce((a, x) => a + x.rows.length, 0), 12); assert.strictEqual(sec(f, "owed").more, sec(f, "owed").total - n("owed"));
  assert.deepStrictEqual([n("dueToday"), n("overdue"), n("owed")], [6, 3, 1]);
  const f2 = FS({}, { expanded: new Set(["owed"]) }, mk(many)); assert.strictEqual(sec(f2, "owed").rows.length, 6);
  const f3 = FS({}, { cap: 4 }, mk(many)); assert.deepStrictEqual(f3.sections.map(x => x.rows.length), [3, 3, 1, 1, 0, 1], "minimums win over a small cap"); });
t("F8 delta: previous business day, Monday -> Friday, none -> hidden, snapshot-only (ignores dashboard Done)", () => {
  const h = d => ({ generated_at: d + "T07:30:00-05:00", totals: { dueToday: 1 } });
  assert.strictEqual(R.prevBusinessDay("2026-10-19"), "2026-10-16"); assert.strictEqual(R.prevBusinessDay("2026-10-21"), "2026-10-20");
  assert.deepStrictEqual(R.focusDelta([h("2026-10-16")], "2026-10-19", 3), { delta: 2, text: "▲+2", basisDay: "2026-10-16" });
  assert.strictEqual(R.focusDelta([h("2026-10-15")], "2026-10-19", 3), null, "Thursday isn't the previous business day for Monday");
  assert.strictEqual(R.focusDelta([], "2026-10-19", 3), null); assert.strictEqual(R.focusDelta([h("2026-10-16")], "2026-10-19", 0).text, "▼−1"); assert.strictEqual(R.focusDelta([h("2026-10-16")], "2026-10-19", 1).text, "=0");
  const f = FS(Object.assign(T1(), { "done:EX-2": { on: true, at: NOWI, snapAt: s.generatedAt } }));
  assert.strictEqual(f.counts.dueToday, 2, "square shows what's left"); assert.strictEqual(f.delta.text, "▲+1", "delta unchanged by Done"); assert.strictEqual(f.doneDueToday, 1); assert.strictEqual(f.doneHere, 1); });
t("F9 no-date flag: owed and cold rows carry it; other undated items go to the footer", () => {
  const f = FS(T1(), { expanded: new Set(["owed"]) }); const ow = sec(f, "owed").rows.find(r => r.id === "EX-23"); assert.strictEqual(ow.when.kind, "nodate");
  assert.ok(sec(f, "cold").rows[0].when.nodate); assert.ok(f.noDate.every(i => !i.due)); });
t("F10 Withhold rows show on the Focus screen; Manager items still exclude them", () => {
  const f = FS(T1(), { expanded: new Set(["owed"]) }); assert.ok(sec(f, "owed").rows.some(r => r.it.withhold));
  assert.ok(!R.managerItems(s.items).some(i => i.withhold)); });
t("F11 G1 outside: account, or person not on the internal list", () => {
  assert.ok(R.isOutside({ account: "Acct L", person: "Sam K." }, new Set(["sam k."])), "account wins");
  assert.ok(R.isOutside({ account: null, person: "Sam K." }, new Set()));
  assert.ok(!R.isOutside({ account: null, person: "Sam K." }, new Set(["sam k."])));
  assert.ok(!R.isOutside({ account: null, person: "Me" }) && !R.isOutside({ account: null, person: null }));
  const a = mk([{ person: "Sam K.", next_date: "2026-10-22" }]); assert.strictEqual(sec(FS({}, {}, a), "owed").total, 1); assert.strictEqual(sec(FS({ "internal:sam k.": { on: true } }, {}, a), "owed").total, 0); });
t("F12 overlays: Done hides until To Do catches up; To Do edit after Done reopens; snooze until/re-date", () => {
  const a = mk([{ id: "D1", next_date: "2026-10-19" }]);
  let ov = R.overlays({ "done:D1": { on: true, at: "2026-10-19T14:00:00Z", snapAt: a.generatedAt } }, a, NOWI); assert.ok(ov.hidden.has("D1")); assert.strictEqual(ov.doneHere.length, 1);
  const later = mk([{ id: "D1", next_date: "2026-10-19", last_modified: "2026-10-19T10:00:00-05:00" }], { generated_at: "2026-10-20T07:30:00-05:00" });
  ov = R.overlays({ "done:D1": { on: true, at: "2026-10-19T14:00:00Z", snapAt: a.generatedAt } }, later, NOWI); assert.ok(!ov.hidden.has("D1")); assert.ok(ov.reopened.has("D1"), "edited in To Do after the Done -> To Do wins");
  const same = mk([{ id: "D1", next_date: "2026-10-19" }], { generated_at: "2026-10-21T07:30:00-05:00" });
  ov = R.overlays({ "done:D1": { on: true, at: "2026-10-19T14:00:00Z", snapAt: a.generatedAt } }, same, NOWI); assert.ok(ov.hidden.has("D1"), "unchanged in To Do -> stays hidden (never auto-expires)");
  const closed = mk([{ id: "D1", status: "done" }]); ov = R.overlays({ "done:D1": { on: true, at: "x", snapAt: a.generatedAt } }, closed, NOWI); assert.deepStrictEqual(ov.cleared, ["done:D1"]); assert.strictEqual(ov.doneHere.length, 0);
  assert.ok(!R.overlays({ "done:D1": { on: false, at: "x" } }, a, NOWI).hidden.has("D1"), "Undo = on:false");
  ov = R.overlays({ "snooze:D1": { on: true, until: "2026-10-20T13:00:00Z", due: "2026-10-19" } }, a, NOWI); assert.ok(ov.snoozed.has("D1"));
  assert.ok(!R.overlays({ "snooze:D1": { on: true, until: "2026-10-20T13:00:00Z", due: "2026-10-19" } }, a, "2026-10-20T13:00:01Z").snoozed.has("D1"), "back after until");
  assert.deepStrictEqual(R.overlays({ "snooze:D1": { on: true, until: "2026-10-20T13:00:00Z", due: "2026-10-18" } }, a, NOWI).cleared, ["snooze:D1"], "re-dated in To Do -> snooze cleared");
  const f = FS({ "snooze:D1": { on: true, until: "2026-10-20T13:00:00Z", due: "2026-10-19" } }, {}, a); assert.strictEqual(f.counts.dueToday, 0); assert.deepStrictEqual(f.later.map(r => r.id), ["D1"], "snoozed into this week -> Later this week"); });
// ---------- 00.05.001 time zone follows the computer (tests set the zone explicitly) ----------
const withTz = (z, fn) => { const old = R.getTimeZone(); R.setTimeZone(z); try { fn(); } finally { R.setTimeZone(old); } };
t("Z1 default and fallback: America/Chicago; invalid / empty zone falls back; detectTimeZone returns a valid IANA zone", () => {
  assert.strictEqual(R.DEFAULT_TZ, "America/Chicago"); assert.ok(R.validTimeZone(R.detectTimeZone()));
  withTz("Nowhere/Invalid", () => assert.strictEqual(R.getTimeZone(), "America/Chicago")); withTz("", () => assert.strictEqual(R.getTimeZone(), "America/Chicago"));
  withTz("America/Chicago", () => { assert.strictEqual(R.tzLabel("2026-10-19T12:00:00Z"), "CT"); assert.strictEqual(R.ymd(new Date("2026-10-19T04:59:00Z")), "2026-10-18"); });
});
t("Z2 Chicago unchanged: snooze 08:00 CDT/CST and the 00.05.000 results", () => withTz("America/Chicago", () => {
  assert.strictEqual(R.snoozeUntil("tomorrow", "2026-10-19T13:00:00Z"), "2026-10-20T13:00:00.000Z");
  assert.strictEqual(R.snoozeUntil("tomorrow", "2026-10-31T13:00:00Z"), "2026-11-01T14:00:00.000Z", "fall back: 08:00 CST");
  assert.strictEqual(R.snoozeUntil("tomorrow", "2026-03-07T15:00:00Z"), "2026-03-08T13:00:00.000Z", "spring forward: 08:00 CDT");
}));
t("Z3 Eastern: day boundary at local midnight, DST both ways, 08:00 EDT/EST", () => withTz("America/New_York", () => {
  assert.strictEqual(R.tzLabel("2026-07-01T12:00:00Z"), "ET");
  assert.strictEqual(R.ymd(new Date("2026-10-23T03:59:00Z")), "2026-10-22"); assert.strictEqual(R.ymd(new Date("2026-10-23T04:00:00Z")), "2026-10-23", "midnight EDT = 04:00Z");
  assert.strictEqual(R.ymd(new Date("2026-12-01T04:59:00Z")), "2026-11-30"); assert.strictEqual(R.ymd(new Date("2026-12-01T05:00:00Z")), "2026-12-01", "midnight EST = 05:00Z");
  assert.strictEqual(R.ctIso("2026-03-08", "08:00"), "2026-03-08T12:00:00.000Z"); assert.strictEqual(R.ctIso("2026-03-07", "08:00"), "2026-03-07T13:00:00.000Z");
  assert.strictEqual(R.ctIso("2026-11-01", "08:00"), "2026-11-01T13:00:00.000Z"); assert.strictEqual(R.ctIso("2026-10-31", "08:00"), "2026-10-31T12:00:00.000Z");
  assert.strictEqual(R.ctIso("2026-03-08", "02:30"), "2026-03-08T07:30:00.000Z", "time in the spring-forward gap moves forward (03:30 EDT)");
  assert.strictEqual(R.snoozeUntil("monday", "2026-10-23T15:00:00Z"), "2026-10-26T12:00:00.000Z");
  assert.strictEqual(R.hm("2026-10-19T12:30:00Z"), "8:30 AM"); assert.strictEqual(R.hourCT("2026-10-19T12:30:00Z"), 8.5);
}));
t("Z4 Pacific: day boundary, DST, 08:00 PDT/PST; same instant is a different day than in Eastern", () => withTz("America/Los_Angeles", () => {
  assert.strictEqual(R.tzLabel("2026-01-10T12:00:00Z"), "PT");
  assert.strictEqual(R.ymd(new Date("2026-10-23T06:59:00Z")), "2026-10-22"); assert.strictEqual(R.ymd(new Date("2026-10-23T07:00:00Z")), "2026-10-23", "midnight PDT = 07:00Z");
  assert.strictEqual(R.ctIso("2026-03-08", "08:00"), "2026-03-08T15:00:00.000Z"); assert.strictEqual(R.ctIso("2026-11-01", "08:00"), "2026-11-01T16:00:00.000Z");
  assert.strictEqual(R.snoozeUntil("tomorrow", "2026-10-31T23:30:00Z"), "2026-11-01T16:00:00.000Z", "Sat 16:30 PDT -> Sun 08:00 PST");
  let e; withTz("America/New_York", () => e = R.ymd(new Date("2026-10-23T05:00:00Z"))); assert.strictEqual(e, "2026-10-23"); assert.strictEqual(R.ymd(new Date("2026-10-23T05:00:00Z")), "2026-10-22");
}));
t("Z5 Due Today / Overdue follow the zone: one instant, Chicago vs Pacific vs Eastern", () => {
  const s = mk([{ id: "Z1", next_date: "2026-10-23" }, { id: "Z2", next_date: "2026-10-22" }]), at = new Date("2026-10-23T04:30:00Z");   // 23:30 CDT Oct 22
  const due = z => { let r; withTz(z, () => { const today = R.ymd(at), tt = R.totals(s.items, { today, calendar: [], timeEntries: [] }); r = [today, tt.dueToday, tt.overdue]; }); return r; };
  assert.deepStrictEqual(due("America/Chicago"), ["2026-10-22", 1, 0]); assert.deepStrictEqual(due("America/Los_Angeles"), ["2026-10-22", 1, 0]);
  assert.deepStrictEqual(due("America/New_York"), ["2026-10-23", 1, 1], "already Oct 23 in Eastern: Z2 is overdue");
});
console.log(`\n${n - fail}/${n} passed`); process.exit(fail ? 1 : 0);
