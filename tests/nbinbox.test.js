// node tests/nbinbox.test.js — 00.11.002 Outbox model and daily inbox append text (js/nbinbox.js).  Placeholder data only.
"use strict";
const assert = require("assert"), path = require("path");
require(path.join(__dirname, "../js/nbinbox.js")); const NI = globalThis.DASH.nbinbox;
let n = 0, fail = 0; function t(name, fn) { n++; try { fn(); console.log("PASS", name); } catch (e) { fail++; console.log("FAIL", name, "-", e.message); } }
const P = "inbox/dashboard/2026-11-03.md";
const before = "# Dashboard inbox 2026-11-03\n\n- 09:00 CT · To Do cleared · Example task: done.  <!-- dash:n-a -->\n";
t("NI1 append keeps existing bytes", () => { const a = NI.appendTo(before, P, "- 10:00 CT · Project update · Example project: moved.  <!-- dash:n-b -->\n"); assert.ok(a.startsWith(before)); assert.ok(a.endsWith("<!-- dash:n-b -->\n")); });
t("NI2 a retried append is idempotent (id marker already there)", () => { const a = NI.appendTo(before, P, "- x <!-- dash:n-b -->\n"); assert.strictEqual(NI.appendTo(a, P, "- 10:00 CT · x <!-- dash:n-b -->\n"), a); });
t("NI3 header on create", () => assert.strictEqual(NI.appendTo(null, P, "- a <!-- dash:n-c -->\n"), "# Dashboard inbox 2026-11-03\n\n- a <!-- dash:n-c -->\n"));
t("NI4 a trailing newline is added before appending", () => assert.strictEqual(NI.appendTo("no newline", P, "- a <!-- dash:n-d -->\n"), "no newline\n- a <!-- dash:n-d -->\n"));
t("NI5 day file in the dashboard zone", () => { assert.strictEqual(NI.dayFile("2026-11-04T04:30:00Z", "America/Chicago"), "inbox/dashboard/2026-11-03.md"); assert.strictEqual(NI.dayFile("2026-11-04T06:30:00Z", "America/Chicago"), "inbox/dashboard/2026-11-04.md"); });
t("NI6 notes are flattened to one line (no markdown injection)", () => { const r = NI.render([{ id: "n-e", kind: "todo", ref: "R", text: "line1\n# heading\n---", at: "2026-11-03T16:00:00Z" }], "America/Chicago");
  assert.ok(!r.includes("\n#")); assert.ok(!r.includes("\n---")); assert.strictEqual(r.split("\n").filter(Boolean).length, 1); assert.ok(r.startsWith("- 10:00 CT · To Do cleared · R: line1")); assert.ok(r.includes("<!-- dash:n-e -->")); });
t("NI7 1C: typed notes are checked by default, automatic lines unchecked", () => { let o = NI.empty(); o = NI.addNote(o, { kind: "todo", ref: "Example task", text: "typed", at: "2026-11-03T16:00:00Z", auto: false });
  o = NI.addNote(o, { kind: "project", ref: "Example project", text: "moved to Done", at: "2026-11-03T16:01:00Z", auto: true });
  assert.strictEqual(o.notes.length, 2); assert.strictEqual(o.notes[0].checked, true); assert.strictEqual(o.notes[1].checked, false); assert.ok(/^n-[a-z0-9]+$/.test(o.notes[0].id)); assert.notStrictEqual(o.notes[0].id, o.notes[1].id); });
t("NI8 pick returns only the chosen notes; markSent and discard; unsent notes stay (3A)", () => { let o = NI.empty(); o = NI.addNote(o, { kind: "todo", ref: "A", text: "a", at: "2026-11-03T16:00:00Z" }); o = NI.addNote(o, { kind: "todo", ref: "B", text: "b", at: "2026-11-03T16:00:00Z" });
  const [x, y] = o.notes.map(z => z.id); assert.deepStrictEqual(NI.pick(o, [y]).map(z => z.id), [y]);
  o = NI.markSent(o, [y], "https://github.com/owner/notebook/commit/k1"); assert.deepStrictEqual(o.notes.map(z => z.id), [x]); assert.strictEqual(o.sent[0].id, y); assert.ok(o.sent[0].commitUrl.endsWith("k1"));
  o = NI.discard(o, [x]); assert.strictEqual(o.notes.length, 0); });
t("NI9 empty or whitespace notes are not queued; text is capped at 600 characters", () => { let o = NI.addNote(NI.empty(), { kind: "todo", ref: "A", text: "   ", at: "2026-11-03T16:00:00Z" }); assert.strictEqual(o.notes.length, 0);
  o = NI.addNote(o, { kind: "todo", ref: "A", text: "x".repeat(900), at: "2026-11-03T16:00:00Z" }); assert.ok(o.notes[0].text.length <= 600); });
t("NI10 dollar figures are refused in a note (no dollar figures in the notebook inbox)", () => { const o = NI.addNote(NI.empty(), { kind: "todo", ref: "A", text: "costs " + String.fromCharCode(36) + "40k", at: "2026-11-03T16:00:00Z" }); assert.strictEqual(o.notes.length, 1); assert.ok(!o.notes[0].text.includes(String.fromCharCode(36))); });
console.log(`${n - fail}/${n} nbinbox tests passed`); if (fail) process.exit(1);
