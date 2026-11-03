/* 00.11.002: SAM bullets for the side drawer (pure).  Reads the notebook file reports/sam-activity/YYYY-MM.md, which uses
   "### <Account>" headings with "- " bullets.  Approved only when the front matter says status: final or status: approved and no
   heading says DRAFT; anything else is Draft (Copy stays off).  Dollar figures and emails are dropped and counted.  Text is kept
   exactly (two spaces after sentences stay). */
(function (g) {
  "use strict";
  const R = () => g.DASH.rules, MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
  function parse(name, text) {
    const lines = String(text).replace(/\r\n?/g, "\n").split("\n"); let i = 0, month = null, status = null;
    if (lines[0] === "---") { for (i = 1; i < lines.length && lines[i] !== "---"; i++) {
      const m = lines[i].match(/^month:\s*["']?([0-9-]+)["']?\s*$/); if (m) month = m[1];
      const s = lines[i].match(/^status:\s*["']?([A-Za-z]+)["']?\s*$/); if (s) status = s[1].toLowerCase(); } i++; }
    const fm = String(name).match(/(\d{4}-\d\d)\.md$/i); if (!month && fm) month = fm[1];
    if (!month || !MONTH.test(month)) throw new Error(`${name}:1 month must be YYYY-MM (front matter "month:" or the file name)`);
    const accounts = [], dropped = { money: 0, email: 0 }; let cur = null, draftHead = false;
    for (; i < lines.length; i++) {
      const L = lines[i];
      const h = L.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
      if (h) { if (/\bDRAFT\b/.test(h[2])) draftHead = true; if (h[1].length >= 2 && !/\bDRAFT\b/.test(h[2])) { cur = { name: h[2], bullets: [] }; accounts.push(cur); } else cur = null; continue; }
      const b = L.match(/^\s*[-*•]\s+(.*\S)\s*$/); if (!b || !cur) continue;
      const t = b[1];
      if (R().hasMoney(t)) { dropped.money++; continue; }
      if (R().hasEmail(t)) { dropped.email++; continue; }
      if (t.length > 600) throw new Error(`${name}:${i + 1} a bullet is longer than 600 characters`);
      cur.bullets.push(t);
    }
    const acc = accounts.filter(a => a.bullets.length);
    if (!acc.length) throw new Error(`${name}: no bullets under any account heading`);
    return { month, status: (status === "final" || status === "approved") && !draftHead ? "approved" : "draft", accounts: acc, dropped, file: name };
  }
  const plainAccount = a => [a.name].concat(a.bullets.map(b => "- " + b)).join("\n");
  const plainAll = r => r.accounts.map(plainAccount).join("\n\n");
  g.DASH = g.DASH || {}; g.DASH.samdrawer = { parse, plainAccount, plainAll };
})(typeof window !== "undefined" ? window : globalThis);
