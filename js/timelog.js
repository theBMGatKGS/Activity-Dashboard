/* 00.11.000: time tracking.  Pure functions only (no DOM): entry types, validation, the encrypted time store's merge,
   the daily-snapshot "time" feed, the running timer, and the time report.  No dollar figures and no email addresses are
   ever kept: notes with either are refused.  The only fixed accounts are "Internal" and "Travel/General"; the label shown
   for Internal comes from config.local.js (internalAccountLabel) or the data, never from this file. */
(function (g) {
  "use strict";
  g.DASH = g.DASH || {};
  const R = () => g.DASH.rules;
  const GROUPS = ["work", "touch", "travel", "relationship"];
  const GROUP_LABEL = { work: "Work", touch: "Touch", travel: "Travel", relationship: "Relationship" };
  const TYPES = {
    work: ["research", "design", "drafting", "coordination", "configuration", "review_qa", "quoting_bom", "training", "admin"],
    touch: ["call", "in_person", "email", "teams_text"],
    travel: ["flight", "rideshare", "driving", "airport_wait"],
    relationship: ["meal", "social", "conference"],
  };
  const TYPE_LABEL = { research: "Research", design: "Design", drafting: "Drafting", coordination: "Coordination", configuration: "Configuration", review_qa: "Review/QA",
    quoting_bom: "Quoting/BOM", training: "Training/presenting", admin: "Admin/expenses", call: "Call", in_person: "In-person meeting", email: "Email", teams_text: "Teams/text",
    flight: "Flight", rideshare: "Ride share", driving: "Driving", airport_wait: "Airport/wait", meal: "Business meal", social: "Social event", conference: "Conference/trade show" };
  const FIXED_ACCOUNTS = ["Internal", "Travel/General"];
  const ID = /^T-\d{8}-[0-9a-f]{8}$/, DAY = /^\d{4}-\d\d-\d\d$/, HM = /^([01]\d|2[0-3]):[0-5]\d$/, ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?([+-]\d\d:\d\d|Z)$/;
  const isDay = v => typeof v === "string" && DAY.test(v) && !isNaN(Date.parse(v + "T12:00:00Z")) && new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v;
  const isIso = v => typeof v === "string" && ISO.test(v) && !isNaN(Date.parse(v));
  const groupOf = type => GROUPS.find(k => TYPES[k].includes(type)) || null;
  const accountLabel = (a, cfg) => a === "Internal" && cfg && typeof cfg.internalAccountLabel === "string" && cfg.internalAccountLabel.trim() ? cfg.internalAccountLabel.trim().slice(0, 40) : a;
  // Old Log call kinds -> touch types (nothing is rewritten in the synced time files; this is read-side only)
  const KIND_TO_TOUCH = { "Phone": "call", "Teams call": "call", "Other": "call", "Teams chat": "teams_text" };
  const touchOfKind = k => KIND_TO_TOUCH[k] || (TYPES.touch.includes(k) ? k : null);
  function textProblem(v, max, what) {
    if (v == null) return null;
    if (typeof v !== "string") return `${what} must be text`;
    if (v.length > max) return `${what} is longer than ${max} characters`;
    if (R().hasMoney(v)) return `${what}: no pricing or dollar figures`;
    if (R().hasEmail(v)) return `${what}: no email addresses`;
    return null;
  }
  // One entry: returns a problem (string, never the entry's text) or null.
  function entryProblem(e, opts) {
    const o = opts || {};
    if (!e || typeof e !== "object" || Array.isArray(e)) return "must be an object";
    if (typeof e.id !== "string" || !ID.test(e.id)) return "id must look like T-YYYYMMDD-8hex";
    if (!isDay(e.date)) return "date must be YYYY-MM-DD";
    if (!(e.start === null || e.start === undefined || (typeof e.start === "string" && HM.test(e.start)))) return "start must be HH:MM or null";
    if (!Number.isInteger(e.minutes) || e.minutes < 1 || e.minutes > 1440) return "minutes must be a whole number from 1 to 1440";
    if (!GROUPS.includes(e.group)) return "group must be work, touch, travel or relationship";
    if (!TYPES[e.group].includes(e.type)) return `type must be one of ${TYPES[e.group].join(", ")} for ${e.group}`;
    if (typeof e.account !== "string" || !e.account.trim()) return "account is required";
    for (const [k, max] of [["account", 100], ["project", 100], ["notes", 500], ["x_text", 200]]) { const p = textProblem(e[k], max, k); if (p) return p; }
    if (o.stamp && e.updated_at !== undefined && !isIso(e.updated_at)) return "updated_at must be a date-time with offset";
    return null;
  }
  const clean = e => ({ id: e.id, date: e.date, start: e.start || null, minutes: e.minutes, group: e.group, type: e.type, account: e.account.trim(), project: e.project && e.project.trim() ? e.project.trim() : null,
    notes: e.notes || "", x_text: e.x_text || "", source: e.source || "manual", updated_at: e.updated_at, deleted: e.deleted === true || undefined, review: e.review === true || undefined });
  function newId(date, rnd) { const h = rnd || (() => Math.floor(Math.random() * 16).toString(16)); let x = ""; for (let i = 0; i < 8; i++) x += h(); return "T-" + date.replace(/-/g, "") + "-" + x; }
  function emptyStore() { return { schema_version: 1, updated_at: null, entries: {} }; }
  // Store read (cache or time-store.json.enc): bad entries are dropped and counted, never their text.
  function readStore(raw) {
    if (!raw || typeof raw !== "object" || raw.schema_version !== 1 || !raw.entries || typeof raw.entries !== "object") throw new Error("time store: schema_version must be 1 with entries");
    const out = emptyStore(); let bad = 0; out.updated_at = isIso(raw.updated_at) ? raw.updated_at : null;
    for (const [id, e] of Object.entries(raw.entries)) { if (e && e.id === id && !entryProblem(e, { stamp: true }) && isIso(e.updated_at)) out.entries[id] = clean(e); else bad++; }
    out.bad = bad; return out;
  }
  // Newest updated_at wins per id (a tie keeps what we have).  Deleted entries stay as tombstones so a delete syncs.
  function merge(a, b) {
    const out = emptyStore(); const A = (a && a.entries) || {}, B = (b && b.entries) || {};
    Object.assign(out.entries, A);
    for (const [id, e] of Object.entries(B)) { const cur = out.entries[id]; if (!cur || Date.parse(e.updated_at) > Date.parse(cur.updated_at)) out.entries[id] = e; }
    const st = [a && a.updated_at, b && b.updated_at].filter(Boolean).sort((x, y) => Date.parse(x) - Date.parse(y));
    out.updated_at = st.length ? st[st.length - 1] : null; return out;
  }
  const same = (a, b) => JSON.stringify(Object.keys(a.entries).sort().map(k => [k, a.entries[k].updated_at])) === JSON.stringify(Object.keys(b.entries).sort().map(k => [k, b.entries[k].updated_at]));
  function put(store, e, nowIso) { const s = merge(store, emptyStore()); s.entries[e.id] = clean(Object.assign({}, e, { updated_at: nowIso })); s.updated_at = nowIso; return s; }
  function remove(store, id, nowIso) { const cur = store.entries[id]; if (!cur) return store; return put(store, Object.assign({}, cur, { deleted: true }), nowIso); }
  const live = store => Object.values((store && store.entries) || {}).filter(e => !e.deleted);
  // The snapshot's "time" block (from build.py / time_section.py).  Each entry is stamped with the feed's generated_at,
  // so the same id is a correction and the newest feed wins.  An account the dashboard doesn't know is kept with review: true.
  function readFeed(raw, known, rejects) {
    if (raw === undefined || raw === null) return null;
    const bad = m => { if (rejects) rejects.push("time: " + m); return null; };
    if (typeof raw !== "object" || Array.isArray(raw) || raw.schema_version !== 1) return bad("schema_version must be 1; no time entries were read");
    if (!isIso(raw.generated_at)) return bad("generated_at must be a date-time with offset; no time entries were read");
    if (!Array.isArray(raw.entries)) return bad("entries must be a list; no time entries were read");
    const knownSet = new Set((known || []).concat(FIXED_ACCOUNTS).map(x => String(x).toLowerCase())), entries = [], seen = new Set();
    raw.entries.forEach((e, i) => {
      const p = entryProblem(e); if (p) { bad(`entry ${i + 1}: ${p}`); return; }
      if (seen.has(e.id)) { bad(`entry ${i + 1}: duplicate id in one feed; the first is kept`); return; } seen.add(e.id);
      const c = clean(Object.assign({}, e, { source: "feed", updated_at: raw.generated_at })); if (!knownSet.has(c.account.toLowerCase())) c.review = true; else delete c.review;
      entries.push(c); });
    return { generated_at: raw.generated_at, source: typeof raw.source === "string" ? raw.source.slice(0, 40) : "", entries };
  }
  function mergeFeed(store, feed) {
    if (!feed) return { store, added: 0, corrected: 0, review: 0 };
    const inc = emptyStore(); feed.entries.forEach(e => { inc.entries[e.id] = e; });
    const before = store || emptyStore(), out = merge(before, inc); let added = 0, corrected = 0;
    feed.entries.forEach(e => { const b = before.entries[e.id]; if (!b) added++; else if (Date.parse(e.updated_at) > Date.parse(b.updated_at)) corrected++; });
    if (added || corrected) out.updated_at = feed.generated_at > (out.updated_at || "") ? feed.generated_at : out.updated_at;
    return { store: out, added, corrected, review: live(out).filter(e => e.review).length };
  }
  // Running timer (kept in IndexedDB, SECRET): {started_at ISO, group, type, account, project}.  Survives a reload.
  function timerProblem(t) { if (!t || !isIso(t.started_at)) return "no start"; if (!GROUPS.includes(t.group) || !TYPES[t.group].includes(t.type)) return "pick a type"; if (typeof t.account !== "string" || !t.account.trim()) return "pick an account"; return null; }
  function elapsed(t, nowMs) { return t && isIso(t.started_at) ? Math.max(0, Math.floor((nowMs - Date.parse(t.started_at)) / 1000)) : 0; }
  const clock = s => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, "0")).join(":");
  // Stop: an entry for the whole run (at least 1 minute, at most 1440); date and start are in the dashboard zone.
  function stopEntry(t, nowMs, zoneDay, zoneHm, rnd) {
    const mins = Math.min(1440, Math.max(1, Math.round(elapsed(t, nowMs) / 60))), date = zoneDay(t.started_at);
    return { id: newId(date, rnd), date, start: zoneHm(t.started_at), minutes: mins, group: t.group, type: t.type, account: t.account, project: t.project || null, notes: "", x_text: "", source: "timer" };
  }
  // Durations typed in the Add past row: "90", "90m", "1h", "1h 30m", "1:30"
  function parseDuration(s) {
    const t = String(s || "").trim().toLowerCase(); let m = null, x;
    if ((x = t.match(/^(\d{1,4})\s*m?$/))) m = +x[1];
    else if ((x = t.match(/^(\d{1,2}):([0-5]\d)$/))) m = +x[1] * 60 + +x[2];
    else if ((x = t.match(/^(\d{1,2})\s*h(?:\s*(\d{1,2})\s*m?)?$/))) m = +x[1] * 60 + (x[2] ? +x[2] : 0);
    return m && m >= 1 && m <= 1440 ? m : null;
  }
  // ---------- report ----------
  function weekRange(today) { const R0 = R(), dow = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7, from = R0.addDays(today, -dow); return { from, to: R0.addDays(from, 6) }; }
  function monthRange(today) { const y = +today.slice(0, 4), mo = +today.slice(5, 7), last = new Date(Date.UTC(y, mo, 0)).getUTCDate(); return { from: today.slice(0, 8) + "01", to: today.slice(0, 8) + String(last).padStart(2, "0") }; }
  const pctOf = (n, total) => total ? Math.round(n / total * 100) : 0;
  function report(entries, opt) {
    const o = opt || {}, groups = o.groups ? new Set(o.groups) : new Set(GROUPS), lab = o.accountLabel || (a => a);
    const inRange = (entries || []).filter(e => !e.deleted && e.date >= o.from && e.date <= o.to), shown = inRange.filter(e => groups.has(e.group));
    const total = shown.reduce((a, e) => a + e.minutes, 0), hidden = inRange.reduce((a, e) => a + e.minutes, 0) - total;
    const by = (key, label) => { const m = new Map(); shown.forEach(e => { const k = key(e); m.set(k, (m.get(k) || 0) + e.minutes); });
      return [...m.entries()].map(([k, n]) => ({ key: k, label: label(k), minutes: n, pct: pctOf(n, total) })).sort((a, b) => b.minutes - a.minutes || String(a.label).localeCompare(String(b.label))); };
    const byGroup = GROUPS.filter(k => groups.has(k)).map(k => { const n = shown.filter(e => e.group === k).reduce((a, e) => a + e.minutes, 0); return { key: k, label: GROUP_LABEL[k], minutes: n, pct: pctOf(n, total) }; });
    return { from: o.from, to: o.to, total, hidden, count: shown.length, byGroup, byType: by(e => e.type, k => TYPE_LABEL[k] || k), byAccount: by(e => e.account, lab), byProject: by(e => e.project || "", k => k || "(no project)") };
  }
  const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : m + "m";
  // CSV of the time log (only on purpose, File → Export time log): no notes text beyond 500, formula guard via rules.csvCell
  function csv(entries, lab) {
    const cols = ["id", "date", "start", "minutes", "group", "type", "account", "project", "notes"], cell = R().csvCell;
    return "\ufeff" + ["Restricted - Internal Use Only", "", cols.join(",")].concat(entries.filter(e => !e.deleted).sort((a, b) => a.date.localeCompare(b.date) || String(a.start).localeCompare(String(b.start)))
      .map(e => cols.map(c => cell(c === "account" ? (lab ? lab(e.account) : e.account) : e[c] == null ? "" : String(e[c]))).join(","))).join("\r\n") + "\r\n";
  }
  g.DASH.timelog = { GROUPS, GROUP_LABEL, TYPES, TYPE_LABEL, FIXED_ACCOUNTS, KIND_TO_TOUCH, touchOfKind, groupOf, accountLabel, entryProblem, newId, emptyStore, readStore, merge, same, put, remove, live,
    readFeed, mergeFeed, timerProblem, elapsed, clock, stopEntry, parseDuration, weekRange, monthRange, report, fmtMin, csv, isDay, isIso };
})(typeof window !== "undefined" ? window : globalThis);
