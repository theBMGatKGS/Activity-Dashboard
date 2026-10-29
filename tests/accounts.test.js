// node tests/accounts.test.js — unit tests for js/accounts.js (00.09.000). Fictional data only; real account plans never enter the repo.
const assert = require("assert"); const fs = require("fs"); const path = require("path"); const crypto = require("crypto");
require(path.join(__dirname, "../js/rules.js")); require(path.join(__dirname, "../js/accounts.js"));
const R = globalThis.DASH.rules, A = globalThis.DASH.accounts;
const FX = fs.readFileSync(path.join(__dirname, "fixtures/example-account.md"), "utf8"), NAME = "example-account.md", NOW = "2026-10-19T09:00:00-05:00";
let n = 0, fail = 0; function t(name, fn) { n++; try { fn(); console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } }
const rules = (txt, name) => A.parseAccountMd(name || NAME, txt).problems.map(p => p.rule);
const has = (txt, rule, name) => { const r = rules(txt, name); assert.ok(r.includes(rule), `expected ${rule}, got ${JSON.stringify(r)}`); };
const sub = (a, b, base) => { const src = base || FX; assert.ok(src.includes(a), "fixture text missing: " + a); return src.replace(a, b); };
const SENT = p => "ACCT_SENTINEL_" + crypto.createHash("sha256").update("accounts.test:" + p).digest("hex").slice(0, 24);   // long unique sentinels
const GF = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/example-guard-fixtures.json"), "utf8"));   // literal guard fixtures (phones, amounts)
const PHONES = GF.phone, AM = GF.accountMoney;
const tasksOf = s => R.readStore(s.projStore).plans[0].tasks;

t("A1 fixture parses with no problems; shape matches schema v1", () => { const r = A.parseAccountMd(NAME, FX); assert.deepStrictEqual(r.problems, []); const a = r.account;
  assert.strictEqual(a.slug, "example-account"); assert.strictEqual(a.tier, "key"); assert.strictEqual(a.stakeholders.length, 3); assert.strictEqual(a.opportunities.length, 2); assert.strictEqual(a.open_loops.length, 4);
  assert.deepStrictEqual(a.open_loops.map(l => l.bucket), ["Follow-ups", "Waiting on", "Account touches", "Travel"]); assert.strictEqual(a.open_loops[3].task_id, null, "empty task_id = none");
  assert.strictEqual(a.next_move.owner, "Chris T."); assert.strictEqual(a.stakeholders[1].last_touch, "unknown"); assert.strictEqual(a.happening.length, 2); assert.strictEqual(a.unverified_items.length, 2); });
t("A2 (unverified) is flagged and stripped from the text", () => { const a = A.parseAccountMd(NAME, FX).account;
  assert.ok(a.stakeholders[1].unverified && !a.stakeholders[0].unverified); assert.ok(a.opportunities[1].unverified); assert.ok(a.open_loops[1].unverified && !a.open_loops[0].unverified);
  assert.ok(a.happening[1].unverified && !/unverified/.test(a.happening[1].text)); assert.ok(!/unverified/i.test(a.stakeholders[1].name)); });
t("A3 front matter: missing key, bad YAML, anchors, repeated key, __proto__, no front matter", () => {
  has(sub("region: Example Region North\n", ""), "FM-REQ"); has(sub("tier: key", "tier: [key"), "FM-YAML"); has(sub("tier: key", "tier: &a key"), "FM-YAML");
  has(sub("tier: key", "tier: key\ntier: watch"), "FM-YAML"); has(sub("tier: key", "__proto__: x"), "FM-YAML"); has(sub("---\naccount", "account"), "FM-MISSING"); has(sub("tier: key", "tier: !str key"), "FM-YAML"); });
t("A4 allowed values: tier, status, cadence, bucket, influence, sentiment, stage", () => {
  has(sub("tier: key", "tier: gold"), "FM-TIER"); has(sub("status: draft", "status: final"), "FM-STATUS"); has(sub("touch_cadence: biweekly", "touch_cadence: daily"), "FM-CADENCE");
  has(sub("bucket: Follow-ups, next_date: 2026-10-16", "bucket: Someday, next_date: 2026-10-16"), "LOOP-BUCKET"); has(sub("| High | Champion |", "| Huge | Champion |"), "T2-INFLUENCE");
  has(sub("| High | Champion |", "| High | Fan |"), "T2-SENTIMENT"); has(sub("| Develop |", "| Pitch |"), "T4-STAGE");
  assert.deepStrictEqual(rules(sub("| High | Champion |", "| high | champion |")), [], "case-insensitive enums are accepted");
  ["reviewed", "filed"].forEach(x => assert.deepStrictEqual(rules(sub("status: draft", "status: " + x)), [], "status " + x)); });
t("A5 dates: real calendar days; unknown only in stakeholder Last touch", () => {
  has(sub("last_updated: 2026-10-15", "last_updated: 2026-02-30"), "FM-DATE"); has(sub("next_date: 2026-10-16", "next_date: soon"), "LOOP-DATE");
  has(sub("| 2026-09-20 |", "| 9/20 |"), "T2-DATE"); has(sub("| 2026-11-02 |", "| unknown |"), "T4-DATE"); });
t("A6 slug must equal the file name and be lower-case", () => { has(FX, "SLUG", "other-name.md"); has(sub("slug: example-account", "slug: Example_Account"), "SLUG-FORMAT", "Example_Account.md"); });
t("A7 headings exactly, in order; a repeated heading is refused", () => {
  has(sub("## 3. What they are trying to accomplish", "## 3. Goals"), "HEAD-ORDER"); has(sub("## 4. Opportunities", "## 1. What is happening\n- x\n\n## 4. Opportunities"), "HEAD-ORDER"); });
t("A8 tables: header and cell count", () => { has(sub("| Name | Org | Role |", "| Person | Org | Role |"), "T2-HEADER"); has(sub("| Sam K. | Example Engineers |", "| Sam K. |"), "T2-CELLS"); has(sub("| Hall 2 detection standard | Develop |", "| Hall 2 detection standard |"), "T4-CELLS"); });
t("A9 sections 5 and 6 must equal the front matter; unverified_count must match", () => {
  has(sub("Cadence: biweekly", "Cadence: monthly"), "S5-MATCH"); has(sub("Owner: Chris T.", "Owner: Sam K."), "S6-MATCH"); has(sub("unverified_count: 2", "unverified_count: 3"), "UNV-COUNT"); has(sub("unverified_count: 2", "unverified_count: two"), "FM-UNV-TYPE"); });
t("A10 guards: a dollar figure, an email address or a phone number anywhere refuses the file", () => {
  AM.forEach(m => has(sub("Standardize detection", "Standardize detection, budget " + m), "PRICE")); GF.money.slice(0, 6).forEach(m => has(sub("Prefers the old design", m), "PRICE"));
  has(sub("Prefers the old design", "sam.k@engineers.example"), "EMAIL"); has(sub("Prefers the old design", "sam at engineers dot com"), "EMAIL");
  PHONES.forEach(ph => has(sub("Prefers the old design", "call " + ph), "PHONE")); has(sub("account: Acme Fab", "account: Acme Fab " + AM[0]), "PRICE"); });
t("A11 task_id must be text; sources must be relative notebook paths", () => { has(sub('task_id: ""', "task_id: 12"), "TASKID-TYPE"); has(sub("  - accounts/owner-operators/example-account.md", "  - /etc/x.md"), "SOURCE-PATH"); has(sub("  - accounts/owner-operators/example-account.md", "  - ../x.md"), "SOURCE-PATH"); });
t("A12 import is all or nothing; problems are file:line RULE; SCHEMA.md and index.md are skipped", () => {
  const bad = sub("tier: key", "tier: gold"), r = A.importAccounts([[NAME, FX], ["other.md", bad.replace("slug: example-account", "slug: other")]], null, NOW);
  assert.strictEqual(r.store, null); assert.ok(r.rejects.some(x => /^other\.md:\d+ FM-TIER/.test(x)), JSON.stringify(r.rejects));
  const ok = A.importAccounts([["SCHEMA.md", "# x"], ["index.md", "# y"], [NAME, FX]], null, NOW); assert.deepStrictEqual(ok.rejects, []); assert.strictEqual(ok.added, 1); assert.strictEqual(ok.warnings.length, 2); });
t("A13 re-import: unchanged file counts as same; changed counts as changed; picking the same account twice is refused", () => {
  const r1 = A.importAccounts([[NAME, FX]], null, NOW), r2 = A.importAccounts([[NAME, FX]], r1.store, NOW), r3 = A.importAccounts([[NAME, sub("Shared inbox", "Shared mailbox")]], r1.store, NOW);
  assert.deepStrictEqual([r2.added, r2.same, r2.changed, r3.changed], [0, 1, 0, 1]); assert.strictEqual(r3.store.accounts.length, 1);
  assert.ok(A.importAccounts([[NAME, FX], ["x/" + NAME, FX]], null, NOW).rejects.some(x => /SLUG/.test(x))); });
t("A14 store reader refuses a bad store and keeps good records", () => { assert.throws(() => A.readAccStore({ schema_version: 2 })); assert.throws(() => A.readAccStore({ schema_version: 1, updated_at: "x", accounts: [] }));
  const r = A.importAccounts([[NAME, FX]], null, NOW).store; const s = A.readAccStore(JSON.parse(JSON.stringify(Object.assign({}, r, { accounts: r.accounts.concat([{ slug: "__bad slug" }]) })))); assert.strictEqual(s.accounts.length, 1); });
t("A15 loop ids are stable across imports and change with wording or bucket", () => { const a = A.parseAccountMd(NAME, FX).account, b = A.parseAccountMd(NAME, FX).account;
  assert.deepStrictEqual(a.open_loops.map(l => l.id), b.open_loops.map(l => l.id)); const c = A.parseAccountMd(NAME, sub("Send riser layout markup", "Send riser layout photos")).account; assert.notStrictEqual(c.open_loops[0].id, a.open_loops[0].id);
  const d = A.parseAccountMd(NAME, sub("bucket: Follow-ups, next_date: 2026-10-16", "bucket: Follow-ups, next_date: 2026-10-30")).account; assert.strictEqual(d.open_loops[0].id, a.open_loops[0].id, "the date is not in the id"); });
t("A16 open loops go into plan 'Accounts – <account>' with the four buckets; the store reads back cleanly", () => { const a = A.parseAccountMd(NAME, FX).account, s = A.syncLoops(a, null, NOW), st = R.readStore(s.projStore);
  assert.deepStrictEqual(st.rejects, []); const p = st.plans[0]; assert.strictEqual(p.name, "Accounts – Acme Fab"); assert.deepStrictEqual(p.buckets.map(b => b.name), ["Follow-ups", "Waiting on", "Account touches", "Travel", "Next moves"]);
  assert.strictEqual(s.created, 4); assert.deepStrictEqual(p.tasks.map(x => p.buckets.find(b => b.id === x.bucketId).name), ["Follow-ups", "Waiting on", "Account touches", "Travel"]);
  assert.deepStrictEqual(p.tasks.map(x => x.due), ["2026-10-16", "2026-10-21", "2026-10-28", "2026-11-09"]); assert.ok(p.tasks.every(x => x.labels.includes("account:example-account") && x.labels.some(l => l.startsWith("loop:")))); });
t("A17 no duplicates: a re-sync links all four; task_id and bucket + title matches link too", () => { const a = A.parseAccountMd(NAME, FX).account, s0 = A.syncLoops(a, null, NOW), st = R.readStore(s0.projStore), s1 = A.syncLoops(a, st, NOW, s0.refs);
  assert.deepStrictEqual([s1.created, s1.linked, tasksOf(s1).length], [0, 4, 4]);
  const own = { schema_version: 1, updated_at: NOW, plans: [{ id: "P1", name: "Other plan", buckets: [{ id: "B1", name: "To do" }], tasks: [{ id: "MINE-1", title: "Mine", bucketId: "B1", assignees: [], status: "inProgress", percent: 10, start: null, due: null, priority: "low", labels: [], notes: "", account: null, checklist: [] }] }] };
  const s2 = A.syncLoops(A.parseAccountMd(NAME, sub('task_id: ""', 'task_id: "MINE-1"')).account, R.readStore(own), NOW); assert.deepStrictEqual([s2.created, s2.linked], [3, 1]); assert.strictEqual(s2.refs[a.open_loops[3].id], "MINE-1");
  const st3 = R.readStore(s0.projStore); st3.plans[0].tasks[0].labels = st3.plans[0].tasks[0].labels.filter(l => !l.startsWith("loop:")); const s3 = A.syncLoops(a, st3, NOW); assert.deepStrictEqual([s3.created, s3.linked], [0, 4], "bucket + normalized title"); });
t("A18 a loop removed from the file never deletes its task; Projects keeps status and dates", () => { const a = A.parseAccountMd(NAME, FX).account, s0 = A.syncLoops(a, null, NOW), st = R.readStore(s0.projStore);
  st.plans[0].tasks[2].status = "inProgress"; st.plans[0].tasks[2].due = "2026-10-30";
  const gone = A.parseAccountMd(NAME, sub("  - {item: \"Send riser layout markup\", bucket: Follow-ups, next_date: 2026-10-16}\n", "")).account, s1 = A.syncLoops(gone, st, NOW, s0.refs);
  assert.strictEqual(tasksOf(s1).length, 4); assert.deepStrictEqual([tasksOf(s1)[2].status, tasksOf(s1)[2].due], ["inProgress", "2026-10-30"]); });
t("A19 next move: linked by task_id or action text; Create makes it once; a missing task_id warns and creates nothing", () => { const a = A.parseAccountMd(NAME, FX).account;
  assert.strictEqual(A.findNextMove(a, null), null); const c = A.createNextMove(a, null, NOW), st = R.readStore(c.projStore); assert.ok(c.created); assert.deepStrictEqual(st.rejects, []);
  const f = A.findNextMove(a, st); assert.strictEqual(f.by, "title"); assert.strictEqual(st.plans[0].buckets.find(b => b.id === f.t.bucketId).name, "Next moves"); assert.strictEqual(A.createNextMove(a, st, NOW).created, false);
  const m = A.parseAccountMd(NAME, sub('owner: "Chris T.", due: 2026-10-16}', 'owner: "Chris T.", due: 2026-10-16, task_id: "NOPE-1"}')).account; assert.deepStrictEqual(A.findNextMove(m, st), { taskId: null, missing: "NOPE-1" }); assert.strictEqual(A.createNextMove(m, st, NOW).created, false); });
t("A20 cadence: next touch due = earlier of the file's next touch and last touch + cadence; Daily Focus rows", () => { const a = A.parseAccountMd(NAME, FX).account;
  const ts = A.touchStatus(a, "2026-10-19"); assert.deepStrictEqual([ts.due, ts.byCadence, ts.overdue, ts.days], ["2026-10-15", "2026-10-15", true, 4]);
  assert.strictEqual(A.touchStatus(Object.assign({}, a, { touch_cadence: "as-needed", next_touch: { date: "2026-11-01" } }), "2026-10-19").overdue, false);
  const st = { accounts: [a] }, rows = A.focusTouches(st, "2026-10-19", null); assert.deepStrictEqual(rows.map(r => [r.what, r.days]), [["Account touch · call", 4], ["Next strategic move", 3]]);
  const c = R.readStore(A.createNextMove(a, null, NOW).projStore); c.plans[0].tasks[0].status = "completed"; assert.strictEqual(A.focusTouches(st, "2026-10-19", c).length, 1, "a completed next move leaves Focus");
  assert.strictEqual(A.listOrder(st, "2026-10-19", null)[0].moveOver, true); });
t("A21 cadence math holds across the DST change", () => { const a = A.parseAccountMd(NAME, sub("touch_cadence: biweekly", "touch_cadence: weekly").replace("Cadence: biweekly", "Cadence: weekly")).account;
  const b = Object.assign({}, a, { last_touch: { date: "2026-10-30", type: "call", with: "x" }, next_touch: { date: "2026-12-01", type: "call", with: "x" } }); assert.strictEqual(A.touchStatus(b, "2026-11-06").byCadence, "2026-11-06"); });
t("A22 contacts: CSV import, name + company matching, ambiguous gives no link, pricing rows skipped", () => {
  const csv = "first_name,last_name,email,company,title,phone,source,last_seen,last_touch\nJordan,P.,jordan.p@acme.example,Acme Fab,Operations lead,,example,2026-10-01,2026-10-01\nSam,K.,sam1@a.example,Example Engineers,EOR,,x,,\nSam,K.,sam2@b.example,Example Engineers,EOR 2,,x,,\nAlex,R.,a@x.example,Acme Fab," + AM[0] + ",,x,,\n";
  const c = A.parseContactsCSV(csv, NOW); assert.strictEqual(c.contacts.length, 3); assert.strictEqual(c.rejects.length, 1); assert.throws(() => A.parseContactsCSV("a,b\n1,2", NOW));
  const a = A.parseAccountMd(NAME, FX).account; const m0 = A.matchContacts(a.stakeholders[0], c); assert.strictEqual(m0[0].contact.title, "Operations lead");
  const m2 = A.matchContacts(a.stakeholders[2], c); assert.deepStrictEqual([m2[0].contact, m2[0].candidates], [null, 2], "two people with the same name and company: no link");
  const m1 = A.matchContacts(a.stakeholders[1], c); assert.strictEqual(m1.length, 2, "A / B is two people"); assert.strictEqual(A.readContacts(JSON.parse(JSON.stringify(c))).contacts.length, 3); });
t("A23 sentinels survive parsing into the store (control for the encryption tests)", () => {
  const S1 = SENT("happening"), S2 = SENT("stakeholder"), S3 = SENT("loop");
  const txt = sub("Acme Fab is expanding", S1 + " is expanding").replace("| Sam K. |", "| " + S2 + " |").replace("Quarterly check-in with the operations lead", S3);
  const r = A.importAccounts([[NAME, txt]], null, NOW); assert.deepStrictEqual(r.rejects, []); const j = JSON.stringify(r.store); [S1, S2, S3].forEach(s => assert.ok(j.includes(s))); assert.ok(S1.length > 30 && S1 !== S2); });
t("A24 the example accounts (fictional) import cleanly and show no real-looking data", () => {
  globalThis.window = globalThis.window || globalThis; require(path.join(__dirname, "../examples/example-accounts.js")); const ex = globalThis.window.DASH_EXAMPLE_ACCOUNTS;
  const r = A.importAccounts(ex.files, null, NOW); assert.deepStrictEqual(r.rejects, []); assert.strictEqual(r.added, 2); assert.ok(A.parseContactsCSV(ex.contactsCSV, NOW).contacts.every(c => /\.example$/.test(c.email) && !c.phone)); });
t("A25 S2c: a reworded or moved loop is only PROPOSED as a rename; Same task / New task resolve it", () => { const a = A.parseAccountMd(NAME, FX).account, s0 = A.syncLoops(a, null, NOW), st = R.readStore(s0.projStore);
  const t0 = st.plans[0].tasks[0]; t0.status = "inProgress"; t0.due = "2026-10-20"; t0.assignees = ["Sam K."]; const before = JSON.stringify(t0);
  const re1 = A.parseAccountMd(NAME, sub("Send riser layout markup", "Send the riser layout markup to the team")).account, s1 = A.syncLoops(re1, st, NOW, s0.refs), p1 = R.readStore(s1.projStore).plans[0];
  assert.deepStrictEqual([s1.created, s1.updated, s1.renames.length], [0, 0, 1], "nothing merges and no task is made until the choice");
  assert.strictEqual(JSON.stringify(p1.tasks.find(x => x.id === t0.id)), before); assert.strictEqual(p1.tasks.length, 4); assert.strictEqual(s1.refs[re1.open_loops[0].id], undefined);
  const q = s1.renames[0]; assert.deepStrictEqual([q.taskId, q.from, q.to, q.oldLoopId, q.kind], [t0.id, "Send riser layout markup", "Send the riser layout markup to the team", a.open_loops[0].id, undefined]);
  const same = A.resolveRename(re1, R.readStore(s1.projStore), q, "same", NOW), u = R.readStore(same.projStore).plans[0].tasks.find(x => x.id === t0.id);
  assert.strictEqual(same.taskId, t0.id); assert.strictEqual(u.title, "Send the riser layout markup to the team"); assert.ok(u.notes.endsWith("Previously: Send riser layout markup"));
  assert.deepStrictEqual([u.status, u.due, u.assignees[0]], ["inProgress", "2026-10-20", "Sam K."], "Projects keeps status, dates and owner"); assert.ok(u.labels.includes(A.loopLabel(re1.open_loops[0].id)));
  const refs2 = Object.assign({}, s1.refs, { [q.loopId]: same.taskId }); const again = A.syncLoops(re1, R.readStore(same.projStore), NOW, refs2); assert.deepStrictEqual([again.created, again.renames.length, again.linked], [0, 0, 4], "stable after Same task");
  const nw = A.resolveRename(re1, R.readStore(s1.projStore), q, "new", NOW), pn = R.readStore(nw.projStore).plans[0];
  assert.notStrictEqual(nw.taskId, t0.id); assert.strictEqual(pn.tasks.length, 5); assert.strictEqual(JSON.stringify(pn.tasks.find(x => x.id === t0.id)), before, "New task leaves the old one alone");
  assert.throws(() => A.resolveRename(re1, R.readStore(s1.projStore), q, "maybe", NOW));
  const mv = A.parseAccountMd(NAME, sub("{item: \"Send riser layout markup\", bucket: Follow-ups", "{item: \"Send riser layout markup\", bucket: Waiting on")).account, s2 = A.syncLoops(mv, st, NOW, s0.refs);
  assert.deepStrictEqual([s2.created, s2.renames.length], [0, 1]); const m2 = R.readStore(A.resolveRename(mv, R.readStore(s2.projStore), s2.renames[0], "same", NOW).projStore).plans[0];
  assert.strictEqual(m2.buckets.find(b => b.id === m2.tasks.find(x => x.id === t0.id).bucketId).name, "Waiting on");
  assert.strictEqual(A.syncLoops(re1, st, NOW).created, 1, "without the previous import's links nothing is proposed");
  const un = A.parseAccountMd(NAME, sub("Send riser layout markup", "Book hall 3 commissioning window")).account, s3 = A.syncLoops(un, st, NOW, s0.refs);
  assert.deepStrictEqual([s3.created, s3.renames.length], [1, 0], "an unrelated new loop is a new task");
  const unanswered = A.syncLoops(re1, R.readStore(s1.projStore), NOW, Object.assign({}, s1.refs, { [q.oldLoopId]: q.taskId })); assert.deepStrictEqual([unanswered.created, unanswered.renames.length], [0, 1], "an unanswered prompt carries over"); });
t("A26 QA probe P1: a completed task whose loop was removed never takes a pairing; the similar new loop is a NEW open task", () => { const a = A.parseAccountMd(NAME, FX).account, s0 = A.syncLoops(a, null, NOW), st = R.readStore(s0.projStore), t0 = st.plans[0].tasks[0];
  t0.status = "completed"; t0.percent = 100; t0.completedOn = "2026-10-18"; const before = JSON.stringify(t0);
  const gone = A.parseAccountMd(NAME, sub("  - {item: \"Send riser layout markup\", bucket: Follow-ups, next_date: 2026-10-16}\n", "")).account, s1 = A.syncLoops(gone, st, NOW, s0.refs), st1 = R.readStore(s1.projStore);
  const nw = A.parseAccountMd(NAME, sub("Send riser layout markup", "Send riser layout markup for hall 2")).account;
  [[st, s0.refs], [st1, s1.refs]].forEach(([ps, prev], k) => { const s = A.syncLoops(nw, ps, NOW, prev), p = R.readStore(s.projStore).plans[0];
    assert.strictEqual(s.renames.length, 0, "no prompt, case " + k); assert.strictEqual(s.created, 1, "case " + k); assert.strictEqual(JSON.stringify(p.tasks.find(x => x.id === t0.id)), before, "completed task unchanged, case " + k);
    const n2 = p.tasks.find(x => x.title === "Send riser layout markup for hall 2"); assert.ok(n2 && n2.status === "notStarted" && n2.id !== t0.id, "new open task, case " + k); }); });
t("A27 QA probe P2: a reworded loop is offered another loop's old task only if that loop left in THIS import, the task is open and passes the threshold", () => {
  const a = A.parseAccountMd(NAME, FX).account, s0 = A.syncLoops(a, null, NOW), st0 = R.readStore(s0.projStore), tid = st0.plans[0].tasks[0].id, PH = "Send riser layout photos";
  const now1 = A.parseAccountMd(NAME, sub("Send riser layout markup", PH)).account, ok = A.syncLoops(now1, st0, NOW, s0.refs);
  assert.ok(A.similarity("Send riser layout markup", PH) >= 0.5); assert.deepStrictEqual([ok.updated, ok.created, ok.renames.length, ok.renames[0].taskId], [0, 0, 1, tid], "allowed: proposed, not merged");
  const gone = A.parseAccountMd(NAME, sub("  - {item: \"Send riser layout markup\", bucket: Follow-ups, next_date: 2026-10-16}\n", "")).account, s1 = A.syncLoops(gone, st0, NOW, s0.refs), st1 = R.readStore(s1.projStore);
  const addPh = A.parseAccountMd(NAME, sub("  - {item: \"Send riser layout markup\", bucket: Follow-ups, next_date: 2026-10-16}\n", "  - {item: \"" + PH + "\", bucket: Follow-ups, next_date: 2026-10-16}\n")).account, no1 = A.syncLoops(addPh, st1, NOW, s1.refs);
  assert.strictEqual(no1.renames.length, 0, "left in an earlier import: refused"); assert.strictEqual(no1.created, 1); assert.strictEqual(R.readStore(no1.projStore).plans[0].tasks.find(x => x.id === tid).title, "Send riser layout markup");
  const st2 = R.readStore(s0.projStore); st2.plans[0].tasks[0].status = "completed"; st2.plans[0].tasks[0].percent = 100; const no2 = A.syncLoops(now1, st2, NOW, s0.refs); assert.strictEqual(no2.renames.length, 0, "completed: refused"); assert.strictEqual(no2.created, 1);
  const far = A.parseAccountMd(NAME, sub("Send riser layout markup", "Order replacement photos")).account, no3 = A.syncLoops(far, st0, NOW, s0.refs); assert.strictEqual(no3.renames.length, 0, "below the threshold"); assert.strictEqual(no3.created, 1);
  const cross = A.parseAccountMd(NAME, sub("{item: \"Send riser layout markup\", bucket: Follow-ups", "{item: \"Send riser layout photos\", bucket: Waiting on")).account, no4 = A.syncLoops(cross, st0, NOW, s0.refs);
  assert.strictEqual(no4.renames.length, 0, "another bucket needs >= 0.8"); });
// RC1: an exact match that points to a COMPLETED task, with the loop dated later than that task, asks Same task (reopen) / New task.
const recurSetup = () => { const a = A.parseAccountMd(NAME, FX).account, s0 = A.syncLoops(a, null, NOW), st = R.readStore(s0.projStore), t0 = st.plans[0].tasks[0];
  t0.status = "completed"; t0.percent = 100; t0.completedOn = "2026-10-15"; return { a, s0, st, t0 }; };
const LATER = () => A.parseAccountMd(NAME, sub("bucket: Follow-ups, next_date: 2026-10-16", "bucket: Follow-ups, next_date: 2026-11-02")).account;
t("A28 RC1: a repeated loop dated later than its completed task raises a Repeated loop prompt; nothing linked or made", () => { const { s0, st, t0 } = recurSetup(), before = JSON.stringify(t0), l2 = LATER();
  const s1 = A.syncLoops(l2, st, NOW, s0.refs), q = s1.renames.find(x => x.kind === "recur");
  assert.ok(q, "prompt raised"); assert.deepStrictEqual([s1.created, s1.linked, s1.renames.length], [0, 3, 1]);
  assert.deepStrictEqual([q.taskId, q.taskDate, q.loopDate, q.loopId], [t0.id, "2026-10-16", "2026-11-02", l2.open_loops[0].id]);
  assert.strictEqual(JSON.stringify(tasksOf(s1).find(x => x.id === t0.id)), before, "the completed task is untouched"); assert.strictEqual(tasksOf(s1).length, 4);
  const st2 = R.readStore(s0.projStore); st2.plans[0].tasks[0].status = "completed"; st2.plans[0].tasks[0].labels = st2.plans[0].tasks[0].labels.filter(x => !x.startsWith("loop:"));
  assert.strictEqual(A.syncLoops(l2, st2, NOW, s0.refs).renames.filter(x => x.kind === "recur").length, 1, "bucket + title match");
  const byId = A.syncLoops(A.parseAccountMd(NAME, sub("bucket: Follow-ups, next_date: 2026-10-16}", "bucket: Follow-ups, next_date: 2026-11-02, task_id: " + t0.id + "}")).account, st2, NOW, s0.refs);
  assert.strictEqual(byId.renames.filter(x => x.kind === "recur").length, 1, "task_id match"); });
t("A29 RC1: a same or earlier date against a completed task still links silently", () => { const { s0, st, t0 } = recurSetup();
  [FX, sub("bucket: Follow-ups, next_date: 2026-10-16", "bucket: Follow-ups, next_date: 2026-10-10")].forEach((txt, k) => { const s = A.syncLoops(A.parseAccountMd(NAME, txt).account, st, NOW, s0.refs);
    assert.deepStrictEqual([s.renames.length, s.created, s.linked], [0, 0, 4], "case " + k); assert.strictEqual(tasksOf(s).find(x => x.id === t0.id).status, "completed", "case " + k); }); });
t("A30 RC1: Same task (reopen) and New task; re-imports are idempotent after each choice and while unanswered", () => { const { s0, st, t0 } = recurSetup(), l2 = LATER();
  const s1 = A.syncLoops(l2, st, NOW, s0.refs), q = s1.renames[0], p1 = R.readStore(s1.projStore);
  const prevU = Object.assign({}, s1.refs); s1.renames.forEach(x => { prevU[x.oldLoopId] = x.taskId; });
  const u2 = A.syncLoops(l2, p1, NOW, prevU), u3 = A.syncLoops(l2, R.readStore(u2.projStore), NOW, u2.refs);
  [u2, u3].forEach((u, k) => { assert.deepStrictEqual([u.created, u.renames.length, tasksOf(u).length], [0, 1, 4], "unanswered " + k); assert.deepStrictEqual(u.renames[0], q, "same prompt " + k); });
  const same = A.resolveRename(l2, p1, q, "same", NOW), ps = R.readStore(same.projStore), u = ps.plans[0].tasks.find(x => x.id === t0.id);
  assert.strictEqual(same.taskId, t0.id); assert.deepStrictEqual([u.status, u.percent, u.completedOn, u.due], ["notStarted", 0, null, "2026-11-02"]); assert.ok(/Reopened on import/.test(u.notes));
  let refs = Object.assign({}, s1.refs, { [q.loopId]: same.taskId }), cur = ps;
  for (let i = 0; i < 2; i++) { const r = A.syncLoops(l2, cur, NOW, refs); assert.deepStrictEqual([r.created, r.renames.length, r.linked, tasksOf(r).length], [0, 0, 4, 4], "after Same task, import " + i); cur = R.readStore(r.projStore); refs = r.refs; }
  const before = JSON.stringify(p1.plans[0].tasks.find(x => x.id === t0.id)), nw = A.resolveRename(l2, p1, q, "new", NOW), pn = R.readStore(nw.projStore);
  assert.notStrictEqual(nw.taskId, t0.id); assert.strictEqual(pn.plans[0].tasks.length, 5); assert.strictEqual(JSON.stringify(pn.plans[0].tasks.find(x => x.id === t0.id)), before);
  const n2 = pn.plans[0].tasks.find(x => x.id === nw.taskId); assert.deepStrictEqual([n2.status, n2.due], ["notStarted", "2026-11-02"]);
  refs = Object.assign({}, s1.refs, { [q.loopId]: nw.taskId }); cur = pn;
  for (let i = 0; i < 2; i++) { const r = A.syncLoops(l2, cur, NOW, refs); assert.deepStrictEqual([r.created, r.renames.length, tasksOf(r).length], [0, 0, 5], "after New task, import " + i); assert.strictEqual(r.refs[q.loopId], nw.taskId); cur = R.readStore(r.projStore); refs = r.refs; }
  cur.plans[0].tasks.find(x => x.id === nw.taskId).status = "completed"; const r3 = A.syncLoops(l2, cur, NOW, refs); assert.deepStrictEqual([r3.created, r3.renames.length], [0, 0], "the latest completed match counts: no prompt");
  assert.throws(() => A.resolveRename(l2, p1, q, "maybe", NOW)); });
t("A31 N1: pendingPrompts counts the prompts waiting across accounts", () => { assert.strictEqual(A.pendingPrompts(null), 0);
  assert.strictEqual(A.pendingPrompts({ accounts: [{ pendingRenames: [{ kind: "recur" }, {}] }, { pendingRenames: [] }, {}, { pendingRenames: [{}] }] }), 3); });
t("A32 (c) removing (unverified) leaves no space before punctuation; orgName holds the Org column", () => { const a = A.parseAccountMd(NAME, FX).account;
  assert.strictEqual(a.happening[1].text, "The operations lead asked for a standard riser layout."); assert.ok(a.happening[1].unverified);
  assert.strictEqual(a.unverified_items[0].text, "The riser layout request was seen once in meeting notes.");
  const b = A.parseAccountMd(NAME, sub("Shared inbox", "Shared inbox (unverified), kept for now")).account; assert.strictEqual(b.stakeholders[1].notes, "Shared inbox, kept for now");
  assert.deepStrictEqual(a.stakeholders.map(x => x.orgName), ["Acme Fab", "Acme Fab", "Example Engineers"]); assert.ok(a.stakeholders.every(x => !("org" in x))); });
console.log(`\n${n - fail}/${n} passed (accounts 00.09.000)`); process.exit(fail ? 1 : 0);
