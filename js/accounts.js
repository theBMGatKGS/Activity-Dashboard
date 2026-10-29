/* Activity Dashboard 00.09.000: Accounts (strategic account plans, schema v1). Pure functions, no DOM, no network.
   Account plans are Markdown files kept in the notebook; the dashboard reads them (read-only) and keeps them only encrypted.
   Projects is the source of truth for tasks: open loops are added to the plan "Accounts – <account>" without duplicates. */
(function (g) {
  "use strict";
  const R = g.DASH.rules;
  const HEADS = ["## 1. What is happening", "## 2. Who influences the business", "## 3. What they are trying to accomplish", "## 4. Opportunities",
    "## 5. Relationship building", "## 6. Next strategic move", "## Sources & unverified items"];
  const SECTION_TITLES = HEADS.slice(0, 6).map(h => h.slice(3));
  const REQ = ["account", "slug", "tier", "segment", "region", "status", "last_updated", "touch_cadence", "confidential", "last_touch", "next_touch", "next_move", "open_loops", "sources", "unverified_count"];
  const TIERS = ["key", "prospect", "watch"], STATUSES = ["draft", "reviewed", "filed"], CADENCES = ["weekly", "biweekly", "monthly", "quarterly", "as-needed"];
  const BUCKETS = ["Follow-ups", "Waiting on", "Account touches", "Travel"], NEXT_BUCKET = "Next moves";
  const INFLUENCE = ["High", "Medium", "Low"], SENTIMENT = ["Champion", "Supporter", "Neutral", "Skeptic", "Blocker", "Unknown"];
  const STAGES = ["Identify", "Qualify", "Develop", "Propose", "Commit", "Won", "Lost", "On hold"];
  const T2_COLS = ["Name", "Org", "Role", "Influence", "Sentiment", "Last touch", "Notes"], T4_COLS = ["Opportunity", "Stage", "Next step", "Next step date"];
  const CAD_DAYS = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 91 };
  const TIER_ORDER = { key: 0, prospect: 1, watch: 2 };
  const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
  const UNV = /\s*\(unverified\)\s*/ig;
  const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  const MAX_FILE = 400000, MAX_STR = 600;
  const isDay = s => typeof s === "string" && DAY.test(s) && R.realDay(s);
  const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
  const cleanStr = s => String(s).replace(CTRL, "").trim().slice(0, MAX_STR);
  const normText = s => String(s || "").normalize("NFKC").replace(UNV, " ").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const fold = s => String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const unvOf = s => { const u = /\(unverified\)/i.test(s); return { text: cleanStr(String(s).replace(UNV, " ").replace(/\s+/g, " ")), unverified: u }; };
  function hashId(s) { let h1 = 0x811c9dc5, h2 = 5381; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0; h2 = ((h2 << 5) + h2 + c) >>> 0; } return h1.toString(36) + h2.toString(36); }

  // ---------- YAML front-matter subset: scalars, quoted strings, flow maps and lists, block lists; no anchors, tags or block scalars ----------
  class YErr extends Error { constructor(line, msg) { super(msg); this.line = line; } }
  function scalar(s, where) {
    s = s.trim();
    if (s === "") return "";
    if (/^[&*!|>%@`]/.test(s)) throw new YErr(where, "anchors, aliases, tags and block scalars are not allowed");
    if (s[0] === '"') { if (!/^"(?:[^"\\]|\\.)*"$/.test(s)) throw new YErr(where, "unterminated quoted string"); try { return JSON.parse(s); } catch (e) { throw new YErr(where, "bad quoted string"); } }
    if (s[0] === "'") { if (!/^'(?:[^']|'')*'$/.test(s)) throw new YErr(where, "unterminated quoted string"); return s.slice(1, -1).replace(/''/g, "'"); }
    if (s[0] === "{" || s[0] === "[") return value(s, where);
    if (/^(null|~)$/i.test(s)) return null;
    if (/^-?\d+$/.test(s)) return Number(s);
    if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
    if (/\s#/.test(s)) s = s.replace(/\s+#.*$/, "");
    if (/[{}\[\]]/.test(s)) throw new YErr(where, "unbalanced brackets");
    return s;
  }
  function splitFlow(body, where) {   // split on top-level commas, respecting quotes and nesting
    const out = []; let cur = "", depth = 0, q = null;
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (q) { cur += c; if (c === "\\" && q === '"') { cur += body[++i] || ""; continue; } if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      if (c === "{" || c === "[") depth++;
      if (c === "}" || c === "]") { depth--; if (depth < 0) throw new YErr(where, "unbalanced brackets"); }
      if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
      cur += c;
    }
    if (q || depth) throw new YErr(where, "unbalanced brackets or quotes");
    if (cur.trim()) out.push(cur);
    return out;
  }
  function putKey(o, k, v, where) {
    if (BAD_KEYS.has(k)) throw new YErr(where, `key ${k} is not allowed`);
    if (Object.prototype.hasOwnProperty.call(o, k)) throw new YErr(where, `key ${k} is repeated`);
    o[k] = v;
  }
  function value(s, where) {
    s = s.trim();
    if (s[0] === "{") { if (s[s.length - 1] !== "}") throw new YErr(where, "unbalanced braces"); const o = {};
      splitFlow(s.slice(1, -1), where).forEach(part => { const m = part.match(/^\s*([A-Za-z_][\w-]*)\s*:\s*([\s\S]*)$/); if (!m) throw new YErr(where, "bad flow map entry"); putKey(o, m[1], scalar(m[2], where), where); });
      return o; }
    if (s[0] === "[") { if (s[s.length - 1] !== "]") throw new YErr(where, "unbalanced brackets"); return splitFlow(s.slice(1, -1), where).map(x => scalar(x, where)); }
    return scalar(s, where);
  }
  function parseFront(lines, base) {   // lines of the front matter; base = file line number of the first one
    const o = {}, lines2 = {}; let i = 0;
    while (i < lines.length) {
      const ln = lines[i], where = base + i;
      if (!ln.trim() || /^\s*#/.test(ln)) { i++; continue; }
      if (/^---|^\.\.\./.test(ln)) throw new YErr(where, "only one YAML document is allowed");
      const m = ln.match(/^([A-Za-z_][\w-]*):(?:\s+(.*))?$/);
      if (!m) throw new YErr(where, "expected key: value");
      const k = m[1], rest = (m[2] || "").trim(); lines2[k] = where;
      if (rest !== "") { putKey(o, k, value(rest, where), where); i++; continue; }
      const items = []; let j = i + 1;
      while (j < lines.length && (/^\s+/.test(lines[j]) || !lines[j].trim())) {
        const t = lines[j]; if (!t.trim()) { j++; continue; }
        const li = t.match(/^\s+-\s+(.*)$/); if (!li) throw new YErr(base + j, "expected a list item (- …)");
        items.push({ v: value(li[1], base + j), line: base + j }); j++;
      }
      putKey(o, k, items.length ? items.map(x => x.v) : null, where); lines2[k + "[]"] = items.map(x => x.line); i = j;
    }
    return { data: o, lines: lines2 };
  }

  // ---------- parser for one account plan ----------
  const loopId = (slug, bucket, item) => hashId(slug + "|" + bucket + "|" + normText(item));
  function parseAccountMd(name, text) {
    const problems = [], warnings = [], P = (line, rule, msg) => problems.push({ line, rule, msg });
    if (typeof text !== "string" || text.length > MAX_FILE) { P(1, "FILE", "not a text file or too large"); return { problems, warnings, account: null }; }
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    // Guards first: every line, front matter included (no dollar figures, no email addresses, no phone numbers).
    lines.forEach((l, i) => { if (R.hasMoney(l)) P(i + 1, "PRICE", "no dollar figures or pricing"); if (R.hasEmail(l)) P(i + 1, "EMAIL", "no email addresses (contact details come from contacts)"); if (PHONE_RE.test(l.normalize("NFKC"))) P(i + 1, "PHONE", "no phone numbers (contact details come from contacts)"); });
    if (lines[0] !== "---") { P(1, "FM-MISSING", "the file must start with --- front matter"); return { problems, warnings, account: null }; }
    const end = lines.indexOf("---", 1);
    if (end < 0) { P(1, "FM-MISSING", "front matter is not closed with ---"); return { problems, warnings, account: null }; }
    let fm, fl;
    try { const r = parseFront(lines.slice(1, end), 2); fm = r.data; fl = r.lines; } catch (e) { P(e.line || 1, "FM-YAML", e.message); return { problems, warnings, account: null }; }
    const L = k => fl[k] || 2;
    REQ.forEach(k => { if (!(k in fm)) P(2, "FM-REQ", `missing key ${k}`); });
    Object.keys(fm).forEach(k => { if (!REQ.includes(k)) warnings.push(`${name}:${L(k)} unknown key ${k} (ignored)`); });
    const base = name.replace(/^.*[\\/]/, "").replace(/\.md$/i, "");
    const str = (k, rule) => { const v = fm[k]; if (v != null && typeof v !== "string") { P(L(k), rule || "FM-TYPE", `${k} must be text`); return ""; } return v == null ? "" : cleanStr(v); };
    const slug = str("slug");
    if (slug && !/^[a-z0-9-]+$/.test(slug)) P(L("slug"), "SLUG-FORMAT", "slug must be lower-case letters, digits and -");
    if (slug !== base) P(L("slug"), "SLUG", `slug must equal the file name (${base})`);
    const enumv = (k, list, rule) => { const v = typeof fm[k] === "string" ? fm[k].trim().toLowerCase() : fm[k]; if (k in fm && !list.includes(v)) P(L(k), rule, `${k} must be one of ${list.join(", ")}`); return v; };
    const tier = enumv("tier", TIERS, "FM-TIER"), status = enumv("status", STATUSES, "FM-STATUS"), cadence = enumv("touch_cadence", CADENCES, "FM-CADENCE");
    if ("confidential" in fm && (typeof fm.confidential !== "string" || !fm.confidential.trim())) P(L("confidential"), "FM-CONFIDENTIAL", "confidential must be text");
    if ("last_updated" in fm && !isDay(String(fm.last_updated))) P(L("last_updated"), "FM-DATE", "last_updated must be a real date YYYY-MM-DD");
    const touch = k => { const o = fm[k]; if (!(k in fm)) return null;
      if (!o || typeof o !== "object" || Array.isArray(o) || Object.keys(o).sort().join() !== "date,type,with") { P(L(k), "FM-TOUCH-SHAPE", `${k} must be {date, type, with}`); return null; }
      if (!isDay(String(o.date))) P(L(k), "FM-DATE", `${k}.date must be a real date YYYY-MM-DD`);
      return { date: String(o.date), type: cleanStr(o.type == null ? "" : o.type), with: cleanStr(o.with == null ? "" : o.with) }; };
    const last_touch = touch("last_touch"), next_touch = touch("next_touch");
    const taskIdOf = (v, line) => { if (v == null || v === "") return null; if (typeof v !== "string") { P(line, "TASKID-TYPE", "task_id must be text"); return null; } return cleanStr(v).slice(0, 64) || null; };
    let next_move = null;
    if ("next_move" in fm) { const o = fm.next_move;
      if (!o || typeof o !== "object" || Array.isArray(o) || !["action", "owner", "due"].every(k => k in o) || Object.keys(o).some(k => !["action", "owner", "due", "task_id"].includes(k))) P(L("next_move"), "FM-NEXTMOVE-SHAPE", "next_move must be {action, owner, due, task_id?}");
      else { if (!isDay(String(o.due))) P(L("next_move"), "FM-DATE", "next_move.due must be a real date YYYY-MM-DD");
        const nm = unvOf(o.action == null ? "" : o.action);
        next_move = { action: nm.text, owner: cleanStr(o.owner == null ? "" : o.owner), due: String(o.due), task_id: taskIdOf(o.task_id, L("next_move")), unverified: nm.unverified }; } }
    const open_loops = [];
    if ("open_loops" in fm) {
      const arr = fm.open_loops == null ? [] : fm.open_loops, ll = fl["open_loops[]"] || [];
      if (!Array.isArray(arr)) P(L("open_loops"), "LOOP-SHAPE", "open_loops must be a list");
      else arr.forEach((l, i) => { const line = ll[i] || L("open_loops");
        if (!l || typeof l !== "object" || Array.isArray(l) || !["item", "bucket", "next_date"].every(k => k in l) || Object.keys(l).some(k => !["item", "bucket", "next_date", "task_id"].includes(k))) { P(line, "LOOP-SHAPE", "each open loop must be {item, bucket, next_date, task_id?}"); return; }
        const bucket = BUCKETS.find(b => b.toLowerCase() === String(l.bucket).trim().toLowerCase());
        if (!bucket) P(line, "LOOP-BUCKET", `bucket must be one of ${BUCKETS.join(", ")}`);
        if (!isDay(String(l.next_date))) P(line, "LOOP-DATE", "next_date must be a real date YYYY-MM-DD");
        const it = unvOf(l.item == null ? "" : l.item); if (!it.text) P(line, "LOOP-SHAPE", "item is required");
        open_loops.push({ id: loopId(slug || base, bucket || "", it.text), item: it.text, bucket: bucket || "", next_date: String(l.next_date), task_id: taskIdOf(l.task_id, line), unverified: it.unverified }); });
    }
    const sources = [];
    if ("sources" in fm) { const arr = fm.sources == null ? [] : fm.sources;
      if (!Array.isArray(arr)) P(L("sources"), "SOURCE-PATH", "sources must be a list");
      else arr.forEach((s, i) => { const line = (fl["sources[]"] || [])[i] || L("sources"); if (typeof s !== "string" || s.startsWith("/") || s.includes("..") || /^[a-z]+:/i.test(s)) P(line, "SOURCE-PATH", "sources are notebook paths (relative, no ..)"); else sources.push(cleanStr(s)); }); }
    if ("unverified_count" in fm && !Number.isInteger(fm.unverified_count)) P(L("unverified_count"), "FM-UNV-TYPE", "unverified_count must be a whole number");
    // ---- body ----
    const body = lines.slice(end + 1), off = end + 2, heads = [], sec = {};
    let cur = null;
    body.forEach((l, i) => { if (l.startsWith("## ")) { const h = l.trimEnd(); heads.push({ h, line: off + i }); if (sec[h]) P(off + i, "HEAD-ORDER", `heading repeated: ${h}`); cur = h; sec[h] = sec[h] || []; } else if (cur) sec[cur].push({ t: l, line: off + i }); });
    if (heads.map(x => x.h).join("\n") !== HEADS.join("\n")) P(heads.length ? heads[0].line : off, "HEAD-ORDER", "headings must be exactly, in order: " + HEADS.map(h => h.slice(3)).join(" · "));
    const listItems = h => { const out = []; (sec[h] || []).forEach(({ t, line }) => { const m = t.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/); if (m) out.push(Object.assign(unvOf(m[1]), { line })); else if (t.trim() && !t.trim().startsWith("|")) out.push(Object.assign(unvOf(t), { line })); }); return out.filter(x => x.text); };
    const table = (h, cols, rulePrefix) => {
      const rows = (sec[h] || []).filter(x => x.t.trim().startsWith("|")).map(x => ({ cells: x.t.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim()), line: x.line }));
      if (!rows.length) { warnings.push(`${name}: ${h.slice(3)} has no table`); return []; }
      if (rows[0].cells.join("|") !== cols.join("|")) P(rows[0].line, rulePrefix + "-HEADER", `table header must be | ${cols.join(" | ")} |`);
      return rows.slice(1).filter(r => !r.cells.every(c => /^:?-+:?$/.test(c))).filter(r => { if (r.cells.length !== cols.length) { P(r.line, rulePrefix + "-CELLS", `row needs ${cols.length} cells`); return false; } return true; });
    };
    const enumCell = (v, list, line, rule, what) => { const u = unvOf(v), m = list.find(x => x.toLowerCase() === u.text.toLowerCase()); if (!m) P(line, rule, `${what} must be one of ${list.join(", ")}`); return m || u.text; };
    const stakeholders = table(HEADS[1], T2_COLS, "T2").map(r => { const c = r.cells, any = c.some(x => /\(unverified\)/i.test(x)), lt = unvOf(c[5]).text;
      if (lt !== "unknown" && !isDay(lt)) P(r.line, "T2-DATE", "Last touch must be a date YYYY-MM-DD or unknown");
      return { name: unvOf(c[0]).text, org: unvOf(c[1]).text, role: unvOf(c[2]).text, influence: enumCell(c[3], INFLUENCE, r.line, "T2-INFLUENCE", "Influence"), sentiment: enumCell(c[4], SENTIMENT, r.line, "T2-SENTIMENT", "Sentiment"), last_touch: lt, notes: unvOf(c[6]).text, unverified: any }; });
    const opportunities = table(HEADS[3], T4_COLS, "T4").map(r => { const c = r.cells, d = unvOf(c[3]).text;
      if (!isDay(d)) P(r.line, "T4-DATE", "Next step date must be a real date YYYY-MM-DD");
      const nm = unvOf(c[0]).text; return { id: hashId((slug || base) + "|opp|" + normText(nm)), name: nm, stage: enumCell(c[1], STAGES, r.line, "T4-STAGE", "Stage"), next_step: unvOf(c[2]).text, next_step_date: d, unverified: c.some(x => /\(unverified\)/i.test(x)) }; });
    const lineOf = (h, k) => { const v = (sec[h] || []).filter(x => x.t.trim().startsWith(k + ":")); return v.length === 1 ? { v: v[0].t.trim().slice(k.length + 1).trim(), line: v[0].line } : { v: null, line: v[0] ? v[0].line : (heads.find(x => x.h === h) || { line: off }).line }; };
    const tl = o => o ? `${o.date} | ${o.type} | ${o.with}` : null;
    if (last_touch && next_touch && cadence) { const a = lineOf(HEADS[4], "Last touch"), b = lineOf(HEADS[4], "Next touch"), c = lineOf(HEADS[4], "Cadence");
      [[a, tl(last_touch)], [b, tl(next_touch)], [c, cadence]].forEach(([x, want]) => { if (x.v !== want) P(x.line, "S5-MATCH", `section 5 must say exactly what the front matter says (${want})`); }); }
    if (next_move) { const raw = fm.next_move; [["Action", String(raw.action)], ["Owner", String(raw.owner)], ["Due", String(raw.due)]].forEach(([k, want]) => { const x = lineOf(HEADS[5], k); if (x.v !== want) P(x.line, "S6-MATCH", `section 6 ${k} must equal the front matter (${want})`); }); }
    const unvItems = listItems(HEADS[6]).filter(x => /^\s*(?:[-*]|\d+\.)\s/.test((sec[HEADS[6]].find(y => y.line === x.line) || { t: "" }).t));
    if (Number.isInteger(fm.unverified_count) && fm.unverified_count !== unvItems.length) P(heads.find(x => x.h === HEADS[6]) ? heads.find(x => x.h === HEADS[6]).line : off, "UNV-COUNT", `unverified_count is ${fm.unverified_count} but section lists ${unvItems.length} item(s)`);
    if (problems.length) return { problems: problems.sort((a, b) => a.line - b.line), warnings, account: null };
    const strip = x => ({ text: x.text, unverified: x.unverified });
    const account = { slug, account: cleanStr(fm.account), tier, segment: str("segment"), region: str("region"), status, last_updated: String(fm.last_updated), confidential: str("confidential"),
      touch_cadence: cadence, last_touch, next_touch, next_move, open_loops, sources, unverified_count: fm.unverified_count,
      happening: listItems(HEADS[0]).map(strip), goals: listItems(HEADS[2]).map(strip), stakeholders, opportunities, unverified_items: unvItems.map(strip),
      source_file: base + ".md", source_sha256: hashId(text) };
    account.unverified_found = [account.happening, account.goals, stakeholders, opportunities, open_loops].reduce((n, l) => n + l.filter(x => x.unverified).length, 0) + (next_move && next_move.unverified ? 1 : 0);
    return { problems: [], warnings, account };
  }

  // ---------- store (accounts-store schema 1) ----------
  function emptyStore(nowIso) { return { schema_version: 1, updated_at: nowIso, accounts: [] }; }
  function readAccStore(raw) {
    if (!raw || typeof raw !== "object" || raw.schema_version !== 1) throw new Error("accounts-store: schema_version must be 1");
    if (typeof raw.updated_at !== "string" || isNaN(Date.parse(raw.updated_at))) throw new Error("accounts-store: updated_at must be a date-time");
    if (!Array.isArray(raw.accounts)) throw new Error("accounts-store: accounts must be a list");
    const accounts = raw.accounts.filter(a => a && typeof a.slug === "string" && /^[a-z0-9-]+$/.test(a.slug) && typeof a.account === "string" && Array.isArray(a.open_loops) && Array.isArray(a.stakeholders));
    return { schema_version: 1, updated_at: raw.updated_at, accounts, example: !!raw.example };
  }
  // All or nothing: any problem in any file and nothing is imported. SCHEMA.md and index.md are skipped.
  function importAccounts(files, store, nowIso) {
    const rejects = [], warnings = [], parsed = [];
    (files || []).forEach(([name, text]) => {
      const b = String(name).replace(/^.*[\\/]/, "");
      if (/^(schema|index)\.md$/i.test(b)) { warnings.push(`${b}: skipped`); return; }
      if (!/\.md$/i.test(b)) { rejects.push(`${b}:1 FILE only .md account plans are imported`); return; }
      const r = parseAccountMd(b, text); warnings.push(...r.warnings);
      r.problems.forEach(p => rejects.push(`${b}:${p.line} ${p.rule} ${p.msg}`));
      if (r.account) { if (parsed.some(a => a.slug === r.account.slug)) rejects.push(`${b}:1 SLUG the same account is picked twice`); else parsed.push(r.account); }
    });
    if (!parsed.length && !rejects.length) rejects.push("no account plans were picked");
    if (rejects.length) return { store: null, rejects, warnings, added: 0, changed: 0, same: 0, slugs: [] };
    const out = store ? { schema_version: 1, updated_at: nowIso, accounts: store.accounts.map(a => a) } : emptyStore(nowIso);
    let added = 0, changed = 0, same = 0;
    parsed.forEach(a => { const i = out.accounts.findIndex(x => x.slug === a.slug);
      a.imported_at = nowIso;
      if (i < 0) { out.accounts.push(a); added++; return; }
      const old = out.accounts[i];
      if (old.source_sha256 === a.source_sha256) { same++; return; }
      a.loopRefs = old.loopRefs; a.pendingRenames = old.pendingRenames; out.accounts[i] = a; changed++; });
    out.accounts.sort((x, y) => x.account.localeCompare(y.account));
    return { store: out, rejects, warnings, added, changed, same, slugs: parsed.map(a => a.slug) };
  }

  // ---------- Projects linking (Projects is the source of truth for tasks) ----------
  const accPlanId = slug => ("ACC-" + slug).slice(0, 64);
  const loopLabel = id => "loop:" + id, accLabel = slug => ("account:" + slug).slice(0, 40);
  function allTasks(ps) { const out = []; (ps ? ps.plans : []).forEach(p => p.tasks.forEach(t => out.push({ p, t }))); return out; }
  function ensurePlan(ps, a) {
    let p = ps.plans.find(x => x.id === accPlanId(a.slug));
    const name = ("Accounts – " + a.account).slice(0, 100);
    if (!p) { p = { id: accPlanId(a.slug), name, buckets: [], tasks: [], pinned: false }; ps.plans.push(p); }
    BUCKETS.concat([NEXT_BUCKET]).forEach((b, i) => { if (!p.buckets.some(x => x.name === b)) p.buckets.push({ id: (p.id + "-B" + (i + 1)).slice(0, 64), name: b }); });
    return p;
  }
  // A completed task's date is its due date, else the day it was completed. A loop dated later than that may be a new occurrence.
  const taskDate = t => t.due || t.completedOn || null;
  function isRecurrence(l, t) { const d = taskDate(t); return !!(l.next_date && d && l.next_date > d); }
  // Adds each open loop to plan "Accounts – <account>" unless it is already in Projects.
  // Exact matches: (1) task_id in any plan, (2) a task labeled loop:<id> in any plan (the id hashes slug + bucket + wording),
  // (3) same bucket + same normalized title in the account plan. An open exact match wins, in that order; a completed one counts
  // only when no open one exists, and then the latest-dated completed match is used.
  // Repeated loop: when that completed match is dated earlier than the loop, nothing is linked or made; the loop comes back in
  // `renames` with kind "recur" for a Same task (reopen) / New task choice. A same or earlier date links silently.
  // Reworded loop: an unmatched loop may pair only with a task whose loop left the file IN THIS IMPORT (prevRefs = the previous
  // import's {loopId: taskId} for this account) and which is NOT completed: same bucket and word overlap >= 0.5, or another bucket
  // and >= 0.8. A first import (no prevRefs) never pairs. Decision: ask first before treating a reworded loop as the same task, so
  // opts.rename "confirm" (default) applies nothing for those pairs; they come back in `renames` for a Possible rename choice.
  // "notes" (explicit switch only, no app path uses it) applies the pairs at once. A loop that leaves the file never deletes its task.
  // Returns { projStore (copy), created, linked, updated, renames:[{kind?, loopId, oldLoopId, taskId, from, to, bucket}], refs:{loopId: taskId} }.
  function syncLoops(a, projStore, nowIso, prevRefs, opts) {
    const mode = (opts && opts.rename) || "confirm";
    const ps = projStore ? JSON.parse(JSON.stringify({ schema_version: 1, updated_at: projStore.updated_at, plans: projStore.plans })) : { schema_version: 1, updated_at: nowIso, plans: [] };
    if (!a.open_loops.length) return { projStore: ps, created: 0, linked: 0, updated: 0, renames: [], refs: {} };
    const p = ensurePlan(ps, a), refs = {}, later = [], recurs = []; let created = 0, linked = 0, updated = 0;
    a.open_loops.forEach(l => {
      const all = allTasks(ps), b = p.buckets.find(x => x.name === l.bucket), hits = [];
      if (l.task_id) all.filter(x => x.t.id === l.task_id).forEach(x => hits.push(x));
      all.filter(x => x.t.labels.includes(loopLabel(l.id))).forEach(x => hits.push(x));
      p.tasks.filter(t => t.bucketId === (b && b.id) && normText(t.title) === normText(l.item)).forEach(t => hits.push({ p, t }));
      const done = hits.slice().sort((x, y) => String(taskDate(y.t) || "").localeCompare(String(taskDate(x.t) || "")));
      const hit = hits.find(x => x.t.status !== "completed") || done[0] || null;
      if (hit && hit.t.status === "completed" && isRecurrence(l, hit.t)) {
        refs[l.id] = hit.t.id;   // keeps the loop "present" for the reworded-loop rule; nothing is linked until the choice
        recurs.push({ kind: "recur", loopId: l.id, oldLoopId: l.id, taskId: hit.t.id, from: hit.t.title, to: l.item.slice(0, 255) || hit.t.title, bucket: l.bucket, taskDate: taskDate(hit.t), loopDate: l.next_date });
        return; }
      if (hit) { refs[l.id] = hit.t.id; linked++; if (!hit.t.labels.includes(loopLabel(l.id)) && hit.t.labels.length < 20) hit.t.labels.push(loopLabel(l.id)); return; }
      later.push(l); });
    const liveIds = new Set(a.open_loops.map(l => l.id)), taken = new Set(Object.values(refs)), prev = prevRefs && typeof prevRefs === "object" ? prevRefs : {};
    const justLeft = new Set(Object.keys(prev).filter(id => !liveIds.has(id)).map(id => prev[id]));   // tasks whose loop left in THIS import
    const orphans = allTasks(ps).filter(x => justLeft.has(x.t.id) && !taken.has(x.t.id) && x.t.status !== "completed");
    const pairs = [];
    later.forEach(l => { const bk = p.buckets.find(x => x.name === l.bucket);
      orphans.forEach(o => { const s = similarity(o.t.title, l.item), same = o.t.bucketId === (bk && bk.id); if (s >= (same ? 0.5 : 0.8)) pairs.push({ l, o, s: s + (same ? 0.01 : 0) }); }); });
    pairs.sort((x, y) => y.s - x.s); const usedL = new Set(), usedO = new Set(), renames = [];
    pairs.forEach(({ l, o }) => { if (usedL.has(l.id) || usedO.has(o.t.id)) return; usedL.add(l.id); usedO.add(o.t.id);
      renames.push({ loopId: l.id, oldLoopId: Object.keys(prev).find(k => prev[k] === o.t.id) || null, taskId: o.t.id, from: o.t.title, to: l.item.slice(0, 255) || o.t.title, bucket: l.bucket }); });
    if (mode === "notes") { applyRenames(ps, p, renames); renames.forEach(r => { refs[r.loopId] = r.taskId; }); updated = renames.length; }
    const pending = new Set(mode === "notes" ? [] : renames.map(r => r.loopId));
    later.filter(l => !(mode === "notes" && usedL.has(l.id)) && !pending.has(l.id)).forEach(l => { refs[l.id] = loopTask(p, a, l).id; created++; });
    ps.updated_at = nowIso;
    return { projStore: ps, created, linked, updated, renames: (mode === "notes" ? [] : renames).concat(recurs), refs };
  }
  function loopTask(p, a, l) {
    const b = p.buckets.find(x => x.name === l.bucket); let id = ("AL-" + l.id).slice(0, 64);
    if (p.tasks.some(t => t.id === id)) id = ("AL-" + hashId(l.id + "|" + (l.next_date || "") + "|" + p.tasks.length)).slice(0, 64);   // a repeat gets its own id
    const t = { id, title: l.item.slice(0, 255) || "Open loop", bucketId: b.id, assignees: [], status: "notStarted", percent: 0, start: null, due: l.next_date,
      priority: "medium", labels: [accLabel(a.slug), loopLabel(l.id)], notes: "Open loop from the account plan (" + a.slug + ").", account: a.account, checklist: [], completedOn: null };
    p.tasks.push(t); return t;
  }
  // The choice on one prompt. Possible rename: "same" = the old task takes the new title, bucket and loop label ("Previously: ..." in
  // notes); "new" = a new task, the old one untouched. Repeated loop (kind "recur"): "same" = the completed task is reopened with the
  // loop's date; "new" = a new task with its own id, the completed one untouched. Returns { projStore (copy), taskId }.
  function resolveRename(a, projStore, r, choice, nowIso) {
    const ps = JSON.parse(JSON.stringify(projStore)), p = ensurePlan(ps, a), l = a.open_loops.find(x => x.id === r.loopId);
    if (!l) throw new Error("that loop is no longer in the account plan");
    if (choice !== "same" && choice !== "new") throw new Error("choice must be same or new");
    if (r.kind === "recur") { const h = allTasks(ps).find(x => x.t.id === r.taskId); if (!h) throw new Error("the completed task is gone");
      if (choice === "same") { const t = h.t; t.status = "notStarted"; t.percent = 0; t.completedOn = null; if (l.next_date) t.due = l.next_date;
        t.notes = ((t.notes ? t.notes + "\n" : "") + "Reopened on import: the loop came back dated " + l.next_date + ".").slice(-2000);
        if (!t.labels.includes(loopLabel(l.id)) && t.labels.length < 20) t.labels.push(loopLabel(l.id)); ps.updated_at = nowIso; return { projStore: ps, taskId: t.id }; }
      const t = loopTask(p, a, l); ps.updated_at = nowIso; return { projStore: ps, taskId: t.id }; }
    if (choice === "same") { const h = allTasks(ps).find(x => x.t.id === r.taskId); if (!h || h.t.status === "completed") throw new Error("the old task is gone or completed");
      applyRenames(ps, p, [r]); ps.updated_at = nowIso; return { projStore: ps, taskId: r.taskId }; }
    const t = loopTask(p, a, l); ps.updated_at = nowIso; return { projStore: ps, taskId: t.id };
  }
  // Applies confirmed renames: new title, bucket and loop label; the old title is kept in notes ("Previously: …"), never lost.
  function applyRenames(ps, p, renames) {
    renames.forEach(r => { const h = allTasks(ps).find(x => x.t.id === r.taskId); if (!h) return; const t = h.t;
      if (t.title !== r.to) t.notes = ((t.notes ? t.notes + "\n" : "") + "Previously: " + t.title).slice(-2000);
      t.title = r.to; if (h.p.id === p.id) { const b = p.buckets.find(x => x.name === r.bucket); if (b) t.bucketId = b.id; }
      t.labels = t.labels.filter(lb => !lb.startsWith("loop:")).concat([loopLabel(r.loopId)]).slice(0, 20); });
    return ps;
  }
  function similarity(a, b) { const A1 = new Set(normText(a).split(" ").filter(w => w.length > 1)), B1 = new Set(normText(b).split(" ").filter(w => w.length > 1));
    if (!A1.size || !B1.size) return 0; let n = 0; A1.forEach(w => { if (B1.has(w)) n++; }); return n / (A1.size + B1.size - n); }
  // N1: prompts still waiting for a choice (Possible rename and Repeated loop) across all accounts.
  function pendingPrompts(store) { return (store ? store.accounts : []).reduce((n, a) => n + ((a.pendingRenames || []).length), 0); }
  // next_move: linked by task_id, else by a task in the account plan (or labeled for this account) with the same action text.
  function findNextMove(a, projStore) {
    if (!a.next_move) return null; const all = allTasks(projStore);
    if (a.next_move.task_id) { const h = all.find(x => x.t.id === a.next_move.task_id); return h ? { taskId: h.t.id, by: "task_id", t: h.t } : { taskId: null, missing: a.next_move.task_id }; }
    const n = normText(a.next_move.action), h = all.find(x => (x.p.id === accPlanId(a.slug) || x.t.labels.includes(accLabel(a.slug))) && normText(x.t.title) === n);
    return h ? { taskId: h.t.id, by: "title", t: h.t } : null;
  }
  function nextMoveTask(a) { return { id: ("AN-" + hashId(a.slug + "|" + normText(a.next_move.action))).slice(0, 64), title: a.next_move.action.slice(0, 255), assignees: a.next_move.owner ? [a.next_move.owner.slice(0, 80)] : [],
    status: "notStarted", percent: 0, start: null, due: a.next_move.due, priority: "important", labels: [accLabel(a.slug), "next-move"], notes: "Next strategic move from the account plan (" + a.slug + ").", account: a.account, checklist: [], completedOn: null }; }
  function createNextMove(a, projStore, nowIso) {
    const f = findNextMove(a, projStore); if (!a.next_move || (f && (f.taskId || f.missing))) return { projStore, created: false };
    const ps = JSON.parse(JSON.stringify(projStore || { schema_version: 1, updated_at: nowIso, plans: [] })), p = ensurePlan(ps, a), t = nextMoveTask(a);
    t.bucketId = p.buckets.find(x => x.name === NEXT_BUCKET).id; p.tasks.push(t); ps.updated_at = nowIso; return { projStore: ps, created: true, taskId: t.id };
  }

  // ---------- cadence and touches ----------
  function touchStatus(a, today) {
    const cad = CAD_DAYS[a.touch_cadence];
    const byCad = a.last_touch && cad && isDay(a.last_touch.date) ? R.addDays(a.last_touch.date, cad) : null;
    const due = [a.next_touch && a.next_touch.date, byCad].filter(isDay).sort()[0] || null;
    return { due, byCadence: byCad, overdue: !!(due && due < today), today: due === today, days: due ? R.diffDays(today, due) : null };
  }
  // Daily Focus rows: accounts with a touch due today or overdue, or a next move past due (read-only; Projects owns task status).
  function focusTouches(store, today, projStore) {
    const rows = [];
    (store ? store.accounts : []).forEach(a => {
      const ts = touchStatus(a, today);
      if (ts.due && ts.due <= today) rows.push({ slug: a.slug, account: a.account, tier: a.tier, what: "Account touch · " + ((a.next_touch && a.next_touch.type) || "touch"), due: ts.due, days: ts.days });
      const nm = a.next_move, link = findNextMove(a, projStore);
      const nmDue = link && link.t ? link.t.due : nm && nm.due, nmDone = !!(link && link.t && link.t.status === "completed");
      if (nm && nmDue && nmDue < today && !nmDone) rows.push({ slug: a.slug, account: a.account, tier: a.tier, what: "Next strategic move", due: nmDue, days: R.diffDays(today, nmDue) });
    });
    return rows.sort((x, y) => x.due.localeCompare(y.due) || TIER_ORDER[x.tier] - TIER_ORDER[y.tier] || x.account.localeCompare(y.account));
  }
  // Account list order: anything overdue first, then tier, then name.
  function listOrder(store, today, projStore) {
    return (store ? store.accounts : []).map(a => { const ts = touchStatus(a, today), l = findNextMove(a, projStore), nd = l && l.t ? l.t.due : a.next_move && a.next_move.due;
      return { a, ts, moveOver: !!(nd && nd < today && !(l && l.t && l.t.status === "completed")) }; })
      .sort((x, y) => (+(y.moveOver || y.ts.overdue) - +(x.moveOver || x.ts.overdue)) || TIER_ORDER[x.a.tier] - TIER_ORDER[y.a.tier] || x.a.account.localeCompare(y.a.account));
  }

  // ---------- contacts (contacts-merged CSV); email and phone are kept encrypted and never printed ----------
  const CONTACT_COLS = ["first_name", "last_name", "email", "company", "title", "phone", "source", "last_seen", "last_touch"];
  function parseContactsCSV(text, nowIso) {
    if (typeof text !== "string" || text.length > 5000000) throw new Error("the contacts file is too large");
    const rows = R.parseCSV(text.replace(/^\uFEFF/, "")); if (!rows.length) throw new Error("the contacts file is empty");
    const head = rows[0].map(h => h.trim().toLowerCase());
    if (CONTACT_COLS.some(c => !head.includes(c))) throw new Error("the header must have " + CONTACT_COLS.join(", "));
    const ix = {}; CONTACT_COLS.forEach(c => ix[c] = head.indexOf(c));
    const out = [], rejects = [], seen = new Set();
    rows.slice(1).forEach((r, i) => { const v = c => cleanStr(r[ix[c]] == null ? "" : r[ix[c]]);
      const c = { first: v("first_name"), last: v("last_name"), email: v("email").toLowerCase(), company: v("company"), title: v("title"), phone: v("phone"), source: v("source"), last_seen: v("last_seen"), last_touch: v("last_touch") };
      if (!c.first && !c.last) return;
      if ([c.first, c.last, c.company, c.title, c.source].some(R.hasMoney)) { rejects.push(`row ${i + 2}: no pricing or dollar figures`); return; }
      if (c.last_seen && !isDay(c.last_seen)) c.last_seen = ""; if (c.last_touch && !isDay(c.last_touch)) c.last_touch = "";
      c.key = hashId([fold(c.first), fold(c.last), c.email, fold(c.company)].join("|")); if (seen.has(c.key)) return; seen.add(c.key);
      c.name = (c.first + " " + c.last).trim(); out.push(c); });
    return { schema_version: 1, updated_at: nowIso, contacts: out, rejects };
  }
  function readContacts(raw) {
    if (!raw || typeof raw !== "object" || raw.schema_version !== 1 || !Array.isArray(raw.contacts)) throw new Error("contacts: schema_version must be 1");
    return { schema_version: 1, updated_at: raw.updated_at, contacts: raw.contacts.filter(c => c && typeof c.key === "string"), example: !!raw.example };
  }
  // Matches each name in a stakeholder cell ("A / B" = two people) on first + last name (case and accents folded); more than one hit is
  // narrowed by company ≈ org; still ambiguous = no link.
  function matchContacts(st, contacts) {
    const list = contacts ? contacts.contacts || contacts : [];
    return String(st.name || "").split(/\s*\/\s*/).filter(Boolean).map(n => {
      const parts = n.trim().split(/\s+/), f = fold(parts[0]), l = fold(parts.slice(1).join(" "));
      let hits = list.filter(c => fold(c.first) === f && fold(c.last) === l && f);
      if (hits.length > 1) { const o = fold(st["org"]); const nar = hits.filter(c => o && fold(c.company) && (fold(c.company).includes(o) || o.includes(fold(c.company)))); if (nar.length) hits = nar; }
      return { name: n, contact: hits.length === 1 ? hits[0] : null, candidates: hits.length }; });
  }

  g.DASH.accounts = { HEADS, SECTION_TITLES, REQ, TIERS, STATUSES, CADENCES, BUCKETS, NEXT_BUCKET, INFLUENCE, SENTIMENT, STAGES, CAD_DAYS, CONTACT_COLS,
    parseFront, parseAccountMd, readAccStore, importAccounts, emptyStore, syncLoops, resolveRename, applyRenames, similarity, pendingPrompts, taskDate, isRecurrence,
    findNextMove, createNextMove, nextMoveTask, accPlanId, loopLabel, accLabel, loopId, touchStatus, focusTouches, listOrder, parseContactsCSV, readContacts, matchContacts, normText, hashId };
})(typeof window !== "undefined" ? window : globalThis);
