/* 00.11.002: Outbox model and the daily notebook inbox text (pure, no DOM, no network).
   1C: typed "Note for notebook" entries are checked by default; automatic lines from cleared to-dos and project updates are
   unchecked; Brent picks before sending.  3A: unsent notes stay until sent or discarded.  appendTo never alters existing bytes
   and skips notes whose <!-- dash:<id> --> marker is already in the file, so a retried append is idempotent. */
(function (g) {
  "use strict";
  const MAX = 600, KINDS = { todo: "To Do cleared", project: "Project update", note: "Note" };
  const DOLLAR = String.fromCharCode(36);
  const MONEY = new RegExp("\\" + DOLLAR + "\\s*[0-9][0-9,.]*\\s*[kKmMbB]?", "g");
  const flat = s => String(s == null ? "" : s).replace(/[\r\n\t]+/g, " ").replace(/<!--|-->/g, "").replace(MONEY, "[amount removed]").split(DOLLAR).join("").replace(/\s{3,}/g, "  ").trim();
  const empty = () => ({ v: 1, notes: [], sent: [] });
  let seq = 0;
  const newId = () => "n-" + Date.now().toString(36) + (seq++ % 1296).toString(36).padStart(2, "0") + Math.floor(Math.random() * 46656).toString(36).padStart(3, "0");
  function addNote(o, n) {
    o = o && Array.isArray(o.notes) ? o : empty();
    const text = flat(n && n.text).slice(0, MAX); if (!text) return o;
    const note = { id: n.id || newId(), kind: KINDS[n.kind] ? n.kind : "note", ref: flat(n.ref).slice(0, 120), text, at: n.at || new Date().toISOString(), auto: !!n.auto, checked: n.checked != null ? !!n.checked : !n.auto };
    return Object.assign({}, o, { notes: o.notes.concat([note]) });
  }
  const pick = (o, ids) => (o && o.notes || []).filter(n => ids.includes(n.id));
  const markSent = (o, ids, commitUrl) => Object.assign({}, o, { notes: o.notes.filter(n => !ids.includes(n.id)),
    sent: (o.sent || []).concat(o.notes.filter(n => ids.includes(n.id)).map(n => ({ id: n.id, kind: n.kind, ref: n.ref, text: n.text, at: n.at, sentAt: new Date().toISOString(), commitUrl: commitUrl || null }))).slice(-50) });
  const discard = (o, ids) => Object.assign({}, o, { notes: o.notes.filter(n => !ids.includes(n.id)) });
  const update = (o, id, patch) => Object.assign({}, o, { notes: o.notes.map(n => n.id === id ? Object.assign({}, n, patch.text != null ? { text: flat(patch.text).slice(0, MAX) } : {}, patch.checked != null ? { checked: !!patch.checked } : {}) : n) });
  function parts(iso, tz) {
    const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz || "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    const o = {}; for (const p of f.formatToParts(new Date(iso))) o[p.type] = p.value; return o;
  }
  const zoneLabel = tz => (!tz || tz === "America/Chicago") ? "CT" : tz;
  function render(notes, tz) {
    return notes.map(n => { const p = parts(n.at, tz); const ref = flat(n.ref);
      return `- ${p.hour}:${p.minute} ${zoneLabel(tz)} · ${KINDS[n.kind] || KINDS.note} · ${ref ? ref + ": " : ""}${flat(n.text)}  <!-- dash:${n.id} -->\n`; }).join("");
  }
  const dayFile = (iso, tz) => { const p = parts(iso, tz); return `inbox/dashboard/${p.year}-${p.month}-${p.day}.md`; };
  function appendTo(cur, path, add) {
    const day = (String(path).match(/(\d{4}-\d\d-\d\d)\.md$/) || [])[1] || "";
    const have = cur == null ? "" : String(cur);
    const lines = String(add || "").split(/(?<=\n)/).filter(l => { const m = l.match(/<!-- dash:(n-[a-z0-9]+) -->/); return l.trim() && !(m && have.includes(`<!-- dash:${m[1]} -->`)); })
      .map(l => l.endsWith("\n") ? l : l + "\n");
    if (cur == null) return `# Dashboard inbox ${day}\n\n` + lines.join("");
    if (!lines.length) return have;
    return have + (have && !have.endsWith("\n") ? "\n" : "") + lines.join("");
  }
  g.DASH = g.DASH || {}; g.DASH.nbinbox = { empty, addNote, pick, markSent, discard, update, render, dayFile, appendTo, MAX };
})(typeof window !== "undefined" ? window : globalThis);
