// node tests/mreport.test.js — unit tests for js/mreport.js (00.11.000 Copy for manager).  Fictional data only.
const assert = require("assert"); const path = require("path"); const fs = require("fs");
require(path.join(__dirname, "../js/rules.js")); require(path.join(__dirname, "../js/mreport.js"));
const M = globalThis.DASH.mreport;
let n = 0, fail = 0; function t(name, fn) { n++; try { fn(); console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } }
const EX = fs.readFileSync(path.join(__dirname, "../examples/example-sam-activity-2026-10.md"), "utf8");
const D = String.fromCharCode(36);
t("MR1 parse: month, name line, two sections, alternates", () => { const r = M.parse("2026-10.md", EX); assert.strictEqual(r.month, "2026-10"); assert.strictEqual(r.nameLine, "Jordan P.:"); assert.strictEqual(r.sections[0].items.length, 4); assert.strictEqual(r.sections[1].items.length, 3); assert.ok(r.sections[0].items[3].alt); });
t("MR2 default ticks: first 3 primaries, alternates off", () => { const r = M.parse("2026-10.md", EX); assert.deepStrictEqual(M.defaultTicks(r), [[true, true, true, false], [true, true, true]]); });
t("MR3 plain text: name line, headings, bullets; two spaces after sentences kept; no Restricted line", () => { const r = M.parse("x.md", EX), p = M.plain(r, M.defaultTicks(r));
  const L = p.split("\n"); assert.strictEqual(L[0], "Jordan P.:"); assert.strictEqual(L[1], "Client or Industry Activity"); assert.ok(L[2].startsWith("• Northwind Example: design review")); assert.ok(L[2].includes("closed out.  Layout approved"));
  assert.ok(p.includes("Internal Business Successes & Challenges")); assert.ok(!/Restricted/.test(p)); assert.ok(!p.includes("Tailspin")); });
t("MR4 dollar figures and emails are dropped and counted; Confidential stays as written", () => { const r = M.parse("2026-11.md", "## Client or Industry Activity\n- A: won " + D + "40k.  Ok.\n- B: mail x@mail.example.  Ok.\n- Confidential: moved.  Ok.\n"); assert.deepStrictEqual(r.dropped, { money: 1, email: 1 }); assert.strictEqual(r.sections[0].items.length, 1); assert.ok(r.sections[0].items[0].text.startsWith("Confidential:")); });
t("MR5 marked items ([unverified], (proposed), HOLD) are unticked by default", () => { const r = M.parse("2026-11.md", "## Client or Industry Activity\n- A: x [unverified].  Ok.\n- B: y.  Ok.\n"); assert.deepStrictEqual(M.defaultTicks(r), [[false, true], []]); });
t("MR6 errors name the file and rule; no month or no bullets is refused", () => { assert.throws(() => M.parse("notes.md", "## Client or Industry Activity\n- A"), /notes\.md:1 month/); assert.throws(() => M.parse("2026-10.md", "# Nothing\n"), /no bullets/); });
t("MR7 .md carries the Restricted label first", () => { const r = M.parse("x.md", EX); assert.ok(M.md(r, M.defaultTicks(r)).startsWith("**Restricted - Internal Use Only**")); });
t("MR8 Word file is a zip with the 7 parts and the label in header and footer", () => { const r = M.parse("x.md", EX), b = M.docx(r, M.defaultTicks(r)), s = Buffer.from(b).toString("latin1");
  assert.strictEqual(s.slice(0, 2), "PK"); ["[Content_Types].xml", "word/document.xml", "word/styles.xml", "word/header1.xml", "word/footer1.xml", "_rels/.rels", "word/_rels/document.xml.rels"].forEach(p => assert.ok(s.includes(p), p)); assert.ok(s.includes("<w:hdr") && s.split("Restricted - Internal Use Only").length >= 3); });
t("MR9 store: add per month, newest import replaces", () => { let s = M.addReport(null, M.parse("x.md", EX), "2026-11-01T20:00:00-06:00"); assert.ok(s.months["2026-10"]); s = M.addReport(s, M.parse("2026-11.md", "## Client or Industry Activity\n- A: b.  C.\n"), "2026-11-01T21:00:00-06:00"); assert.strictEqual(Object.keys(s.months).length, 2); });
t("MR10 default month: the month just ended, the current one from the 20th", () => { assert.strictEqual(M.defaultMonth("2026-11-01"), "2026-10"); assert.strictEqual(M.defaultMonth("2026-11-20"), "2026-11"); assert.strictEqual(M.defaultMonth("2026-01-05"), "2025-12"); });
t("MR11 name line can come from local config instead", () => { const r = M.parse("x.md", EX.replace("Jordan P.:\n", "")); assert.strictEqual(r.nameLine, null); assert.ok(M.plain(r, M.defaultTicks(r), "Alex R.:").startsWith("Alex R.:\n")); });
console.log(`${n - fail}/${n} manager-report tests passed`); if (fail) process.exit(1);
