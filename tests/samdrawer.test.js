// node tests/samdrawer.test.js — 00.11.002 SAM bullets parser for account headings (js/samdrawer.js).  Placeholder data only.
"use strict";
const assert = require("assert"), path = require("path"), fs = require("fs");
require(path.join(__dirname, "../js/rules.js")); require(path.join(__dirname, "../js/samdrawer.js")); const SD = globalThis.DASH.samdrawer;
let n = 0, fail = 0; function t(name, fn) { n++; try { fn(); console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } }
const OK = "---\nmonth: 2026-10\nstatus: final\n---\n# SAM activity\n\n### Example Account A\n- Oct 3: Placeholder review.  Next step set.\n\n### Example Account B\n- Oct 9: Placeholder training.\n- Oct 12: Placeholder follow-up.\n";
t("SD1 accounts and bullets", () => { const r = SD.parse("2026-10.md", OK); assert.strictEqual(r.status, "approved"); assert.deepStrictEqual(r.accounts.map(a => a.name), ["Example Account A", "Example Account B"]); assert.strictEqual(r.accounts[1].bullets.length, 2); assert.strictEqual(r.month, "2026-10"); });
t("SD2 plain text per account and all; two spaces kept", () => { const r = SD.parse("2026-10.md", OK);
  assert.strictEqual(SD.plainAccount(r.accounts[1]), "Example Account B\n- Oct 9: Placeholder training.\n- Oct 12: Placeholder follow-up.");
  assert.ok(SD.plainAll(r).includes("Example Account A\n- Oct 3: Placeholder review.  Next step set.\n\nExample Account B")); });
t("SD3 status: approved also counts; draft, missing status and a DRAFT heading are Draft", () => {
  assert.strictEqual(SD.parse("2026-10.md", "---\nmonth: 2026-10\nstatus: approved\n---\n### X Example\n- a\n").status, "approved");
  assert.strictEqual(SD.parse("2026-10.md", "---\nmonth: 2026-10\nstatus: \"Final\"\n---\n### X Example\n- a\n").status, "approved");
  assert.strictEqual(SD.parse("2026-10.md", "---\nmonth: 2026-10\nstatus: draft\n---\n### X Example\n- a\n").status, "draft");
  assert.strictEqual(SD.parse("2026-10.md", "---\nmonth: 2026-10\n---\n### X Example\n- a\n").status, "draft");
  assert.strictEqual(SD.parse("2026-10.md", "### X Example\n- a\n").status, "draft");
  assert.strictEqual(SD.parse("2026-10.md", "---\nstatus: final\n---\n## DRAFT notes\n### X Example\n- a\n").status, "draft"); });
t("SD4 dollar figures and emails dropped and counted", () => { const r = SD.parse("2026-10.md", "### X Example\n- costs " + String.fromCharCode(36) + "1,000 placeholder\n- mail x@mail.example\n- ok\n"); assert.strictEqual(r.dropped.money, 1); assert.strictEqual(r.dropped.email, 1); assert.strictEqual(r.accounts[0].bullets.length, 1); });
t("SD5 no bullets refused; month from the file name", () => { assert.throws(() => SD.parse("2026-10.md", "no bullets"), /no bullets/); assert.strictEqual(SD.parse("reports/sam-activity/2026-09.md", "### X Example\n- a\n").month, "2026-09"); });
t("SD6 fixtures parse: approved and draft", () => { const a = SD.parse("2026-10.md", fs.readFileSync(path.join(__dirname, "fixtures/example-sam-accounts-2026-10.md"), "utf8")); assert.strictEqual(a.status, "approved"); assert.ok(a.accounts.length >= 2);
  const d = SD.parse("2026-10.md", fs.readFileSync(path.join(__dirname, "fixtures/example-sam-accounts-draft.md"), "utf8")); assert.strictEqual(d.status, "draft"); });
t("SD7 bullets before any account heading are ignored; sub-bullets fold into the account", () => { const r = SD.parse("2026-10.md", "- stray\n### X Example\n- a\n  - b\n"); assert.deepStrictEqual(r.accounts[0].bullets, ["a", "b"]); });
console.log(`${n - fail}/${n} samdrawer tests passed`); if (fail) process.exit(1);
