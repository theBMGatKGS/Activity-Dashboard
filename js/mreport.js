/* 00.11.000: Copy for manager (Manager's sheet; the button and panel carry the manager's name from config.local.js managerName, never from this repo).  Pure: reads the approved notebook file reports/sam-activity/YYYY-MM.md
   (T1C: the notebook file only, nothing is drafted from app data), and builds the plain text to paste (two spaces after
   sentences kept exactly, no Restricted line: T3A), the .md file and a minimal Word file (both labelled).
   The name line ("<Name>:") comes from the file or config.local.js (reportNameLine), never from this repo. */
(function (g) {
  "use strict";
  g.DASH = g.DASH || {};
  const R = () => g.DASH.rules;
  const SECTIONS = ["Client or Industry Activity", "Internal Business Successes & Challenges"];
  const LABEL = "Restricted - Internal Use Only";
  const MARKED = /\[unverified\]|\(proposed\)|\bHOLD\b/;
  const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
  const norm = s => s.toLowerCase().replace(/&amp;/g, "&").replace(/\band\b/g, "&").replace(/[^a-z&]+/g, " ").trim();
  // file: [name, text].  Returns {month, nameLine, sections:[{heading, items:[{text, alt, marked}]}], dropped:{money, email}} or throws with file:line rule.
  function parse(name, text) {
    const lines = String(text).replace(/\r\n?/g, "\n").split("\n"); let i = 0, month = null, nameLine = null;
    if (lines[0] === "---") { for (i = 1; i < lines.length && lines[i] !== "---"; i++) { const m = lines[i].match(/^month:\s*"?([0-9-]+)"?\s*$/); if (m) month = m[1]; } i++; }
    const fm = name.match(/(\d{4}-\d\d)\.md$/i); if (!month && fm) month = fm[1];
    if (!month || !MONTH.test(month)) throw new Error(`${name}:1 month must be YYYY-MM (front matter "month:" or the file name)`);
    const sections = SECTIONS.map(h => ({ heading: h, items: [] })), dropped = { money: 0, email: 0 }; let cur = null, alt = false;
    for (; i < lines.length; i++) {
      const L = lines[i], ln = i + 1;
      const h = L.match(/^#{1,4}\s+(.+?)\s*$/);
      if (h) { const k = norm(h[1]); const idx = SECTIONS.findIndex(s => norm(s) === k); if (idx >= 0) { cur = sections[idx]; alt = false; } else if (/^alternates?\b/i.test(h[1].trim())) alt = true; else if (/^#\s/.test(L)) { cur = null; } continue; }
      const nm = L.match(/^([A-Z][\w.' -]{0,40}):\s*$/); if (nm && !cur && !nameLine) { nameLine = nm[1] + ":"; continue; }
      const b = L.match(/^\s*(?:[-*•])\s+(.*\S)\s*$/); if (!b || !cur) continue;
      let t = b[1], isAlt = alt; if (/^\[alt(ernate)?\]\s*/i.test(t)) { t = t.replace(/^\[alt(ernate)?\]\s*/i, ""); isAlt = true; }
      if (R().hasMoney(t)) { dropped.money++; continue; }
      if (R().hasEmail(t)) { dropped.email++; continue; }
      if (t.length > 600) throw new Error(`${name}:${ln} a bullet is longer than 600 characters`);
      cur.items.push({ text: t, alt: isAlt, marked: MARKED.test(t) });
    }
    if (!sections.some(s => s.items.length)) throw new Error(`${name}: no bullets under "${SECTIONS[0]}" or "${SECTIONS[1]}"`);
    return { month, nameLine, sections, dropped, file: name };
  }
  // Default ticks: the first 3 primaries per section that aren't marked [unverified], (proposed) or HOLD.
  function defaultTicks(rep) { return rep.sections.map(s => { let k = 0; return s.items.map(it => !it.alt && !it.marked && k++ < 3); }); }
  const picked = (rep, ticks) => rep.sections.map((s, i) => ({ heading: s.heading, items: s.items.filter((_, j) => ticks[i] && ticks[i][j]).map(x => x.text) }));
  // Plain text to paste into the manager's document: no Restricted line (T3A); the text is kept exactly (two spaces stay).
  function plain(rep, ticks, nameLine) {
    const out = []; const nl = nameLine || rep.nameLine; if (nl) out.push(nl);
    picked(rep, ticks).forEach(s => { out.push(s.heading); s.items.forEach(t => out.push("• " + t)); if (!s.items.length) out.push("• (none this month)"); });
    return out.join("\n") + "\n";
  }
  function md(rep, ticks, nameLine) {
    const out = [`**${LABEL}**`, ""]; const nl = nameLine || rep.nameLine; if (nl) out.push(nl, "");
    picked(rep, ticks).forEach(s => { out.push("## " + s.heading, ""); s.items.forEach(t => out.push("- " + t)); out.push(""); });
    return out.join("\n");
  }
  const x = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  const run = (t, b) => `<w:r>${b ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
  const para = (t, o) => `<w:p>${o && o.style ? `<w:pPr><w:pStyle w:val="${o.style}"/></w:pPr>` : ""}${run(t, o && o.bold)}</w:p>`;
  // Minimal Word file (stored zip, 7 parts): label in the header and footer, a name line, two headings and bullet paragraphs.
  function docx(rep, ticks, nameLine) {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"', H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    const nl = nameLine || rep.nameLine, body = (nl ? para(nl, { bold: true }) : "") + picked(rep, ticks).map(s => para(s.heading, { style: "Heading2" }) + s.items.map(t => para("• " + t)).join("")).join("");
    const files = [
      ["[Content_Types].xml", `${H}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`],
      ["_rels/.rels", `${H}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
      ["word/_rels/document.xml.rels", `${H}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`],
      ["word/styles.xml", `${H}<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style></w:styles>`],
      ["word/header1.xml", `${H}<w:hdr ${W}>${para(LABEL)}</w:hdr>`],
      ["word/footer1.xml", `${H}<w:ftr ${W}>${para(LABEL)}</w:ftr>`],
      ["word/document.xml", `${H}<w:document ${W}><w:body>${body}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`]];
    return R().zipStore(files);
  }
  function emptyStore() { return { schema_version: 1, updated_at: null, months: {} }; }
  function readStore(raw) { if (!raw || raw.schema_version !== 1 || !raw.months || typeof raw.months !== "object") throw new Error("reports store: schema_version must be 1"); const out = emptyStore(); out.updated_at = raw.updated_at || null;
    for (const [k, v] of Object.entries(raw.months)) if (MONTH.test(k) && v && Array.isArray(v.sections)) out.months[k] = v; return out; }
  function addReport(store, rep, nowIso) { const s = readStore(store || emptyStore()); s.months[rep.month] = Object.assign({}, rep, { imported_at: nowIso }); s.updated_at = nowIso; return s; }
  // The month the panel opens on: the month just ended, or the current month from the 20th on (plan §7).
  function defaultMonth(today) { const y = +today.slice(0, 4), m = +today.slice(5, 7), d = +today.slice(8, 10); if (d >= 20) return today.slice(0, 7); const p = new Date(Date.UTC(y, m - 2, 1)); return p.toISOString().slice(0, 7); }
  g.DASH.mreport = { SECTIONS, LABEL, parse, defaultTicks, plain, md, docx, emptyStore, readStore, addReport, defaultMonth };
})(typeof window !== "undefined" ? window : globalThis);
