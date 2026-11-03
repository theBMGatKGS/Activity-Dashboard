// node tests/notebook.test.js — 00.11.002 notebook client (js/notebook.js): hard path allowlist, append-only writes to the
// dashboard/inbox branch only (2B), never main.  GitHub is mocked (tests/fake_github.js fakeNotebook); placeholder data only.
"use strict";
const path = require("path");
require(path.join(__dirname, "../js/vault.js")); require(path.join(__dirname, "../js/hub.js")); require(path.join(__dirname, "../js/nbinbox.js")); require(path.join(__dirname, "../js/notebook.js"));
const NB = globalThis.DASH.notebook, { fakeNotebook } = require(path.join(__dirname, "fake_github.js"));
let pass = 0, fail = 0; function check(c, msg) { if (c) { pass++; console.log("PASS " + msg); } else { fail++; console.log("FAIL " + msg); } }
async function rejects(fn, test) { try { await fn(); return false; } catch (e) { return test instanceof RegExp ? test.test(e.message) : test ? test(e) : true; } }
const TOKEN = "github_pat_" + "N".repeat(40), SRC = "crm/outbox/sam-report/{month}/sources.md", DAY = "inbox/dashboard/2026-11-03.md";
(async () => {
  check(NB.pathKind("reports/sam-activity/2026-10.md") === "bullets", "NB1 bullets path");
  check(NB.pathKind("crm/outbox/sam-report/2026-10/sources.md", SRC) === "sources", "NB2 sources path from the Links pattern");
  check(NB.pathKind(DAY) === "inbox" && NB.pathKind("inbox/dashboard/2028-02-29.md") === "inbox", "NB3 inbox path (leap day ok)");
  const bad = ["reports/sam-activity/../x.md", "inbox/dashboard/2026-11-03.md/../../Home.md", "Home.md", "inbox/dashboard/notes.md", "/inbox/dashboard/2026-11-03.md", "inbox\\dashboard\\2026-11-03.md", "reports/sam-activity/2026-13.md", "inbox/dashboard/2026-11-32.md", "inbox/dashboard/2026-02-31.md", "inbox/dashboard/2026-04-31.md", "inbox/dashboard/2025-02-29.md", "crm/outbox/sam-report/x/sources.md", "", null];
  check(bad.every(b => NB.pathKind(b, SRC) === null), "NB4 traversal, other files and bad dates refused");
  check(NB.WRITE_BRANCH === "dashboard/inbox", "NB5 the write branch is hard-coded dashboard/inbox");
  const fake = fakeNotebook(); const c = NB.client({ repo: "owner/notebook", token: TOKEN, branch: "main", sources: SRC, fetch: fake.fetch });
  check(await rejects(() => c.append("reports/sam-activity/2026-10.md", "- x <!-- dash:n-x -->\n"), /Refused|only writes/), "NB6 write outside inbox refused");
  check(fake.log.length === 0, "NB7 a refused write makes no request");
  check(await rejects(() => c.read("Home.md"), /not a notebook file/), "NB8 read outside the allowlist refused");
  check(await rejects(() => NB.client({ repo: "owner/notebook", token: TOKEN, writeBranch: "main", fetch: fake.fetch }).append(DAY, "- a <!-- dash:n-a -->\n"), /main/), "NB9 a caller can't point writes at main");
  fake.put("reports/sam-activity/2026-10.md", "### Example Account A\n- a\n");
  const r = await c.read("reports/sam-activity/2026-10.md"); check(r && r.text.startsWith("### Example Account A") && r.sha, "NB10 read bullets from main");
  check(fake.log[fake.log.length - 1].ref === "main", "NB11 reads use the Links branch");
  check(await c.read("reports/sam-activity/2026-09.md") === null, "NB12 404 → null");
  check(c.rate.remaining === 4999 && c.rate.reset === 1793734800, "NB13 rate headers kept");
  // first write: branch missing → created from main, then file created on the branch only
  const s1 = await c.append(DAY, "- one <!-- dash:n-1 -->\n", "dashboard: 1 note");
  check(fake.branches.has("dashboard/inbox"), "NB14 dashboard/inbox branch created from main when missing");
  check(fake.get(DAY, "dashboard/inbox") === "# Dashboard inbox 2026-11-03\n\n- one <!-- dash:n-1 -->\n" && fake.get(DAY, "main") === null, "NB15 file created on dashboard/inbox, never on main");
  check(/commit\/k\d+$/.test(s1.commitUrl), "NB16 commit link returned");
  await c.append(DAY, "- two <!-- dash:n-2 -->\n");
  check(fake.get(DAY, "dashboard/inbox").endsWith("- one <!-- dash:n-1 -->\n- two <!-- dash:n-2 -->\n"), "NB17 append keeps bytes");
  fake.conflictOnce(DAY, "- other computer <!-- dash:n-o -->\n");
  await c.append(DAY, "- three <!-- dash:n-3 -->\n");
  check(fake.get(DAY, "dashboard/inbox").endsWith("- other computer <!-- dash:n-o -->\n- three <!-- dash:n-3 -->\n"), "NB18 409 → re-read and re-append, other computer's line kept");
  const before = fake.get(DAY, "dashboard/inbox"); await c.append(DAY, "- three <!-- dash:n-3 -->\n"); check(fake.get(DAY, "dashboard/inbox") === before, "NB19 a retried append adds nothing");
  const puts = fake.log.filter(l => l.method !== "GET"), refPosts = puts.filter(l => l.method === "POST");
  check(puts.filter(l => l.method === "PUT").every(l => l.path.endsWith("/contents/" + DAY) && l.body.branch === "dashboard/inbox"), "NB20 every PUT is the day file on dashboard/inbox");
  check(refPosts.length === 1 && refPosts[0].body.ref === "refs/heads/dashboard/inbox", "NB21 the only other write is creating refs/heads/dashboard/inbox once");
  check(!fake.log.some(l => l.method === "DELETE" || l.method === "PATCH"), "NB22 no DELETE or PATCH ever");
  const bt = NB.client({ repo: "owner/notebook", token: "github_pat_" + "Z".repeat(40), fetch: fake.fetch });
  check(await rejects(() => bt.read("reports/sam-activity/2026-10.md"), e => e.status === 401 && !String(e.message + e.stack).includes("ZZZZZZZZ")), "NB23 bad token: 401, token never in the error");
  fake.status("reports/sam-activity/2026-08.md", 403, true);
  check(await rejects(() => c.read("reports/sam-activity/2026-08.md"), e => e.status === 403 && e.name === "AuthError"), "NB24 403 → AuthError");
  fake.status("reports/sam-activity/2026-08.md", 429, true);
  check(await rejects(() => c.read("reports/sam-activity/2026-08.md"), e => e.name === "RateLimit" && e.reset === 1793734800), "NB25 429 → RateLimit with the reset time");
  const off = NB.client({ repo: "owner/notebook", token: TOKEN, fetch: fakeNotebook({ offline: true }).fetch });
  check(await rejects(() => off.read("reports/sam-activity/2026-10.md"), e => e.name === "NetworkError"), "NB26 offline → NetworkError");
  fake.status(DAY, 500, false);
  check(await rejects(() => c.append(DAY, "- four <!-- dash:n-4 -->\n"), e => e.status === 500), "NB27 5xx surfaces for the retry queue");
  check(await rejects(() => NB.client({ repo: "../x", token: TOKEN, fetch: fake.fetch }).read("reports/sam-activity/2026-10.md")), "NB28 bad repo refused");
  console.log(`${pass}/${pass + fail} notebook tests passed`); if (fail) process.exit(1);
})().catch(e => { console.log("FAIL notebook tests crashed: " + e.message); process.exit(1); });
