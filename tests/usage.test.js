// node tests/usage.test.js — unit tests for js/usage.js (00.10.001 Grok Bot usage tile) and its readSnapshot hook.  Fictional numbers only.
const assert = require("assert"); const path = require("path");
require(path.join(__dirname, "../js/rules.js")); require(path.join(__dirname, "../js/usage.js"));
const R = globalThis.DASH.rules, U = globalThis.DASH.usage;
let n = 0, fail = 0; function t(name, fn) { n++; try { fn(); console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } }
const OK = { as_of: "2026-11-01T07:15:00-06:00", weekly_used_pct: 67.9, weekly_resets: "2026-11-06T05:03:00-06:00", on_demand_pct: 24.7, on_demand_maxed: false, on_demand_resets: "2026-11-04T09:30:00-06:00", detail_url: "https://example.com/usage" };
const NOW = "2026-11-01T08:00:00-06:00";
t("U1 read: a good block keeps the seven fields", () => { const r = []; assert.deepStrictEqual(Object.keys(U.read(OK, r)).sort(), Object.keys(OK).sort()); assert.deepStrictEqual(r, []); });
t("U2 read: null or missing means no data, no reject", () => { const r = []; assert.strictEqual(U.read(undefined, r), null); assert.strictEqual(U.read(null, r), null); assert.deepStrictEqual(r, []); });
t("U3 read: bad fields reject the block with one line, never its contents", () => { [["as_of", "2026-11-01"], ["weekly_used_pct", "67"], ["on_demand_pct", -1], ["on_demand_maxed", "no"], ["weekly_resets", null]].forEach(([k, v]) => { const r = []; assert.strictEqual(U.read(Object.assign({}, OK, { [k]: v }), r), null, k); assert.strictEqual(r.length, 1); assert.ok(r[0].includes(k) && !r[0].includes("example.com")); });
  const r = []; assert.strictEqual(U.read([1], r), null); assert.strictEqual(r.length, 1); });
t("U4 detail link: https only", () => { assert.strictEqual(U.read(Object.assign({}, OK, { detail_url: "http://example.com/x" })).detail_url, null); assert.strictEqual(U.read(Object.assign({}, OK, { detail_url: "javascript:alert(1)" })).detail_url, null);
  assert.strictEqual(U.read(Object.assign({}, OK, { detail_url: "https://example.com/a b" })).detail_url, null); assert.strictEqual(U.httpsUrl("https://example.com/usage"), "https://example.com/usage"); });
t("U5 read never keeps dollar fields or bots", () => { const x = U.read(Object.assign({}, OK, { on_demand_used: 12.34, on_demand_limit: 50, bots: { "Example Bot": 1 } })); assert.ok(!("on_demand_used" in x) && !("on_demand_limit" in x) && !("bots" in x)); });
t("U6 model: percent text, bar capped at 100, Maxed", () => { const m = U.model(U.read(OK), NOW); assert.strictEqual(m.weekly, "67.9%"); assert.strictEqual(m.onDemand, "24.7%"); assert.strictEqual(m.bar, 67.9);
  assert.strictEqual(U.model(Object.assign({}, OK, { weekly_used_pct: 130 }), NOW).bar, 100); const mx = U.model(Object.assign({}, OK, { on_demand_pct: 100, on_demand_maxed: true }), NOW); assert.strictEqual(mx.onDemand, "Maxed"); assert.ok(mx.warn); });
t("U7 warning tone: weekly above 80, or on-demand maxed", () => { assert.ok(!U.model(Object.assign({}, OK, { weekly_used_pct: 80 }), NOW).warn); assert.ok(U.model(Object.assign({}, OK, { weekly_used_pct: 80.1 }), NOW).warn); assert.ok(!U.model(OK, NOW).warn); });
t("U8 stale after 3 days", () => { assert.ok(!U.model(OK, "2026-11-04T07:15:00-06:00").stale); assert.ok(U.model(OK, "2026-11-04T07:16:00-06:00").stale); });
t("U9 times are America/Chicago with a CT label, whatever the zone (CDT and CST)", () => { assert.strictEqual(U.ct("2026-11-01T07:15:00-06:00"), "Sun 11/1 7:15 AM CT"); assert.strictEqual(U.ct("2026-10-19T12:30:00Z"), "Mon 10/19 7:30 AM CT"); assert.strictEqual(U.ct("2026-11-06T11:03:00Z"), "Fri 11/6 5:03 AM CT");
  assert.strictEqual(U.model(OK, NOW).asOf, "Sun 11/1 7:15 AM CT"); });
t("U10 no dollar amount is ever rendered", () => { const D = String.fromCharCode(36); assert.strictEqual(U.noDollar("used " + D + "12.34 of " + D + "50").includes(D + "1"), false); const m = U.model(OK, NOW); assert.ok(!/\$/.test(JSON.stringify(m))); });
t("U11 example placeholder numbers, no link", () => { const e = U.example("2026-10-19T07:30:00-05:00"); assert.strictEqual(e.weekly_used_pct, 42); assert.strictEqual(e.detail_url, null); assert.ok(U.model(e, "2026-10-19T09:00:00-05:00").example); });
t("U12 readSnapshot: usage read; a bad block is rejected and the snapshot kept; older snapshots have usage null", () => {
  const base = { schema_version: 1, generated_at: "2026-11-01T07:30:00-06:00", source: "inbox-export", tasks: [], accounts: [], touches: [], calendar: [], totals_history: [] };
  assert.strictEqual(R.readSnapshot(Object.assign({}, base, { usage: OK })).usage.on_demand_pct, 24.7); const s = R.readSnapshot(Object.assign({}, base, { usage: { as_of: "x" } })); assert.strictEqual(s.usage, null); assert.ok(s.rejects.some(x => /^usage:/.test(x)));
  assert.strictEqual(R.readSnapshot(base).usage, null); });
console.log(`${n - fail}/${n} passed`); if (fail) process.exit(1);
