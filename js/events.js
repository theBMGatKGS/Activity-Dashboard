/* Activity Dashboard 00.10.000: Tradeshows & Events.  Pure functions, no DOM, no network.
   Outlook's "Tradeshows & Events" calendar (snapshot events[]) is the source of truth for dates, times and location;
   the notebook's events table (events.md) holds the details.  Both are kept only encrypted (snapshot, events-store.json.enc).
   Also: the SAM bullets link (month choice and notebook paths) and the per-computer Links settings. */
(function (g) {
  "use strict";
  const R = g.DASH.rules, A = g.DASH.accounts;
  const COLS = ["event", "start date", "end date", "location", "series/organizer", "status", "role", "target accounts", "registration deadline", "room-block deadline", "travel", "trip ref", "follow-ups", "source note"];
  const STATUSES = ["considering", "registered", "attending", "speaking", "exhibiting", "skipped", "on hold"];
  const CONFIRMED = ["registered", "attending", "speaking", "exhibiting"];
  const SHOW_AS = ["busy", "free", "tentative", "oof"];
  const MAX_FILE = 400000, MAX_STR = 600;
  const DAY = /^\d{4}-\d{2}-\d{2}$/, ISO_OFF = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/;
  const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
  const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
  const isDay = s => typeof s === "string" && DAY.test(s) && R.realDay(s);
  const clean = s => String(s == null ? "" : s).replace(CTRL, "").replace(/\s+/g, " ").trim().slice(0, MAX_STR);

  // ---------- titles ----------
  const normTitle = s => String(s || "").normalize("NFKC").replace(/\s*\[unverified title\]\s*/ig, " ").replace(/\s*\[truncated\]\s*$/i, " ").toLowerCase().replace(/\s+/g, " ").trim();
  const keyOf = (title, start) => normTitle(title) + "|" + (start || "?");

  // ---------- trip refs (Travel: trips[].id, TRIP-<YYYYMMDD>-<SLUG>; never a confirmation number) ----------
  const TRIP_RE = /^TRIP-(\d{4})(\d{2})(\d{2})-[A-Z0-9][A-Z0-9-]{0,39}$/;
  function tripRefProblem(v) {
    const s = clean(v); if (!s || s === "?") return null;
    const m = s.match(TRIP_RE);
    if (m) return R.realDay(`${m[1]}-${m[2]}-${m[3]}`) ? null : "trip ref has a date that does not exist";
    if (/^[A-Za-z0-9]{5,8}$/.test(s) && /\d/.test(s) || /^[A-Za-z]{6}$/.test(s) || /^\d{9,}$/.test(s.replace(/[\s-]/g, ""))) return "looks like a confirmation number; use the trip id (TRIP-YYYYMMDD-SLUG)";
    return "trip ref must be TRIP-YYYYMMDD-SLUG (capitals), ? or blank";
  }

  // ---------- table cells ----------
  function splitRow(line) {   // split a Markdown table row on | outside [[...]] and not escaped
    let s = line.trim(); if (s.startsWith("|")) s = s.slice(1); if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
    const out = []; let cur = "", depth = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
      if (c === "[" && s[i + 1] === "[") { depth++; cur += "[["; i++; continue; }
      if (c === "]" && s[i + 1] === "]" && depth) { depth--; cur += "]]"; i++; continue; }
      if (c === "|" && !depth) { out.push(cur.trim()); cur = ""; continue; }
      cur += c;
    }
    out.push(cur.trim()); return out;
  }
  const notePath = p => clean(p).replace(/\\/g, "/").replace(/^(?:\.\.?\/)+/, "").replace(/\.md$/i, "");
  function links(s) {   // wikilinks [[path|alias]] and Markdown links [text](path.md)
    const out = []; let rest = String(s);
    rest = rest.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (m, p, al) => { out.push({ path: notePath(p), label: clean(al || "") }); return " "; });
    rest = rest.replace(/\[([^\]]*)\]\(([^)\s]+\.md)\)/gi, (m, t, p) => { out.push({ path: notePath(decodeURI(p)), label: clean(t) }); return " "; });
    return { links: out, text: clean(rest.replace(/^[\s,;]+|[\s,;]+$/g, "").replace(/(\s*,\s*)+/g, ", ").replace(/^,\s*|,\s*$/g, "")) };
  }
  function cellOf(raw, foot) {   // strip footnote refs (kept as notes) and [unverified] / [unverified title] flags
    let s = String(raw), unverified = false, unverifiedTitle = false; const notes = [];
    s = s.replace(/\[\^([\w-]+)\]/g, (m, n) => { if (foot[n]) notes.push(n); return " "; });
    if (/\[unverified title\]/i.test(s)) { unverifiedTitle = true; s = s.replace(/\s*\[unverified title\]\s*/ig, " "); }
    if (/\[unverified\]/i.test(s)) { unverified = true; s = s.replace(/\s*\[unverified\]\s*/ig, " "); }
    return { v: clean(s), unverified: unverified || unverifiedTitle, unverifiedTitle, notes };
  }
  const slugOf = path => path.split("/").pop().toLowerCase();
  const accountPath = p => /^accounts\//i.test(p);

  // ---------- events.md parser (all or nothing, like account plans) ----------
  function parseEventsMd(name, text) {
    const problems = [], warnings = [], P = (line, rule, msg) => problems.push({ line, rule, msg });
    if (typeof text !== "string" || text.length > MAX_FILE) { P(1, "FILE", "not a text file or too large"); return { problems, warnings, rows: [] }; }
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    lines.forEach((l, i) => { if (R.hasMoney(l)) P(i + 1, "PRICE", "no dollar figures or pricing"); if (R.hasEmail(l)) P(i + 1, "EMAIL", "no email addresses"); if (PHONE_RE.test(l.normalize("NFKC"))) P(i + 1, "PHONE", "no phone numbers"); });
    if (lines[0] !== "---") { P(1, "FM-MISSING", "the file must start with --- front matter"); return { problems, warnings, rows: [] }; }
    const end = lines.indexOf("---", 1);
    if (end < 0) { P(1, "FM-MISSING", "front matter is not closed with ---"); return { problems, warnings, rows: [] }; }
    let fm; try { fm = A.parseFront(lines.slice(1, end), 2).data; } catch (e) { P(e.line || 1, "FM-YAML", e.message); return { problems, warnings, rows: [] }; }
    if (String(fm.type || "").toLowerCase() !== "data") P(2, "FM-TYPE", "front matter must say type: data");
    const foot = {};
    lines.forEach(l => { const m = l.match(/^\[\^([\w-]+)\]:\s*(.*)$/); if (m) foot[m[1]] = clean(m[2]); });
    const rows = []; let heading = "", tables = 0;
    for (let i = end + 1; i < lines.length; i++) {
      const l = lines[i];
      const h = l.match(/^#{1,6}\s+(.*)$/); if (h) { heading = clean(h[1]); continue; }
      if (!/^\s*\|/.test(l)) continue;
      const head = splitRow(l).map(c => c.toLowerCase());
      if (head[0] !== "event") { P(i + 1, "COL", "a table in events.md must start with the event column"); while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) i++; continue; }
      const idx = {}; COLS.forEach(c => { idx[c] = head.indexOf(c); });
      const missing = COLS.filter(c => idx[c] < 0);
      if (missing.length) { P(i + 1, "COL", `missing or renamed column(s): ${missing.join(", ")}`); while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) i++; continue; }
      head.forEach(c => { if (!COLS.includes(c)) warnings.push(`${name}:${i + 1} extra column "${c}" (ignored)`); });
      tables++;
      if (!/^\s*\|?\s*:?-{3,}/.test(lines[i + 1] || "")) { P(i + 2, "COL", "the header row must be followed by a |---| row"); continue; }
      i += 1;
      while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) {
        i++; const ln = i + 1, cells = splitRow(lines[i]);
        if (cells.length !== head.length) { P(ln, "ROW", `expected ${head.length} cells, found ${cells.length}`); continue; }
        const c = k => cellOf(cells[idx[k]], foot), unv = {}, notes = new Set();
        const get = k => { const x = c(k); if (x.unverified) unv[k] = true; x.notes.forEach(n => notes.add(n)); return x; };
        const ev = get("event");
        if (!ev.v || ev.v === "?") { P(ln, "TITLE", "the event column is blank"); continue; }
        const date = k => { const x = get(k).v; if (x === "?" || x === "") return "?"; if (!isDay(x)) { P(ln, "DATE", `${k} must be a real date YYYY-MM-DD or ?`); return "?"; } return x; };
        const sd = date("start date"); let ed = date("end date");
        if (sd !== "?" && ed === "?") ed = sd;
        if (sd !== "?" && ed !== "?" && ed < sd) P(ln, "DATE", "end date is before start date");
        const st = get("status").v.toLowerCase();
        if (st !== "?" && !STATUSES.includes(st)) P(ln, "STATUS", `status must be one of ${STATUSES.join(", ")} or ?`);
        const dl = k => { const x = get(k).v; if (!x || x === "?") return x || ""; if (!isDay(x)) { P(ln, "DATE", `${k} must be a date YYYY-MM-DD, ? or blank`); return ""; } return x; };
        const tr = get("travel").v; let travel = { state: "", flight: false, hotel: false, car: false, note: "" };
        if (tr) { const m = tr.match(/^(none|planned|booked|\?)((?:\s+[FHC](?![\w]))*)\s*(.*)$/i);
          if (!m) P(ln, "TRAVEL", "travel must be none, planned, booked or ?, plus F H C flags");
          else { const f = m[2].toUpperCase(); travel = { state: m[1].toLowerCase(), flight: /F/.test(f), hotel: /H/.test(f), car: /C/.test(f), note: clean(m[3]) }; } }
        const trip = get("trip ref").v, tp = tripRefProblem(trip); if (tp) P(ln, "TRIP", tp);
        const acc = links(get("target accounts").v), fu = links(get("follow-ups").v), src = links(get("source note").v);
        const rec = { key: keyOf(ev.v, sd), event: ev.v, unverified_title: ev.unverifiedTitle, start_date: sd, end_date: ed, location: get("location").v || "?", series: get("series/organizer").v,
          status: st || "?", role: get("role").v, accounts: acc.links.filter(x => accountPath(x.path)).map(x => slugOf(x.path)), accounts_text: acc.text,
          reg_deadline: dl("registration deadline"), room_deadline: dl("room-block deadline"), travel, trip_ref: trip === "?" ? "?" : trip,
          follow_ups: fu.links.map(x => x.path), follow_ups_text: fu.text, source_note: src.links.map(x => x.path), source_text: src.text,
          section: heading, line: ln, unverified: unv, notes: [] };
        rec.notes = [...notes].map(n => foot[n]).filter(Boolean);
        if (rows.some(r => r.key === rec.key)) { P(ln, "DUP", "the same event and start date is listed twice"); continue; }
        rows.push(rec);
      }
    }
    if (!tables && !problems.length) P(1, "COL", "no events table with the 14 columns was found");
    return { problems, warnings, rows };
  }
  function emptyStore(nowIso) { return { schema_version: 1, updated_at: nowIso, events: [], answers: {}, source_sha256: "" }; }
  function readEventsStore(raw) {
    if (!raw || typeof raw !== "object" || raw.schema_version !== 1) throw new Error("events-store: schema_version must be 1");
    if (typeof raw.updated_at !== "string" || isNaN(Date.parse(raw.updated_at))) throw new Error("events-store: updated_at must be a date-time");
    if (!Array.isArray(raw.events)) throw new Error("events-store: events must be a list");
    const events = raw.events.filter(e => e && typeof e.key === "string" && typeof e.event === "string" && typeof e.start_date === "string" && typeof e.end_date === "string" && Array.isArray(e.accounts));
    const answers = {}; if (raw.answers && typeof raw.answers === "object") Object.keys(raw.answers).forEach(k => { const a = raw.answers[k]; if (!["__proto__", "constructor", "prototype"].includes(k) && a && typeof a.row === "string" && ["link", "no"].includes(a.choice)) answers[k] = { row: a.row, choice: a.choice }; });
    return { schema_version: 1, updated_at: raw.updated_at, events, answers, source_sha256: typeof raw.source_sha256 === "string" ? raw.source_sha256 : "", example: !!raw.example };
  }
  function importEvents(files, store, nowIso) {
    const rejects = [], warnings = [];
    const md = (files || []).filter(([n]) => /\.md$/i.test(String(n)));
    (files || []).filter(([n]) => !/\.md$/i.test(String(n))).forEach(([n]) => rejects.push(`${String(n).replace(/^.*[\\/]/, "")}:1 FILE only events.md is imported`));
    if (md.length !== 1) rejects.push(md.length ? "pick only one events.md" : "no events.md was picked");
    if (rejects.length) return { store: null, rejects, warnings };
    const [name, text] = md[0], b = String(name).replace(/^.*[\\/]/, "");
    const r = parseEventsMd(b, text); warnings.push(...r.warnings);
    r.problems.forEach(p => rejects.push(`${b}:${p.line} ${p.rule} ${p.msg}`));
    if (rejects.length) return { store: null, rejects, warnings };
    const out = { schema_version: 1, updated_at: nowIso, events: r.rows, answers: Object.assign({}, store && store.answers), source_sha256: A.hashId(text) };
    return { store: out, rejects, warnings, same: !!(store && store.source_sha256 === out.source_sha256), count: r.rows.length };
  }

  // ---------- snapshot events[] (Outlook calendar) ----------
  function readSnapEvents(list, rejects) {
    const out = [], seen = new Set();
    (Array.isArray(list) ? list : []).forEach((e, i) => {
      const bad = m => rejects.push(`event ${i + 1}: ${m}`);
      if (!e || typeof e !== "object") return bad("not an object");
      const title = clean(e.title); if (!title) return bad("title is required");
      if (!isDay(e.start_date) || !isDay(e.end_date) || e.end_date < e.start_date) return bad("start_date/end_date must be real dates, end not before start");
      if (typeof e.all_day !== "boolean") return bad("all_day must be true or false");
      if (!e.all_day && (!ISO_OFF.test(e.start || "") || !ISO_OFF.test(e.end || "") || !(Date.parse(e.end) > Date.parse(e.start)))) return bad("timed events need start/end with offset, end after start");
      if (e.show_as != null && !SHOW_AS.includes(e.show_as)) return bad(`show_as must be one of ${SHOW_AS.join(", ")} or null`);
      if (e.zone != null && (typeof e.zone !== "string" || !/^[A-Za-z_]+\/[A-Za-z_\/+-]+$/.test(e.zone))) return bad("zone must be an IANA zone");
      const id = typeof e.id === "string" && /^[\w-]{1,64}$/.test(e.id) ? e.id : A.hashId(normTitle(title) + "|" + e.start_date).slice(0, 12);
      if (seen.has(id)) return bad("duplicate id"); seen.add(id);
      out.push({ id, title: title.slice(0, 200), title_truncated: e.title_truncated === true, start_date: e.start_date, end_date: e.end_date, all_day: e.all_day,
        start: e.all_day ? null : e.start, end: e.all_day ? null : e.end, zone: e.zone || null, location: e.location ? clean(e.location).slice(0, 200) : null,
        category: e.category ? clean(e.category).slice(0, 60) : null, show_as: e.show_as || null });
    });
    return out;
  }

  // ---------- matching Outlook to events.md ----------
  function match(outlook, rows, answers) {
    const ol = (outlook || []).slice(), rs = (rows || []).slice(), used = new Set(), out = [], ans = answers || {};
    const byTitle = {}; ol.forEach(o => { if (!o.title_truncated) (byTitle[normTitle(o.title)] = byTitle[normTitle(o.title)] || []).push(o); });
    ol.forEach(o => {
      const nt = normTitle(o.title);
      if (o.title_truncated) {
        const a = ans[o.id], linked = a && a.choice === "link" && rs.find(r => r.key === a.row && !used.has(r.key));
        if (linked) { used.add(linked.key); out.push({ kind: "both", o, d: linked, datesDiffer: false, linkedByAnswer: true }); return; }
        const cands = rs.filter(r => !used.has(r.key) && r.start_date === o.start_date && normTitle(r.event).startsWith(nt));
        const declined = a && a.choice === "no" && cands.length === 1 && a.row === cands[0].key;
        out.push({ kind: "outlook", o, d: null, possible: cands.length === 1 && !declined ? cands[0].key : null, declined: !!declined }); return;
      }
      let d = rs.find(r => !used.has(r.key) && r.key === keyOf(o.title, o.start_date)), differ = false;
      if (!d && (byTitle[nt] || []).length === 1) { const same = rs.filter(r => !used.has(r.key) && normTitle(r.event) === nt); if (same.length === 1) { d = same[0]; differ = d.start_date !== "?" && (d.start_date !== o.start_date || (d.end_date !== "?" && d.end_date !== o.end_date)); } }
      if (d) { used.add(d.key); out.push({ kind: "both", o, d, datesDiffer: differ }); } else out.push({ kind: "outlook", o, d: null });
    });
    rs.filter(r => !used.has(r.key)).forEach(d => out.push({ kind: "details", o: null, d }));
    out.forEach(x => { x.id = x.o ? "o:" + x.o.id : "d:" + x.d.key; x.title = x.o ? x.o.title : x.d.event;
      x.start_date = x.o ? x.o.start_date : x.d.start_date; x.end_date = x.o ? x.o.end_date : x.d.end_date;
      x.location = x.o && x.o.location ? x.o.location : x.d ? x.d.location : "?"; x.status = x.d ? x.d.status : "?"; });
    return out;
  }

  // ---------- flags (dates in the dashboard zone) ----------
  const cityOf = s => String(s || "").split(",")[0].normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  function tripData(trips) { return !!(trips && trips.trips && trips.trips.some(t => t.start && t.end && t.cities && t.cities.length)); }
  function flags(x, today, trips) {
    const f = [], d = x.d, start = x.start_date, end = x.end_date, dated = start && start !== "?";
    const days = dated ? R.diffDays(start, today) : null, live = dated && end >= today;
    const conf = d && CONFIRMED.includes(d.status);
    if (d && d.status === "on hold") f.push({ id: "hold", level: "grey", text: "On hold" });
    if (conf && live && days <= 30 && d.travel.state && d.travel.state !== "none") {
      const booked = d.travel.state === "booked";
      if (!(booked && d.travel.flight && d.travel.hotel)) f.push({ id: "travel", level: days <= 14 ? "red" : "amber", text: `Travel not booked (${!(booked && d.travel.flight) ? "flight" : ""}${!(booked && d.travel.flight) && !(booked && d.travel.hotel) ? ", " : ""}${!(booked && d.travel.hotel) ? "hotel" : ""})` });
    }
    const within7 = s => isDay(s) && R.diffDays(s, today) >= 0 && R.diffDays(s, today) <= 7;
    if (d && within7(d.reg_deadline) && ["considering", "registered"].includes(d.status)) f.push({ id: "reg", level: "red", text: `Registration deadline ${R.dayLabel(d.reg_deadline)}` });
    if (d && within7(d.room_deadline) && !(d.travel.state === "booked" && d.travel.hotel)) f.push({ id: "room", level: "red", text: `Room-block deadline ${R.dayLabel(d.room_deadline)}` });
    if (live && dated && tripData(trips)) {
      const city = cityOf(x.location);
      if (city && city !== "?") trips.trips.forEach(t => { if (!(t.start && t.end && t.cities && t.cities.length)) return;
        if (t.start <= end && t.end >= start && !t.cities.some(c => cityOf(c) === city)) f.push({ id: "overlap", level: "red", text: `Trip overlap: ${t.id}` }); });
    }
    if (conf && live && days <= 30 && [x.location, d.role, d.travel.state || "?", start, end].some(v => v === "?")) f.push({ id: "unknown", level: "amber", text: "Details missing" });
    if (x.datesDiffer) f.push({ id: "differ", level: "amber", text: `Dates differ: notebook ${d.start_date}${d.end_date !== d.start_date ? "–" + d.end_date : ""}` });
    if (x.o && x.o.title_truncated && x.kind !== "both") f.push({ id: "trunc", level: "amber", text: "Title cut off in Outlook" });
    if (d && Object.keys(d.unverified).length) f.push({ id: "unv", level: "unv", text: "Unverified details" });
    return f;
  }
  const red = fl => fl.some(z => z.level === "red");
  const SECTIONS = [["action", "Needs action"], ["upcoming", "Upcoming"], ["undated", "Undated"], ["hold", "On hold"], ["details", "Details only, not on the Outlook calendar"], ["past", "Past"]];
  function model(outlook, store, today, trips) {
    const list = match(outlook, store ? store.events : [], store ? store.answers : {});
    list.forEach(x => { x.flags = flags(x, today, trips); x.red = red(x.flags);
      const dated = x.start_date && x.start_date !== "?";
      x.section = dated && x.end_date !== "?" && x.end_date < today ? "past" : x.status === "on hold" ? "hold" : x.red ? "action" : !dated ? "undated" : x.kind === "details" ? "details" : "upcoming"; });
    const order = (a, b) => (a.start_date === "?" ? "9" : a.start_date).localeCompare(b.start_date === "?" ? "9" : b.start_date) || a.title.localeCompare(b.title);
    const sections = SECTIONS.map(([id, title]) => ({ id, title, rows: list.filter(x => x.section === id).sort(id === "past" ? (a, b) => -order(a, b) : order) }));
    return { list, sections, redCount: list.filter(x => x.red && x.section !== "past").length, tripData: tripData(trips), prompts: list.filter(x => x.possible) };
  }
  function strip(list, today, days) {   // 120-day month strip: one cell per day, dots for events
    const n = days || 120, cells = [];
    for (let i = 0; i < n; i++) { const day = R.addDays(today, i);
      const evs = list.filter(x => x.section !== "past" && x.start_date !== "?" && x.start_date <= day && (x.end_date === "?" ? x.start_date : x.end_date) >= day);
      cells.push({ day, n: evs.length, red: evs.some(x => x.red), first: i === 0 || day.slice(8) === "01", titles: evs.map(x => x.title) }); }
    return cells;
  }
  function forAccount(slug, list, today) {
    const hits = (list || []).filter(x => x.d && x.d.accounts.includes(slug));
    return { upcoming: hits.filter(x => x.section !== "past"), met: hits.filter(x => x.section === "past") };
  }
  function answer(store, outlookId, rowKey, choice) {
    const out = Object.assign({}, store, { answers: Object.assign({}, store.answers) });
    out.answers[outlookId] = { row: rowKey, choice: choice === "link" ? "link" : "no" }; return out;
  }

  // ---------- SAM bullets link and per-computer Links ----------
  function samMonth(today) {   // last month until the 19th; from the 20th, this month to date
    const [y, m, d] = today.split("-").map(Number);
    if (d >= 20) return { month: `${y}-${String(m).padStart(2, "0")}`, toDate: true };
    const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
    return { month: `${py}-${String(pm).padStart(2, "0")}`, toDate: false };
  }
  const DEFAULT_SOURCES = "crm/outbox/sam-report/{month}/sources.md";
  function linksProblem(l) {
    if (!l || typeof l !== "object") return "no links set";
    if (l.vault != null && l.vault !== "" && (typeof l.vault !== "string" || l.vault.length > 100 || /[\u0000-\u001F\u007F]/.test(l.vault) || /[\/\\]/.test(l.vault))) return "vault name: up to 100 characters, no slashes";
    if (l.repo && !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(l.repo)) return "repo address must look like https://github.com/owner/repo";
    if (l.branch && !/^[A-Za-z0-9._\/-]{1,100}$/.test(l.branch)) return "branch: letters, digits, . _ / - only";
    if (l.sources && (!/^[A-Za-z0-9 ._\/{}-]{1,200}$/.test(l.sources) || /\.\./.test(l.sources) || !/\.md$/.test(l.sources))) return "sources path must be a notebook path ending in .md";
    return null;
  }
  function notebookUrls(l, path) {
    const p = String(path).replace(/^\/+/, ""), out = {};
    if (l && l.vault) out.obsidian = `obsidian://open?vault=${encodeURIComponent(l.vault)}&file=${encodeURIComponent(p.replace(/\.md$/, ""))}`;
    if (l && l.repo) out.github = `${l.repo}/blob/${(l.branch || "main").split("/").map(encodeURIComponent).join("/")}/${p.split("/").map(encodeURIComponent).join("/")}`;
    return out;
  }
  function samLinks(l, today) {
    const s = samMonth(today), final = `reports/sam-activity/${s.month}.md`, sources = String((l && l.sources) || DEFAULT_SOURCES).replace(/\{month\}/g, s.month);
    return Object.assign(s, { final: { path: final, urls: notebookUrls(l, final) }, sources: { path: sources, urls: notebookUrls(l, sources) } });
  }


  // ---------- 00.10.000 rev 3: Calendar tab summary (at a glance; Events stays the detail list) ----------
  function summary(m, today, months) {
    const live = m.list.filter(x => x.section !== "past");
    const counts = { red: m.redCount, amber: live.filter(x => !x.red && x.flags.some(f => f.level === "amber")).length, undated: live.filter(x => x.start_date === "?").length };
    const dated = live.filter(x => x.start_date !== "?" && x.status !== "skipped").sort((a, b) => a.start_date.localeCompare(b.start_date) || a.title.localeCompare(b.title));
    const next = dated.filter(x => x.status !== "on hold").slice(0, 3);
    const first = today.slice(0, 7) + "-01", grid = [];
    for (let k = 0; k < (months || 4); k++) {
      const [y, mo] = first.split("-").map(Number), yy = y + Math.floor((mo - 1 + k) / 12), mm = (mo - 1 + k) % 12 + 1;
      const m1 = `${yy}-${String(mm).padStart(2, "0")}-01`, wd = (new Date(m1 + "T00:00:00Z").getUTCDay() + 6) % 7;   // Monday first
      const days = []; let d = m1; while (d.slice(0, 7) === m1.slice(0, 7)) { days.push(d); d = R.addDays(d, 1); }
      const cells = Array(wd).fill(null).concat(days.map(day => { const evs = dated.filter(x => x.start_date <= day && (x.end_date === "?" ? x.start_date : x.end_date) >= day);
        return { day, n: evs.length, red: evs.some(x => x.red), ids: evs.map(x => x.id), titles: evs.map(x => x.title), today: day === today, past: day < today }; }));
      while (cells.length % 7) cells.push(null);
      const weeks = []; for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
      grid.push({ month: m1.slice(0, 7), weeks });
    }
    const deadlines = [];
    live.forEach(x => { if (!x.d) return; [["reg_deadline", "Registration"], ["room_deadline", "Room block"]].forEach(([k, lab]) => { const v = x.d[k];
      if (isDay(v) && R.diffDays(v, today) >= 0 && R.diffDays(v, today) <= 14) deadlines.push({ date: v, kind: lab, title: x.title, id: x.id, days: R.diffDays(v, today) }); }); });
    deadlines.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
    const nx = next[0];
    return { counts, next, nextIn: nx ? Math.max(0, R.diffDays(nx.start_date, today)) : null, grid, deadlines, tripData: m.tripData };
  }

  // ---------- 00.10.000 rev 3: Links store (links.json.enc), synced across computers; newest change to each link wins ----------
  const LINK_FIELDS = ["vault", "repo", "branch", "sources"];
  const ISO = s => typeof s === "string" && ISO_OFF.test(s) && !isNaN(Date.parse(s));
  function emptyLinks(nowIso) { return { schema_version: 1, updated_at: nowIso, links: {} }; }
  function readLinksStore(raw, maxMs) {   // maxMs (optional): a per-link stamp later than this is refused (listed in .refused), like future-dated snapshots
    if (!raw || typeof raw !== "object" || raw.schema_version !== 1) throw new Error("links: schema_version must be 1");
    if (!ISO(raw.updated_at)) throw new Error("links: updated_at must be a date-time with offset");
    if (!raw.links || typeof raw.links !== "object" || Array.isArray(raw.links)) throw new Error("links: links must be an object");
    const links = {}, refused = [];
    LINK_FIELDS.forEach(k => { const f = raw.links[k]; if (!f || typeof f !== "object" || typeof f.v !== "string" || !ISO(f.at) || typeof f.by !== "string" || !/^[a-z0-9]{1,24}$/.test(f.by)) return;
      if (linksProblem({ [k]: f.v })) return; if (maxMs != null && Date.parse(f.at) > maxMs) { refused.push(k); return; } links[k] = { v: f.v, at: f.at, by: f.by }; });
    let upd = raw.updated_at;
    if (maxMs != null && Date.parse(upd) > maxMs) { const ats = Object.values(links).map(f => f.at).sort((a, b) => Date.parse(b) - Date.parse(a)); upd = ats[0] || "1970-01-01T00:00:00+00:00"; refused.push("updated_at"); }
    const out = { schema_version: 1, updated_at: upd, links }; if (refused.length) Object.defineProperty(out, "refused", { value: refused, enumerable: false }); return out;
  }
  function mergeLinks(a, b) {   // per link: later "at" wins; tie: the store with the later updated_at; tie: machine name, alphabetical first
    if (!a) return b; if (!b) return a;
    const out = { schema_version: 1, updated_at: a.updated_at, links: {} };
    LINK_FIELDS.forEach(k => { const x = a.links[k], y = b.links[k]; if (!x && !y) return; if (!x || !y) { out.links[k] = x || y; return; }
      const dx = Date.parse(x.at), dy = Date.parse(y.at);
      out.links[k] = dx !== dy ? (dx > dy ? x : y) : Date.parse(a.updated_at) !== Date.parse(b.updated_at) ? (Date.parse(a.updated_at) > Date.parse(b.updated_at) ? x : y) : (x.by <= y.by ? x : y); });
    const ats = Object.values(out.links).map(f => Date.parse(f.at)).concat([Date.parse(a.updated_at), Date.parse(b.updated_at)]);
    const mx = Math.max(...ats); out.updated_at = [a.updated_at, b.updated_at].concat(Object.values(out.links).map(f => f.at)).find(v => Date.parse(v) === mx);
    return out;
  }
  const sameLinks = (a, b) => JSON.stringify(a && a.links || {}) === JSON.stringify(b && b.links || {}) || (!!a && !!b && LINK_FIELDS.every(k => JSON.stringify(a.links[k] || null) === JSON.stringify(b.links[k] || null)));
  function setLinks(store, values, nowIso, machine) {
    const out = { schema_version: 1, updated_at: nowIso, links: Object.assign({}, store ? store.links : {}) };
    LINK_FIELDS.forEach(k => { if (!(k in values)) return; const v = String(values[k] == null ? "" : values[k]); const cur = out.links[k];
      if (!cur || cur.v !== v) out.links[k] = { v, at: nowIso, by: machine }; });
    return out;
  }
  function linksValues(store) { const o = {}; if (store) LINK_FIELDS.forEach(k => { if (store.links[k]) o[k] = store.links[k].v; }); return o; }

  g.DASH.events = { COLS, STATUSES, CONFIRMED, SHOW_AS, SECTIONS, DEFAULT_SOURCES, normTitle, keyOf, tripRefProblem, splitRow, links, parseEventsMd, emptyStore, readEventsStore, importEvents,
    readSnapEvents, match, flags, tripData, model, strip, forAccount, answer, samMonth, linksProblem, notebookUrls, samLinks, cityOf, summary, LINK_FIELDS, emptyLinks, readLinksStore, mergeLinks, sameLinks, setLinks, linksValues };
})(typeof window !== "undefined" ? window : globalThis);
