// Unit tests for js/sync.js (00.02 two-machine sync). Fictional data only. Run: node tests/sync.test.js
"use strict";
const path = require("path"); require(path.join(__dirname, "../js/sync.js")); require(path.join(__dirname, "../js/rules.js"));
const Y = globalThis.DASH.sync; let pass = 0, fail = 0;
function check(c, msg) { if (c) { pass++; console.log("PASS " + msg); } else { fail++; console.log("FAIL " + msg); } }
const empty = () => ({ entries: [], removedCal: [], domainMap: {} });
const view = evs => Y.materialize(Y.fold(evs));
const E = (id, min, extra) => Object.assign({ id, date: "2026-10-19", minutes: min, audience: "Owner/operator", subject: "Account strategy", source: "manual", confirmed: true }, extra || {});
const T0 = Date.parse("2026-10-19T14:00:00Z");
// Machine helper: keeps its own events, sees others' only after "OneDrive sync".
function machine(name) {
  return { name, own: [], seen: [], all() { return this.own.concat(this.seen); },
    edit(fn, at) { const prev = view(this.all()), next = JSON.parse(JSON.stringify(prev)); fn(next); this.own.push(...Y.diff(prev, next, name, at)); },
    file() { return Y.serialize(name, this.own, new Date().toISOString()); } };
}
const totals = v => v.entries.reduce((a, e) => a + e.minutes, 0);

// S1 two machines edit concurrently while offline, then merge -> identical results
{
  const mac = machine("mac"), pc = machine("workpc");
  const seed = Y.diff(empty(), { entries: [E("cal:CAL-1", 30, { source: "calendar", eventId: "CAL-1" })], removedCal: [], domainMap: {} }, "mac", T0);
  mac.own.push(...seed); pc.seen.push(...Y.parseTimeFile(mac.file(), "time-mac.json").events);
  mac.edit(v => { v.entries.push(E("m1", 30)); v.entries = v.entries.filter(e => e.id !== "cal:CAL-1"); }, T0 + 60e3);   // mac removes the meeting
  pc.edit(v => { v.entries.push(E("p1", 15)); v.entries.find(e => e.id === "cal:CAL-1").minutes = 45; }, T0 + 120e3);   // later, pc adjusts it
  pc.edit(v => { v.domainMap["acme.example"] = "Integrator/partner"; }, T0 + 130e3);
  // OneDrive syncs both files
  const macFile = Y.parseTimeFile(mac.file(), "time-mac.json"), pcFile = Y.parseTimeFile(pc.file(), "time-workpc.json");
  check(!macFile.bad && !pcFile.bad && macFile.machine === "mac", "S1 time files parse");
  mac.seen = pcFile.events; pc.seen = macFile.events;
  const a = view(mac.all()), b = view(pc.all());
  check(JSON.stringify(a) === JSON.stringify(b), "S1 both machines compute the identical merged state");
  check(totals(a) === 30 + 15 + 45 && totals(a) === totals(b), `S1 identical totals (${totals(a)} = ${totals(b)} min)`);
  check(a.entries.find(e => e.id === "cal:CAL-1").minutes === 45, "S1 last writer wins: later adjust beats earlier removal");
  check(a.domainMap["acme.example"] === "Integrator/partner", "S1 learned audience mapping syncs");
  check(JSON.parse(mac.file()).events.every(e => e.machine === "mac"), "S1 a machine's file holds only its own events");
  // removal after the edit wins again and becomes a tombstone
  mac.edit(v => { v.entries = v.entries.filter(e => e.id !== "cal:CAL-1"); }, T0 + 200e3);
  pc.seen = Y.parseTimeFile(mac.file(), "time-mac.json").events;
  check(view(pc.all()).removedCal.includes("CAL-1") && JSON.stringify(view(pc.all())) === JSON.stringify(view(mac.all().concat(pc.own))), "S1 later removal wins and is a tombstone on both");
}
// S2 tiebreak: identical timestamps -> machine name decides, same on every machine; order of files doesn't matter
{
  const ts = "2026-10-19T15:00:00.000Z";
  const ea = { eid: "mac.1", ts, machine: "mac", op: "upsert", id: "x", data: { minutes: 10 } };
  const eb = { eid: "workpc.1", ts, machine: "workpc", op: "upsert", id: "x", data: { minutes: 20 } };
  const v1 = view([ea, eb]), v2 = view([eb, ea]);
  check(v1.entries[0].minutes === 20 && JSON.stringify(v1) === JSON.stringify(v2), "S2 same timestamp: machine name tiebreak (workpc > mac), order-independent");
  // random permutations of a bigger log give the same result
  const evs = []; for (let i = 0; i < 60; i++) evs.push({ eid: `m${i % 3}.${i}`, ts: new Date(T0 + (i % 7) * 1000).toISOString(), machine: ["mac", "workpc", "spare"][i % 3], op: i % 5 === 0 ? "remove" : "upsert", id: "e" + (i % 9), data: { minutes: i } });
  const ref = JSON.stringify(view(evs)); let same = true;
  for (let k = 0; k < 20; k++) { const p = evs.slice().sort(() => Math.random() - 0.5); if (JSON.stringify(view(p)) !== ref) same = false; }
  check(same, "S2 20 random orderings fold to the identical state");
}
// S3 OneDrive conflict copies: merged, no duplicates; own conflict copy gets absorbed into own file
{
  const mac = machine("mac");
  mac.edit(v => v.entries.push(E("a", 10)), T0); const older = mac.file();
  mac.edit(v => v.entries.push(E("b", 20)), T0 + 1000);
  const files = { "time-mac.json": mac.file(), "time-mac-Laptop2.json": older, "time-mac (1).json": older };
  check(Object.keys(files).every(Y.isTimeFile) && !Y.isTimeFile("notebook-log.js") && !Y.isTimeFile("time-mac.json.tmp"), "S3 conflict-copy names are recognised as time files");
  const all = [].concat(...Object.entries(files).map(([n, t]) => Y.parseTimeFile(t, n).events));
  const v = view(all);
  check(v.entries.length === 2 && totals(v) === 30 && Y.dedupe(all).length === 2, "S3 conflict copies merge with no duplicates");
  // a conflict copy that has an event the main file lost (OneDrive kept the other side): it still counts, and is re-absorbed
  const lost = Y.diff(view([]), { entries: [E("c", 5)], removedCal: [], domainMap: {} }, "mac", T0 + 2000);
  const cc = JSON.parse(older); cc.events.push(...lost);
  const all2 = all.concat(Y.parseTimeFile(JSON.stringify(cc), "time-mac-Laptop2.json").events);
  check(totals(view(all2)) === 35, "S3 event only in a conflict copy still counts");
  const rewritten = JSON.parse(Y.serialize("mac", all2, "2026-10-19T20:00:00Z"));
  check(rewritten.events.length === 3 && rewritten.machine === "mac", "S3 own file rewritten with conflict-copy events absorbed (3 unique)");
}
// S4 bad files never stop the merge
{
  check(Y.parseTimeFile("{oops", "time-x.json").bad.includes("not valid JSON"), "S4 broken JSON reported, not thrown");
  const p = Y.parseTimeFile(JSON.stringify({ kind: "dash-time-log", version: 1, machine: "mac", events: [{ eid: "1", ts: "x", machine: "mac", op: "upsert", id: "a", data: {} }, { eid: "2", ts: "2026-10-19T00:00:00Z", machine: "mac", op: "upsert", id: "a", data: { minutes: 1 } }] }), "time-mac.json");
  check(p.events.length === 1 && /1 invalid/.test(p.bad), "S4 invalid events skipped and reported");
  check(!Y.validMachine("mac-mini") && !Y.validMachine("Mac") && Y.validMachine("workpc") && Y.validMachine("mac2"), "S4 machine names: a-z/0-9 only (no hyphen, so conflict copies are unambiguous)");
}
// S5 automatic entries (calendar seed / notebook log) use an old fixed timestamp: a seed made late on the other machine can't undo a removal
{
  const mac = machine("mac"), pc = machine("workpc"), start = "2026-10-19T13:00:00.000Z";
  mac.edit(v => v.entries.push(E("cal:CAL-2", 30, { source: "calendar", eventId: "CAL-2" })), T0);
  mac.edit(v => { v.entries = []; }, T0 + 1000);                          // the user removes it on the Mac
  const prev = view([]); pc.own.push(...Y.diff(prev, { entries: [E("cal:CAL-2", 30, { source: "calendar", eventId: "CAL-2" })], removedCal: [], domainMap: {} }, "workpc", T0 + 9e6, () => start)); // pc seeds hours later
  const v = view(mac.own.concat(pc.own));
  check(v.removedCal.includes("CAL-2") && !v.entries.length, "S5 late automatic seed doesn't resurrect a removed meeting");
}
// S6 one-time migration of 00.01 local data
{
  const legacy = [E("i1", 30), E("cal:CAL-1", 60, { source: "calendar", eventId: "CAL-1", attended: true })];
  const evs = Y.migrationEvents(legacy, ["CAL-9"], { "contoso.example": "Integrator/partner", "acme.example": "Owner/operator" }, { "contoso.example": "Integrator/partner" }, "mac", T0);
  const v = view(evs);
  check(v.entries.length === 2 && totals(v) === 90 && v.removedCal.includes("CAL-9"), "S6 migration: entries + tombstones become this machine's events");
  check(Object.keys(v.domainMap).join() === "acme.example" && evs.every(e => e.machine === "mac"), "S6 migration: only learned (non-default) mappings, all on this machine");
  check(Y.migrationEvents([], [], null, null, "mac", T0).length === 0, "S6 migration of nothing writes nothing");
}

// ---- QA 00.02.000 review regressions (qa/0200/adv.js) ----
const EV = (eid, ts, machine, op, id, data, c) => Object.assign({ eid, ts, machine, op, id }, c !== undefined ? { c } : {}, op === "remove" ? {} : { data: data || { minutes: 30 } });
const st = evs => JSON.stringify(Y.materialize(Y.fold(evs)));
{ // adv 1a
  const evs = [EV("a", "2026-10-19T10:00:00.000Z", "mac", "upsert", "x", { minutes: 10 }), EV("b", "2026-10-19T10:00:00.000Z", "workpc", "upsert", "x", { minutes: 20 }), EV("c", "2026-10-19T09:00:00.000Z", "mac", "remove", "x"), EV("d", "2026-10-19T11:00:00.000Z", "workpc", "map", "acme.example", { audience: "Owner/operator" })];
  const perm = a => a.length < 2 ? [a] : a.flatMap((x, i) => perm([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]));
  check(new Set(perm(evs).map(st)).size === 1, "QA 1a all 24 permutations give one state");
}
{ // adv 1b / F3b
  const c1 = EV("same", "2026-10-19T10:00:00.000Z", "mac", "upsert", "y", { minutes: 1 }), c2 = EV("same", "2026-10-19T10:00:00.000Z", "mac", "upsert", "y", { minutes: 99 });
  check(st([c1, c2]) === st([c2, c1]), "QA 1b / F3b same eid, different content: result independent of file order");
}
{ // adv 1c / 1d / 1e / F4
  const now = Date.parse("2026-10-19T12:00:00Z"), ids = [];
  for (let i = 0; i < 40; i++) ids.push(Y.diff({ entries: [] }, { entries: [{ id: "k" + i, minutes: i }] }, "mac", now)[0].eid);
  check(ids.every((e, i) => i === 0 || e > ids[i - 1]), "QA 1c / F4 40 eids in the same ms sort in creation order");
  const clk = Y.clock(); let p0 = { entries: [] }, seq = [];
  for (let i = 0; i < 37; i++) { const n = { entries: [{ id: "z", minutes: i }] }; seq.push(...Y.diff(p0, n, "mac", clk)); p0 = n; }
  check(Y.materialize(Y.fold(seq)).entries[0].minutes === 36, "QA 1d/1e 37 edits within one ms: the last one wins (logical counter)");
}
{ // adv 2a / F2a
  const rm = EV("r1", "2026-10-19T18:00:00.000Z", "mac", "remove", "cal:CAL-1");
  const mig = Y.migrationEvents([{ id: "cal:CAL-1", source: "calendar", eventId: "CAL-1", date: "2026-10-19", minutes: 30 }], [], {}, {}, "workpc", id => id === "CAL-1" ? "2026-10-19T08:00:00-05:00" : null);
  check(Y.materialize(Y.fold([rm, ...mig])).entries.length === 0 && mig[0].ts === "2026-10-19T13:00:00.000Z", "QA 2a / F2a workpc's later one-time move keeps the meeting's own time (unadjusted: the start, DG1); mac's removal stands");
  const mig2 = Y.migrationEvents([{ id: "cal:CAL-7", source: "calendar", eventId: "CAL-7", date: "2026-10-12", minutes: 30 }, { id: "i1760900000000ab", date: "2026-10-19", minutes: 5 }], ["CAL-9"], {}, {}, "mac", null);
  check(mig2.every(e => Date.parse(e.ts) < Date.parse("2026-10-20T00:00:00Z")) && mig2.find(e => e.id === "i1760900000000ab").ts === new Date(1760900000000).toISOString(), "F2a no migrated event is stamped now(); manual ids keep their creation time");
}
{ // adv 2d / F6
  const evs = [EV("a", "2026-10-19T10:00:00.000Z", "mac", "upsert", "x")];
  const forged = JSON.stringify({ kind: "dash-time-log", version: 1, machine: "mac", events: [EV("q", "2099-01-01T00:00:00.000Z", "zzz", "remove", "x")] });
  const p = Y.parseTimeFile(forged, "time-mac.json");
  check(p.events.length === 0 && /another machine/.test(p.bad) && Y.materialize(Y.fold(evs.concat(p.events))).entries.length === 1, "QA 2d / F6 an event whose machine doesn't match its file is ignored and reported");
  const cc = Y.parseTimeFile(JSON.stringify({ kind: "dash-time-log", version: 1, machine: "mac", events: [EV("m1", "2026-10-19T10:00:00.000Z", "mac", "upsert", "y"), EV("w1", "2026-10-19T10:00:00.000Z", "workpc", "upsert", "z")] }), "time-mac-the user’s MacBook Pro.json");
  check(cc.machine === "mac" && cc.events.length === 1 && cc.events[0].eid === "m1", "F6 a conflict copy maps to its base machine");
  const map = { "time-mac.json": "mac", "time-mac-Laptop2.json": "mac", "time-mac (1).json": "mac", "time-mac 2.json": "mac", "Time-Mac.JSON": "mac", "time-workpc-WORK-PC.json": "workpc", "time-mac.json (conflicted copy).json": "mac", "time-mac2.json": "mac2" };
  check(Object.entries(map).every(([n, m]) => Y.fileMachine(n) === m), "F6 base machine from every conflict-copy name");
}
{ // adv 3 / F3 clock skew
  const fast = EV("s1", "2026-10-19T12:00:00.000Z", "workpc", "upsert", "w", { minutes: 15 }, 0);   // workpc 2 h fast (real 10:00)
  const clk = Y.clock(); clk.observe([fast]);                                                       // mac has synced and seen it
  const prev = view([fast]), next = JSON.parse(JSON.stringify(prev)); next.entries[0].minutes = 45;
  const ed = Y.diff(prev, next, "mac", clk);                                                         // mac edits at its real 11:00 -> stamp after 12:00
  ed.forEach(e => { e.ts = e.ts; });
  check(Y.materialize(Y.fold([fast, ...ed])).entries[0].minutes === 45, "QA 3 / F3 a later edit after seeing a fast clock's stamp wins (hybrid clock)");
  check(Date.parse(ed[0].ts) >= Date.parse(fast.ts), "F3 new stamp = max(local clock, newest seen) with counter");
  check(Y.futureStamps([fast], Date.parse("2026-10-19T10:00:00Z")).length === 1 && Y.futureStamps([fast], Date.parse("2026-10-19T11:56:00Z")).length === 0, "F3 stamps > 5 min in the future are flagged (⚠ on the chip)");
}
{ // adv 3b / F3 UTC normalisation
  const a = EV("o", "2026-10-19T20:00:00-05:00", "mac", "upsert", "v", { minutes: 1 }), b2 = EV("p", "2026-10-19T23:00:00.000Z", "workpc", "upsert", "v", { minutes: 2 });
  check(Y.materialize(Y.fold([a, b2])).entries[0].minutes === 1, "QA 3b / F3 offset stamps normalised to UTC and ordered by real time");
  check(Y.dedupe([a])[0].ts === "2026-10-20T01:00:00.000Z" && !Y.validEvent(EV("n", "2026-10-19 20:00", "mac", "upsert", "v")), "F3 stamps stored as UTC Z; malformed stamps rejected");
}
{ // adv 4
  const yes = ["time-mac.json", "time-mac-My Laptop.json", "time-mac (1).json", "Time-Mac.JSON", "time-mac 2.json"], no = ["time-mac.json.crswap", ".time-mac.json.swp", "~$time-mac.json", "time-mac.json.tmp", "time-.json"];
  check(yes.every(Y.isTimeFile) && !no.some(Y.isTimeFile), "QA 4 time-file and temp-file names");
}
{ // adv 5: migration is idempotent by itself
  const L = [{ id: "i1", minutes: 5, date: "2026-10-19" }], m1 = Y.migrationEvents(L, ["CAL-9"], {}, {}, "mac", null), m2 = Y.migrationEvents(L, ["CAL-9"], {}, {}, "mac", null);
  check(Y.dedupe(m1.concat(m2)).length === m1.length, "QA 5 migration run twice adds no events");
}

// ---- QA delta review regressions (qa/0200/delta/dadv.js) ----
{
  const perm = a => a.length < 2 ? [a] : a.flatMap((x, i) => perm([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]));
  const c1 = EV("same", "2026-10-19T10:00:00.000Z", "mac", "upsert", "y", { minutes: 1 }), c2 = EV("same", "2026-10-19T10:00:00.000Z", "mac", "upsert", "y", { minutes: 99 });
  const evs = [EV("a", "2026-10-19T10:00:00.000Z", "mac", "upsert", "x", { minutes: 10 }), EV("b", "2026-10-19T05:00:00-05:00", "workpc", "upsert", "x", { minutes: 20 }), EV("c", "2026-10-19T10:00:00Z", "mac", "remove", "x", undefined, 1), EV("d", "2026-10-19T11:00:00.000Z", "workpc", "map", "acme.example", { audience: "Owner/operator" }), c1, c2];
  check(new Set(perm(evs).map(st)).size === 1, "dadv D2 720 permutations (offsets, same-eid conflicts) give one state");
  const ck = Y.clock(), now = Date.parse("2026-10-19T12:00:00Z"); let p = { entries: [] }, sq = [];
  for (let i = 1; i <= 1000; i++) { const n = { entries: [{ id: "z", minutes: i }] }; sq.push(...Y.diff(p, n, "mac", { tick: () => ck.tick(now) }, null)); p = n; }
  check(Y.materialize(Y.fold(sq)).entries[0].minutes === 1000 && sq[999].c === 999, "dadv D4 1000 edits in one ms: last wins");
  p = { entries: [] }; sq = []; for (let i = 1; i <= 40; i++) { const n = { entries: [{ id: "q", minutes: i }] }; sq.push(...Y.diff(p, n, "mac", now)); p = n; }
  check(Y.materialize(Y.fold(sq)).entries[0].minutes === 40, "dadv D4 40 edits via the plain-ms signature: last wins");
  const fast = EV("s1", "2026-10-19T12:04:00.000Z", "workpc", "upsert", "w", { minutes: 15 }, 0), ck3 = Y.clock(); ck3.observe([fast]);
  const loc = Y.diff({ entries: [{ id: "w", minutes: 15 }] }, { entries: [{ id: "w", minutes: 45 }] }, "mac", { tick: () => ck3.tick(Date.parse("2026-10-19T12:01:00Z")) });
  check(Y.materialize(Y.fold([fast, ...loc])).entries[0].minutes === 45, "dadv D5 seen-then-edit beats a fast stamp");
}
{ // D7
  const startOf = id => ({ "CAL-1": { start: "2026-10-19T08:00:00-05:00", end: "2026-10-19T09:00:00-05:00" } })[id];
  const seedPc = { eid: "workpc.seed", ts: new Date(Date.parse(startOf("CAL-1").start)).toISOString(), c: 0, machine: "workpc", op: "upsert", id: "cal:CAL-1", data: { source: "calendar", eventId: "CAL-1", minutes: 60 } };
  for (const order of [0, 1]) {
    const migAdj = Y.migrationEvents([{ id: "cal:CAL-1", source: "calendar", eventId: "CAL-1", minutes: 15, date: "2026-10-19" }], [], {}, {}, order ? "aaa" : "mac", startOf);
    check(Y.materialize(Y.fold([...migAdj, seedPc])).entries[0].minutes === 15, `D7 00.01 adjustment (15) beats the other machine's automatic fill (60) whatever the machine names (${order ? "aaa" : "mac"})`);
  }
  const att = Y.migrationEvents([{ id: "cal:CAL-1", source: "calendar", eventId: "CAL-1", minutes: 30, attended: true, date: "2026-10-19" }], [], {}, {}, "aaa", startOf);
  check(Y.materialize(Y.fold([...att, seedPc])).entries[0].attended === true, "D7 a migrated Attended pick beats the automatic fill");
  const up = Y.migrationEvents([{ id: "cal:CAL-1", source: "calendar", eventId: "CAL-1", minutes: 20, updatedAt: "2026-10-19T15:30:00Z" }], [], {}, {}, "mac", startOf);
  check(up[0].ts === "2026-10-19T15:30:00.000Z", "D7 an entry's own update time is used when known");
  const later = EV("r", "2026-10-19T18:00:00.000Z", "workpc", "upsert", "cal:CAL-1", { minutes: 50 });
  check(Y.materialize(Y.fold([...up, later])).entries[0].minutes === 50, "D7 a real later edit on the other machine still beats the migrated adjustment");
  const noStart = Y.migrationEvents([{ id: "cal:CAL-5", source: "calendar", eventId: "CAL-5", minutes: 15, date: "2026-10-12" }], [], {}, {}, "mac", startOf);
  check(Date.parse(noStart[0].ts) === Date.parse("2026-10-12T00:00:00") + 1, "D7 meeting not in the snapshot: its date + 1 ms, never now()");
}
{ // D5 quarantine
  const now = Date.parse("2026-10-19T12:00:00Z");
  const far = EV("f", "2099-01-01T00:00:00.000Z", "workpc", "remove", "x"), ok1 = EV("a", "2026-10-19T10:00:00.000Z", "mac", "upsert", "x");
  const q = Y.quarantine([ok1, far], now, 24);
  check(q.held.length === 1 && q.live.length === 1 && Y.materialize(Y.fold(q.live)).entries.length === 1, "D5 a 2099 stamp is held, not applied");
  const ck = Y.clock(); ck.observe(q.live); const t = ck.tick(now);
  check(t.ts === "2026-10-19T12:00:00.000Z", "D5 a held 2099 stamp doesn't advance the clock (next stamp " + t.ts + ")");
  const in23 = EV("g", new Date(now + 23 * 3600e3).toISOString(), "workpc", "upsert", "y"), in25 = EV("h", new Date(now + 25 * 3600e3).toISOString(), "workpc", "upsert", "y");
  check(Y.quarantine([in23, in25], now, 24).held.map(e => e.eid).join() === "h" && Y.quarantine([in23, in25], now, 2).held.length === 2, "D5 limit is configurable (24 h default; 2 h holds both)");
  check(Y.quarantine([in25], now + 26 * 3600e3, 24).held.length === 0, "D5 applied once real time catches up");
  // repair: re-stamp own future stamps at now with new eids; others untouched
  const own = [EV("m1", "2099-01-01T00:00:00.000Z", "mac", "upsert", "z", { minutes: 7 }), EV("m2", "2026-10-19T09:00:00.000Z", "mac", "upsert", "k")];
  const r = Y.restamp(own.concat([far]), "mac", Y.clock(), now);
  const fixed = r.events.find(e => e.id === "z");
  check(r.changed === 1 && fixed.ts === "2026-10-19T09:00:00.000Z" && fixed.sup === "m1" && fixed.eid !== "m1" && r.events.find(e => e.eid === "f").ts.startsWith("2099"), "D5 repair re-stamps only this machine's future stamps (new eid)");
  // reports: both machines see the warning
  const f = JSON.parse(Y.serialize("mac", [ok1], "2026-10-19T12:00:00Z", [{ about: "workpc", ahead_min: 120 }]));
  const pr = Y.parseTimeFile(JSON.stringify(f), "time-mac.json");
  check(pr.reports.length === 1 && pr.reports[0].about === "workpc", "D5 a machine publishes 'your clock is ahead' for the other to show");
}
{ // D6
  const file = (m, events) => JSON.stringify({ app: "activity-dashboard", kind: "dash-time-log", version: 1, machine: m, events });
  const evM = EV("m1", "2026-10-19T10:00:00.000Z", "mac", "upsert", "i1"), evW = EV("w1", "2099-01-01T00:00:00.000Z", "workpc", "remove", "i1");
  for (const n of ["time-#1.json", "time-abcdefghijklmnopqrstu.json", "backup.json", "time-.json"]) {
    const r = Y.parseTimeFile(file("mac", [evM, evW]), n); check(r.events.length === 0 && /ignored/.test(r.bad), `D6 unparsable machine name dropped and flagged: ${n}`);
  }
  check(Y.parseTimeFile(file("mac", [evM]), "time-abcdefghijklmnopqrst.json").events.length === 0 && Y.fileMachine("time-abcdefghijklmnopqrst.json") === "abcdefghijklmnopqrst", "D6 20-char name is valid (events must still match it)");
  const r2 = Y.parseTimeFile(file("mac", [evM, evW]), "time-mac2.json"); check(r2.events.length === 0 && r2.bad, "dadv F6 time-mac2.json is mac2, not mac");
  check(Y.parseTimeFile(file("workpc", [evW]), "time-workpc.json").events.length === 1, "dadv F6 valid workpc file kept");
}

// ---- QA DELTA 2 regressions (qa/0200/delta2/d2.js) ----
{ // DG1: both machines ran 00.01 (no updatedAt): mac adjusted CAL-1 to 15, workpc still has the automatic 60
  const ev = { start: "2026-10-19T08:00:00-05:00", end: "2026-10-19T09:00:00-05:00" }, startOf = id => id === "CAL-1" ? ev : null;
  const ent = m => ({ id: "cal:CAL-1", source: "calendar", eventId: "CAL-1", minutes: m, date: "2026-10-19", confirmed: true, attended: false, guessed: { audience: "domain", subject: "title" } });
  for (const [a, b] of [["mac", "workpc"], ["zmac", "apc"], ["workpc", "mac"]]) {
    const ma = Y.migrationEvents([ent(15)], [], {}, {}, a, startOf), mb = Y.migrationEvents([ent(60)], [], {}, {}, b, startOf);
    for (const order of [ma.concat(mb), mb.concat(ma)]) check(Y.materialize(Y.fold(order)).entries[0].minutes === 15, `DG1 ${a}'s adjusted 15 beats ${b}'s automatic 60 (both migrated from 00.01)`);
  }
  check(Y.migrationEvents([ent(60)], [], {}, {}, "mac", startOf)[0].ts === "2026-10-19T13:00:00.000Z", "DG1 an untouched fill is stamped at the meeting start");
  const att = Object.assign(ent(60), { attended: true }), gs = Object.assign(ent(60), { guessed: { audience: null, subject: "title" } });
  check(Y.migrationEvents([att], [], {}, {}, "mac", startOf)[0].ts.endsWith(":00.001Z") && Y.migrationEvents([gs], [], {}, {}, "mac", startOf)[0].ts.endsWith(":00.001Z"), "DG1 Attended pick / changed audience count as adjustments (+1 ms)");
  const seed = { eid: "workpc.seed", ts: "2026-10-19T13:00:00.000Z", c: 0, machine: "workpc", op: "upsert", id: "cal:CAL-1", data: { minutes: 60 } };
  check(Y.materialize(Y.fold(Y.migrationEvents([ent(15)], [], {}, {}, "aaa", startOf).concat([seed]))).entries[0].minutes === 15, "DG1 adjusted 15 also beats a 00.02 automatic fill");
}
{ // DG5a: a conflict copy with the original future event can't revive it after repair
  const now = Date.parse("2026-10-19T12:00:00Z");
  const orig = EV("m-fut", new Date(now + 48 * 3600e3).toISOString(), "mac", "upsert", "z", { minutes: 5 }), okEv = EV("m-ok", "2026-10-19T09:00:00.000Z", "mac", "upsert", "k");
  const r = Y.restamp([orig, okEv], "mac", Y.clock(), now), rep = r.events.find(e => e.sup === "m-fut");
  const edit = Y.diff(Y.materialize(Y.fold(r.events)), { entries: [{ id: "k", minutes: 30 }, { id: "z", minutes: 9 }] }, "mac", now + 1000);
  const later = r.events.concat(edit, [orig]);                            // conflict copy still carries the original
  check(Y.materialize(Y.fold(later)).entries.find(e => e.id === "z").minutes === 9, "DG5a original superseded: conflict copy can't revive it (now)");
  check(Y.materialize(Y.fold(Y.quarantine(later, now + 72 * 3600e3, 24).live)).entries.find(e => e.id === "z").minutes === 9, "DG5a ... nor after real time passes its stamp");
  check(Y.restamp(r.events.concat([orig]), "mac", Y.clock(), now).changed === 0, "DG5a repair is idempotent even with the original back from a conflict copy");
  check(rep && rep.ts === okEv.ts && rep.c === 1, "DG5b re-stamped right after this machine's newest good stamp");
}
{ // DG5b: a repaired fast-clock edit (made earlier) must not beat the other machine's genuinely later edit
  const now = Date.parse("2026-10-19T12:00:00Z");
  const good = EV("w-old", "2026-10-19T08:00:00.000Z", "workpc", "upsert", "x", { minutes: 1 }, 0);
  const lastOk = EV("w-ok", "2026-10-19T09:00:00.000Z", "workpc", "upsert", "y", { minutes: 1 }, 0);
  const fastEdit = EV("w-fast", "2026-10-21T10:00:00.000Z", "workpc", "upsert", "x", { minutes: 15 }, 0);    // real 10:00, clock 2 days fast
  const macLater = EV("m-later", "2026-10-19T11:00:00.000Z", "mac", "upsert", "x", { minutes: 45 }, 0);      // real 11:00
  const r = Y.restamp([good, lastOk, fastEdit, macLater], "workpc", Y.clock(), now);
  check(Y.materialize(Y.fold(r.events)).entries.find(e => e.id === "x").minutes === 45, "DG5b mac's genuinely later edit beats the repaired earlier edit");
  check(Date.parse(r.events.find(e => e.sup === "w-fast").ts) > Date.parse(good.ts), "DG5b repaired edit still beats this machine's own older stamps (original order kept)");
}
{ // DG5c
  const now = Date.parse("2026-10-19T12:00:00Z");
  check(Y.clockLooksBehind([EV("o", "2026-10-19T13:00:00.000Z", "workpc", "upsert", "a")], [], now) && Y.clockLooksBehind([], ["2026-10-19T12:30:00Z"], now) && !Y.clockLooksBehind([EV("o", "2026-10-19T12:03:00.000Z", "workpc", "upsert", "a")], ["2026-10-19T11:00:00Z"], now), "DG5c this clock 'looks behind' when another machine's stamp or file time is > 5 min ahead");
}

{ // DG3: a 00.01 removal on one machine beats a 00.01 adjustment on the other
  const ev = { start: "2026-10-19T08:00:00-05:00", end: "2026-10-19T09:00:00-05:00" }, startOf = id => id === "CAL-1" ? ev : null;
  const adj = { id: "cal:CAL-1", source: "calendar", eventId: "CAL-1", minutes: 15, date: "2026-10-19", attended: false, guessed: { audience: "domain", subject: "title" } };
  for (const [a, b] of [["mac", "workpc"], ["workpc", "mac"], ["aaa", "zzz"], ["zzz", "aaa"]]) {
    const ma = Y.migrationEvents([adj], [], {}, {}, a, startOf), mb = Y.migrationEvents([], ["CAL-1"], {}, {}, b, startOf);
    const v = Y.materialize(Y.fold(ma.concat(mb))), v2 = Y.materialize(Y.fold(mb.concat(ma)));
    check(!v.entries.length && v.removedCal.includes("CAL-1") && JSON.stringify(v) === JSON.stringify(v2), `DG3 #48 ${b}'s 00.01 removal beats ${a}'s 00.01 adjustment`);
  }
  const seed = { eid: "x.seed", ts: "2026-10-19T13:00:00.000Z", c: 0, machine: "x", op: "upsert", id: "cal:CAL-1", data: { minutes: 60 } };
  const a1 = Y.migrationEvents([adj], [], {}, {}, "mac", startOf)[0], r1 = Y.migrationEvents([], ["CAL-1"], {}, {}, "workpc", startOf)[0];
  check(Date.parse(seed.ts) < Date.parse(a1.ts) && Date.parse(a1.ts) < Date.parse(r1.ts), "DG3 #48 order: automatic fill < adjustment < removal");
}

// ---- QA DELTA 3 follow-ups (qa/0200/delta3/d3.js) ----
{ // DH1: Repair with no earlier correct stamp never falls back to 1970
  const now = Date.parse("2026-10-21T12:00:00Z"), startOf = id => id === "CAL-1" ? { start: "2026-10-19T08:00:00-05:00", end: "2026-10-19T09:00:00-05:00" } : null;
  const adj = EV("p-adj", "2026-10-23T10:00:00.000Z", "workpc", "upsert", "cal:CAL-1", { source: "calendar", eventId: "CAL-1", minutes: 15, date: "2026-10-19" });
  const man = EV("p-man", "2026-10-23T10:05:00.000Z", "workpc", "upsert", "i-x", { date: "2026-10-20", minutes: 7 });
  const nod = EV("p-nod", "2026-10-23T10:06:00.000Z", "workpc", "upsert", "i-y", { minutes: 3 });
  const r = Y.restamp([adj, man, nod], "workpc", Y.clock(), now, startOf), by = id => r.events.find(e => e.id === id);
  check(r.events.every(e => !e.ts.startsWith("1970")), "DH1 no re-stamp falls back to 1970");
  check(by("cal:CAL-1").ts === "2026-10-19T13:00:00.001Z", "DH1 meeting entry: start + 1 ms");
  check(Date.parse(by("i-x").ts) === Date.parse("2026-10-20T00:00:00") + 1 && Date.parse(by("i-y").ts) === now, "DH1 else the entry's date + 1 ms, else now (capped at now)");
  const seed = { eid: "mac.seed", ts: "2026-10-19T13:00:00.000Z", c: 0, machine: "mac", op: "upsert", id: "cal:CAL-1", data: { minutes: 60 } };
  check(Y.materialize(Y.fold(r.events.concat([seed]))).entries.find(e => e.id === "cal:CAL-1").minutes === 15, "DH1 repaired adjustment beats the other machine's automatic fill");
  const fut = EV("p-f", "2026-10-25T00:00:00.000Z", "workpc", "upsert", "i-z", { date: "2026-10-30", minutes: 1 });
  check(Date.parse(Y.restamp([fut], "workpc", Y.clock(), now, null).events[0].ts) === now, "DH1 a lower bound later than now is capped at now");
  const two = [EV("q1", "2026-10-23T10:00:00.000Z", "workpc", "upsert", "cal:CAL-1", { eventId: "CAL-1", minutes: 20 }), EV("q2", "2026-10-23T11:00:00.000Z", "workpc", "upsert", "cal:CAL-1", { eventId: "CAL-1", minutes: 25 })];
  check(Y.materialize(Y.fold(Y.restamp(two, "workpc", Y.clock(), now, startOf).events)).entries[0].minutes === 25, "DH1 two repaired edits of one entry keep their order");
}
{ // DH3: account-only 00.01 popup edit is a real change
  const ev = { start: "2026-10-19T08:00:00-05:00", end: "2026-10-19T09:00:00-05:00", account: "Account A" }, startOf = id => id === "CAL-1" ? ev : null;
  const base = { id: "cal:CAL-1", source: "calendar", eventId: "CAL-1", minutes: 60, date: "2026-10-19", account: "Account A", attended: false, guessed: { audience: "domain", subject: "title" } };
  const acc = Object.assign({}, base, { account: "Account D" });
  check(Y.adjusted(acc, ev) && !Y.adjusted(base, ev), "DH3 account-only edit flagged; untouched fill not");
  for (const [a, b] of [["mac", "workpc"], ["zmac", "apc"]]) {
    const v = Y.materialize(Y.fold(Y.migrationEvents([acc], [], {}, {}, a, startOf).concat(Y.migrationEvents([base], [], {}, {}, b, startOf))));
    check(v.entries[0].account === "Account D", `DH3 ${a}'s account-only edit beats ${b}'s untouched fill`);
  }
}
{ // DH5: corrupt IndexedDB values don't throw
  let ok = true, evs;
  try { evs = Y.migrationEvents("oops", { a: 1 }, [1, 2], null, "mac", null).concat(Y.migrationEvents(null, null, null, null, "mac", null), Y.migrationEvents([null, 5, { id: "i1", minutes: 5, date: "2026-10-19" }], [7, "CAL-2"], "x", null, "mac", null)); } catch (e) { ok = false; }
  check(ok && evs.length === 2 && evs.some(e => e.id === "i1") && evs.some(e => e.id === "cal:CAL-2"), "DH5 non-list entries/removed list skipped safely; valid items in mixed lists still move");
}
{ // DH6: sup only voids an event of the same machine
  const target = EV("w-1", "2026-10-19T10:00:00.000Z", "workpc", "upsert", "x", { minutes: 30 });
  const forged = EV("m-1", "2026-10-19T09:00:00.000Z", "mac", "upsert", "y", { minutes: 1 }); forged.sup = "w-1";
  check(Y.materialize(Y.fold([target, forged])).entries.some(e => e.id === "x") && Y.quarantine([target, forged], Date.parse("2026-10-19T12:00:00Z"), 24).live.length === 2, "DH6 a sup from another machine voids nothing");
  const own = EV("w-2", "2026-10-19T09:00:00.000Z", "workpc", "upsert", "x", { minutes: 9 }); own.sup = "w-1";
  check(Y.materialize(Y.fold([target, own])).entries.find(e => e.id === "x").minutes === 9, "DH6 same-machine sup still supersedes");
}

// ---- QA DELTA 4 regressions (qa/0200/delta4/d4.js) ----
{
  const R4 = globalThis.DASH.rules, H = 3600e3, iso = ms => new Date(ms).toISOString(), now = Date.parse("2026-10-19T20:00:00Z");
  const CAL = { "CAL-1": { start: "2026-10-19T13:00:00.000Z", end: "2026-10-19T14:00:00.000Z" }, "CAL-0": { start: "2026-10-01T13:00:00.000Z", end: "2026-10-01T14:00:00.000Z" } }, so = id => CAL[id] || null;
  const fill = (m, id) => ({ eid: m + ".f" + id, ts: CAL[id].start, c: 0, machine: m, op: "upsert", id: "cal:" + id, data: { eventId: id, source: "calendar", minutes: 60 } });
  const adj = { eid: "pc.adj", ts: iso(now + 48 * H), c: 0, machine: "pc", op: "upsert", id: "cal:CAL-1", data: { eventId: "CAL-1", source: "calendar", minutes: 15 } };
  const m = evs => { const e = Y.materialize(Y.fold(evs)).entries.find(x => x.id === "cal:CAL-1"); return e ? e.minutes : "removed"; };
  let r = Y.restamp([adj], "pc", Y.clock(), now, so);
  check(m([...r.events, fill("mac", "CAL-1"), fill("pc", "CAL-1")]) === 15, "d4 DH1 no prior good stamp: repaired 15 beats both fills");
  r = Y.restamp([fill("pc", "CAL-0"), adj], "pc", Y.clock(), now, so);
  check(m([...r.events, fill("mac", "CAL-1")]) === 15 && r.events.find(e => e.sup === "pc.adj").ts === "2026-10-19T13:00:00.001Z", "DI1 PC's earlier correct Oct 1 stamp: PC's repaired 15 beats Mac's fill of 60 (start + 1 ms)");
  const man = { eid: "pc.man", ts: "2026-10-05T15:00:00.000Z", c: 0, machine: "pc", op: "upsert", id: "i1", data: { minutes: 5, date: "2026-10-05" } };
  r = Y.restamp([man, adj], "pc", Y.clock(), now, so); check(m([...r.events, fill("mac", "CAL-1")]) === 15, "d4 DH1c prior good = manual Oct 5 edit: repaired 15 beats Mac's fill");
  const late = { eid: "pc.late", ts: "2026-10-19T18:00:00.000Z", c: 3, machine: "pc", op: "upsert", id: "i9", data: { minutes: 1 } };
  r = Y.restamp([late, adj], "pc", Y.clock(), now, so); const ra = r.events.find(e => e.sup === "pc.adj");
  check(ra.ts === late.ts && ra.c === 4, "DI1 a later last correct stamp wins over the floor (max), counter continues after it");
  const macLater = { eid: "mac.l", ts: "2026-10-19T19:00:00.000Z", c: 0, machine: "mac", op: "upsert", id: "cal:CAL-1", data: { minutes: 45 } };
  check(m([...r.events, macLater]) === 45, "DI1 Mac's genuinely later edit still beats the repaired one");
  const rm = { eid: "pc.rm", ts: iso(now + 48 * H), c: 1, machine: "pc", op: "remove", id: "cal:CAL-1" };
  r = Y.restamp([fill("pc", "CAL-0"), adj, rm], "pc", Y.clock(), now, so); check(m(r.events) === "removed", "d4 clamp/order same id upsert -> remove keeps order (removed)");
  CAL["CAL-9"] = { start: iso(now + 2 * H), end: iso(now + 3 * H) }; const fu = Object.assign({}, adj, { eid: "pc.fu", id: "cal:CAL-9", data: { eventId: "CAL-9", minutes: 9 } });
  check(Y.restamp([fill("pc", "CAL-0"), fu], "pc", Y.clock(), now, so).events.find(e => e.sup).ts === iso(now), "d4 / DI1 a future meeting start is capped at now");
  const nod = { eid: "pc.nd", ts: iso(now + 48 * H), c: 0, machine: "pc", op: "upsert", id: "i2", data: { minutes: 3 } };
  check(Y.restamp([nod], "pc", Y.clock(), now, so).events[0].ts === iso(now), "d4 no bound and no prior stamp -> now");
  // DH3 via d4
  const ev = { start: CAL["CAL-1"].start, end: CAL["CAL-1"].end, account: "Acme" }, base = { id: "cal:CAL-1", eventId: "CAL-1", source: "calendar", minutes: 60, account: "Acme", guessed: { audience: "x", subject: "y" } };
  const st = e => Y.migrationEvents([e], [], {}, {}, "mac", () => ev)[0].ts.slice(-5);
  check(st(Object.assign({}, base, { account: "Other" })) === ".001Z" && st(base) === ".000Z" && st(Object.assign({}, base, { account: null })) === ".001Z", "d4 DH3 account-only / cleared account flagged, unchanged not");
  // DH5 / DI4
  let ok = true; try { Y.migrationEvents([null, 5, "x", Object.assign({}, base), { id: "i1600000000000", minutes: 5 }], ["CAL-1", 7, null], [1], {}, "mac", so); Y.migrationEvents({ a: 1 }, "CAL-1", null, {}, "m", so); } catch (e) { ok = false; }
  check(ok, "d4 DH5 mixed/object legacy lists don't throw");
  ok = true; let n; try { const a = [null, 5, "s", { id: "log:1", origin: "notebook-log", date: "2026-10-19", minutes: 5 }]; n = R4.migrateLogEntries(a); } catch (e) { ok = false; }
  check(ok && n === 1, "DI4 migrateLogEntries skips null/number/string items (no throw) and still marks the valid one");
  check(R4.migrateLogEntries("oops") === 0 && R4.migrateLogEntries(null) === 0, "DI4 migrateLogEntries tolerates a non-list");
  // DH6 via d4
  const pcOk = { eid: "pc.ok", ts: iso(now - H), c: 0, machine: "pc", op: "upsert", id: "k", data: { m: 1 } };
  check(Y.fold([pcOk, { eid: "mac.v", ts: iso(now), c: 0, machine: "mac", op: "upsert", id: "z", data: {}, sup: "pc.ok" }]).entries.has("k") && !Y.fold([pcOk, { eid: "pc.v", ts: iso(now), c: 0, machine: "pc", op: "upsert", id: "z", data: {}, sup: "pc.ok" }]).entries.has("k"), "d4 DH6 sup voids only same-machine events");
}

// ---------- 00.05 flag op: stars, Done/Snooze overlays, internal people ----------
{
  const mac = machine("mac"), pc = machine("workpc");
  mac.edit(v => { v.flags = { "star:Account B": { on: true } }; }, T0);
  pc.seen.push(...Y.parseTimeFile(mac.file(), "time-mac.json").events);
  check(view(pc.all()).flags["star:Account B"].on === true, "F-S1 a star made on one machine reaches the other through its time file");
  pc.edit(v => { v.flags["star:Account B"] = { on: false }; }, T0 + 60e3);
  mac.seen.push(...Y.parseTimeFile(pc.file(), "time-workpc.json").events);
  check(view(mac.all()).flags["star:Account B"].on === false && view(pc.all()).flags["star:Account B"].on === false, "F-S2 a later unstar wins on both machines (on:false, not a removal)");
  const ev = Y.parseTimeFile(pc.file(), "time-workpc.json").events.filter(e => e.op === "flag");
  check(ev.length === 1 && ev[0].data.on === false, "F-S3 unstar is logged as a flag event");
  // tie on stamp: machine name breaks it (workpc > mac)
  const a = { eid: "mac.x", ts: "2026-10-19T14:00:00.000Z", c: 0, machine: "mac", op: "flag", id: "star:Acct", data: { on: true } };
  const b = { eid: "workpc.x", ts: "2026-10-19T14:00:00.000Z", c: 0, machine: "workpc", op: "flag", id: "star:Acct", data: { on: false } };
  check(view([a, b]).flags["star:Acct"].on === false && view([b, a]).flags["star:Acct"].on === false, "F-S4 same stamp: machine name tiebreak, whatever the order");
  check(!Y.validEvent({ eid: "m.1", ts: "2026-10-19T14:00:00Z", machine: "mac", op: "flag", id: "star:X", data: { on: "yes" } }) && !Y.validEvent({ eid: "m.1", ts: "2026-10-19T14:00:00Z", machine: "mac", op: "flag", id: "nocolon", data: { on: true } }),
    "F-S5 flag needs data.on boolean and a kind:key id");
  const m2 = machine("mac"); m2.edit(v => { v.flags = { "done:EX-2": { on: true, at: "2026-10-19T14:00:00.000Z", snapAt: "2026-10-19T07:30:00-05:00" } }; }, T0);
  m2.edit(v => { v.flags["done:EX-2"] = Object.assign({}, v.flags["done:EX-2"], { on: false }); }, T0 + 1000);
  const vv = view(m2.all()); check(vv.flags["done:EX-2"].on === false && m2.own.length === 2, "F-S6 Undo writes the opposite flag and keeps both events");
  m2.edit(v => { v.entries.push(E("t1", 15, { account: "Account B" })); }, T0 + 2000);
  check(m2.own.length === 3 && m2.own[2].op === "upsert", "F-S7 unchanged flags emit nothing; time entries still upsert");
}
// Reconciliation is deterministic from the snapshot + folded flags (To Do wins)
{
  const R = globalThis.DASH.rules;
  const snap = (gen, tasks) => R.readSnapshot({ schema_version: 1, generated_at: gen, source: "inbox-export", accounts: [], calendar: [], touches: [], totals_history: [],
    tasks: tasks.map(t => Object.assign({ list: "Follow-ups", title: "x", account: null, person: null, next_date: "2026-10-19", status: "not_started", last_modified: "2026-10-18T09:00:00-05:00", withhold: false }, t)) });
  const flags = view([{ eid: "mac.1", ts: "2026-10-19T14:00:00.000Z", c: 0, machine: "mac", op: "flag", id: "done:A", data: { on: true, at: "2026-10-19T14:00:00.000Z", snapAt: "2026-10-19T07:30:00-05:00" } },
    { eid: "mac.2", ts: "2026-10-19T14:00:00.000Z", c: 1, machine: "mac", op: "flag", id: "snooze:B", data: { on: true, until: "2026-10-20T13:00:00.000Z", due: "2026-10-19" } }]).flags;
  const now = "2026-10-19T15:00:00Z";
  let o = R.overlays(flags, snap("2026-10-19T07:30:00-05:00", [{ id: "A" }, { id: "B" }]), now);
  check(o.hidden.has("A") && o.snoozed.has("B"), "F-R1 Done hides, Snooze hides");
  o = R.overlays(flags, snap("2026-10-20T07:30:00-05:00", [{ id: "A", status: "done" }, { id: "B", next_date: "2026-10-23" }]), now);
  check(!o.hidden.has("A") && o.cleared.includes("done:A") && !o.snoozed.has("B") && o.cleared.includes("snooze:B"), "F-R2 To Do closes A -> overlay cleared; To Do re-dates B -> snooze cleared");
  o = R.overlays(flags, snap("2026-10-20T07:30:00-05:00", [{ id: "A", last_modified: "2026-10-19T12:00:00-05:00" }, { id: "B" }]), now);
  check(!o.hidden.has("A") && o.reopened.has("A"), "F-R3 A edited in To Do after the Done -> reopened");
}
// Mixed versions: a 00.04.001 reader drops the flag events and keeps the time entries
{
  const vm = require("vm"), cp = require("child_process");
  let old = null; try { old = cp.execSync("git show 80ee7e0:js/sync.js", { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "ignore"] }).toString(); } catch (e) { old = null; }
  if (!old) console.log("SKIP F-V1 00.04.001 reader (git history not available)");
  else {
    const sb = { globalThis: {} }; sb.globalThis = sb; vm.createContext(sb); vm.runInContext(old, sb); const O = sb.DASH.sync;
    const m = machine("mac"); m.edit(v => { v.entries.push(E("t1", 30)); v.flags = { "star:Account B": { on: true }, "snooze:EX-1": { on: true, until: "2026-10-20T13:00:00.000Z", due: "2026-10-16" } }; }, T0);
    const r = O.parseTimeFile(m.file(), "time-mac.json"), st = O.materialize(O.fold(r.events));
    check(r.events.length === 1 && st.entries.length === 1 && st.entries[0].id === "t1" && /2 invalid event/.test(r.bad || ""), "F-V1 00.04.001 parseTimeFile keeps the time entry and ignores the 2 flag events");
  }
}
// O1 (00.09.001): clock reports carry "at" and expire after 24 h, or after the reporter's last write when "at" is missing
{
  const now = Date.parse("2026-10-30T14:00:00Z"), iso = h => new Date(now - h * 3.6e6).toISOString();
  const file = Y.serialize("mac", [], iso(1), [{ about: "workpc", ahead_min: 40, at: iso(2) }]);
  const r = Y.parseTimeFile(file, "time-mac.json");
  check(r.reports.length === 1 && r.reports[0].at === iso(2), "O1a parseTimeFile keeps a valid report's at stamp");
  const bad = Y.parseTimeFile(JSON.stringify({ app: "activity-dashboard", kind: "dash-time-log", version: 1, machine: "mac", updated_at: iso(1), events: [], clock_reports: [{ about: "workpc", ahead_min: 5, at: "not a date" }] }), "time-mac.json");
  check(bad.reports.length === 1 && !("at" in bad.reports[0]), "O1b an unreadable at stamp is dropped (the report falls back to the file's updated_at)");
  check(Y.liveReport({ at: iso(1) }, iso(1), now, 24) === true, "O1c a 1 h old report counts");
  check(Y.liveReport({ at: iso(25) }, iso(1), now, 24) === false, "O1d a 25 h old report is ignored, even in a recently written file");
  check(Y.liveReport({}, iso(25), now, 24) === false, "O1e no at: a report in a file last written 25 h ago is ignored (the 10/23 case)");
  check(Y.liveReport({}, iso(3), now, 24) === true, "O1f no at: a report in a file written 3 h ago counts");
  check(Y.liveReport({}, null, now, 24) === false, "O1g no at and no updated_at: ignored");
  const ahead = h => new Date(now + h * 3.6e6).toISOString();
  check(Y.liveReport({ at: ahead(720) }, null, now, 24) === false, "F5a an at stamp 30 days ahead is not trusted (no other stamp: ignored)");
  check(Y.liveReport({ at: ahead(720) }, iso(2), now, 24) === true && Y.liveReport({ at: ahead(720) }, iso(30), now, 24) === false, "F5b a future at falls back to the reporter's last write");
  check(Y.liveReport({ at: ahead(0.05) }, null, now, 24) === true, "F5c an at stamp 3 min ahead (within FUTURE_MS) is accepted");
  check(Y.liveReport({ at: iso(1) }, iso(48), now, 24) === false, "F5d both stamps: expires at the earlier one (at 1 h, last write 48 h -> ignored)");
  check(Y.liveReport({}, ahead(48), now, 24) === false, "F5e no at and a future last write: ignored");
}
console.log(`\n${pass}/${pass + fail} passed`); if (fail) process.exit(1);
