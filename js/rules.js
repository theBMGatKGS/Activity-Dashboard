/* Activity Dashboard — pure rules (no DOM). window.DASH.rules. Snapshot = Inbox Exporter schema_version 1. */
(function (g) {
  "use strict";
  const DAY = 86400000;
  const LISTS = ["Follow-ups", "Waiting on", "Account touches", "Travel"];
  const STATUSES = ["not_started", "in_progress", "waiting", "blocked", "done", "deferred"];
  const AUDIENCES = ["Owner/operator", "Engineer of record", "Integrator/partner", "Internal - Domestic", "Internal - International", "Industry/event"];
  const SUBJECTS = ["Account strategy", "Technical/design support", "Training/education", "Product/software", "Admin/travel"];
  const TOTAL_KEYS = ["overdue", "dueToday", "thisWeek", "iOwe", "owedToMe", "goingCold", "followUps", "waitingOn", "accountTouches", "travel"];
  const LIST_KEY = { "Follow-ups": "followUps", "Waiting on": "waitingOn", "Account touches": "accountTouches", "Travel": "travel" };
  const BAD_UP = { overdue: 1, iOwe: 1, goingCold: 1 };
  const COLD_DAYS = 14;
  const GROUPS = ["Overdue", "Due Today", "This Week", "Next"];
  const SOURCES = ["inbox-export", "inbox-csv"], TOUCH_DIR = ["inbound", "outbound"], TOUCH_KIND = ["email", "call", "meeting", "meeting_proposed", "linkedin", "visit"];
  const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const RE_DAY = /^\d{4}-\d{2}-\d{2}$/, RE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}:\d{2}|Z)$/;

  function ymd(d) {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const o = {}; p.forEach(x => o[x.type] = x.value); return `${o.year}-${o.month}-${o.day}`;
  }
  function hm(iso) { return new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" }).format(new Date(iso)); }
  function hourCT(iso) { const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)).split(":"); return +p[0] + p[1] / 60; }
  function parseDay(s) { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); }
  function addDays(s, n) { return new Date(parseDay(s) + n * DAY).toISOString().slice(0, 10); }
  function diffDays(a, b) { return Math.round((parseDay(a) - parseDay(b)) / DAY); }
  function weekday(s) { return new Date(parseDay(s)).getUTCDay(); }
  function sundayOf(s) { const w = weekday(s); return addDays(s, w === 0 ? 0 : 7 - w); }
  function mondayOf(s) { const w = weekday(s); return addDays(s, w === 0 ? -6 : 1 - w); }
  function dayLabel(s) { const [, m, d] = s.split("-").map(Number); return `${WD[weekday(s)]} ${m}/${d}`; }
  function isoDay(iso) { return ymd(new Date(iso)); }

  // ---------- snapshot validation + items ----------
  function readSnapshot(snap) {
    const rejects = [];
    if (!snap || typeof snap !== "object") throw new Error("Snapshot is not an object.");
    if (snap.schema_version !== 1) throw new Error(`Unsupported schema_version ${snap.schema_version} (expected 1).`);
    if (!snap.generated_at || !RE_ISO.test(snap.generated_at)) throw new Error("generated_at is missing or not ISO 8601 with offset.");
    if (!SOURCES.includes(snap.source)) throw new Error(`source must be "inbox-export" (got ${JSON.stringify(snap.source)}).`);
    const txt = JSON.stringify((snap.calendar || []).map(e => e.attendee_domains)) + JSON.stringify((snap.tasks || []).map(t => t.person));
    if (/[@\uff20\ufe6b]/.test(txt)) throw new Error("Snapshot contains '@' in attendee_domains or person: full email addresses are not allowed. Whole snapshot rejected.");
    const accounts = (snap.accounts || []).filter(a => a && a.name).map(a => ({ name: a.name, tier: a.tier === "T1" ? "T1" : "other", domains: (a.domains || []).map(d => String(d).toLowerCase()) }));
    const names = new Set(accounts.map(a => a.name));
    const items = []; const seen = new Set();
    (snap.tasks || []).forEach(t => {
      const tag = `${t.list || "?"} / ${t.title || t.id}`;
      const bad = m => rejects.push(`${tag}: ${m}`);
      if (!t.id || seen.has(t.id)) return bad("missing or duplicate id");
      if (!LISTS.includes(t.list)) return bad(`list must be one of ${LISTS.join(", ")}`);
      if (!STATUSES.includes(t.status)) return bad(`status "${t.status}" is not valid`);
      if (typeof t.withhold !== "boolean") return bad("withhold must be true or false");
      if (t.next_date !== null && t.next_date !== undefined && !RE_DAY.test(t.next_date)) return bad("next_date must be YYYY-MM-DD or null");
      if (t.account && !names.has(t.account)) return bad(`account "${t.account}" is not in accounts`);
      if (!t.last_modified || !RE_ISO.test(t.last_modified)) return bad("last_modified must be ISO 8601 with offset");
      if (t.importance !== undefined && t.importance !== null && !["low", "normal", "high"].includes(t.importance)) return bad(`importance "${t.importance}" must be low, normal or high`);
      if (t.next_date && !realDay(t.next_date)) return bad(`next_date ${t.next_date} does not exist`);
      seen.add(t.id);
      items.push({ id: t.id, list: t.list, title: String(t.title || "").trim(), account: t.account || null, person: t.person || null,
        due: t.next_date || null, status: t.status, withhold: t.withhold, lastModified: isoDay(t.last_modified),
        completedOn: t.completed_at ? isoDay(t.completed_at) : null, estMinutes: t.est_minutes || null, importance: t.importance || "normal" });
    });
    const calendar = [];
    (snap.calendar || []).forEach(e => {
      if (!e.id || !RE_ISO.test(e.start || "") || !RE_ISO.test(e.end || "") || new Date(e.end) <= new Date(e.start)) { rejects.push(`calendar ${e.id || "?"}: bad id/start/end`); return; }
      const doms = (e.attendee_domains || []).map(d => String(d).toLowerCase());
      let account = e.account && names.has(e.account) ? e.account : null;
      if (!account) { const a = accounts.find(a => a.domains.some(d => doms.includes(d))); if (a) account = a.name; }
      calendar.push({ id: e.id, start: e.start, end: e.end, title: e.title || "", location: e.location || null, attendee_domains: doms, account });
    });
    const touches = [];
    (snap.touches || []).forEach((x, i) => {
      const bad = m => rejects.push(`touch ${i + 1}: ${m}`);
      if (!x || !names.has(x.account)) return bad(`account "${x && x.account}" is not in accounts`);
      if (!RE_DAY.test(x.date || "") || !realDay(x.date)) return bad("date must be YYYY-MM-DD");
      if (!TOUCH_DIR.includes(x.direction)) return bad(`direction must be ${TOUCH_DIR.join(" or ")}`);
      if (!TOUCH_KIND.includes(x.kind)) return bad(`kind must be one of ${TOUCH_KIND.join(", ")}`);
      if (x.meeting_date !== undefined && x.meeting_date !== null && (x.kind !== "meeting_proposed" || !RE_DAY.test(x.meeting_date))) return bad("meeting_date is only for meeting_proposed, as YYYY-MM-DD or null");
      touches.push(x);
    });
    const history = (snap.totals_history || []).filter(h => h && RE_ISO.test(h.generated_at || "") && h.totals);
    return { generatedAt: snap.generated_at, example: snap.example === true, source: snap.source || "inbox-export", items, accounts, calendar, touches, history, rejects };
  }

  // ---------- status / groups ----------
  function isOpen(it) { return it.status !== "done"; }
  function dateWord(due, today) {
    if (!due) return "Next";
    if (due < today) return "Overdue";
    if (due === today) return "Today";
    if (weekday(today) !== 0 && due <= sundayOf(today)) return "This Week";
    return "Next";
  }
  function statusWord(it, today) {
    if (it.status === "done") return "Done";
    if (it.status === "blocked") return "Blocked";
    if (it.status === "waiting") return "Waiting";
    if (it.status === "deferred") return "Next";
    return dateWord(it.due, today);
  }
  function group(it, today) { const w = it.status === "deferred" ? "Next" : dateWord(it.due, today); return w === "Today" ? "Due Today" : w; }
  function sortItems(a, b) { return (a.due || "9999") < (b.due || "9999") ? -1 : (a.due || "9999") > (b.due || "9999") ? 1 : a.id.localeCompare(b.id); }

  // ---------- activity / going cold ----------
  // the user: "Activity is any To Do edit, logged time entry, or meeting with that account"
  function lastActivity(it, ctx) {
    let d = it.lastModified || null;
    const up = x => { if (x && x <= ctx.today && (!d || x > d)) d = x; };
    // Rule: "Logged time counts as activity only for that item; account meetings stay account-wide"
    (ctx.timeEntries || []).forEach(e => { if (e.taskId && e.taskId === it.id) up(e.date); });
    (ctx.calendar || []).forEach(ev => { if (it.account && ev.account === it.account) up(isoDay(ev.start)); });
    return d;
  }
  function isCold(it, ctx) { if (!isOpen(it)) return false; const a = lastActivity(it, ctx); return !a || diffDays(ctx.today, a) >= COLD_DAYS; }

  // ---------- totals + filters ----------
  function inTotal(it, key, ctx) {
    const sun = sundayOf(ctx.today);
    switch (key) {
      case "overdue": return !!it.due && it.due < ctx.today;
      case "dueToday": return it.due === ctx.today;
      case "thisWeek": return !!it.due && it.due > ctx.today && it.due <= sun;
      case "iOwe": return (it.list === "Follow-ups" || it.list === "Account touches") && ["not_started", "in_progress"].includes(it.status);
      case "owedToMe": return it.list === "Waiting on";
      case "goingCold": return isCold(it, ctx);
      default: return LIST_KEY[it.list] === key;
    }
  }
  function totals(items, ctx) { const t = {}; TOTAL_KEYS.forEach(k => t[k] = items.filter(isOpen).filter(it => inTotal(it, k, ctx)).length); return t; }

  // ---------- history / WoW ----------
  function mergeHistory(stored, incoming) {
    const m = {}; [...(stored || []), ...(incoming || [])].forEach(h => { m[h.generated_at] = h; });
    return Object.values(m).sort((a, b) => new Date(a.generated_at) - new Date(b.generated_at));
  }
  function weeklySeries(history) {
    const byWeek = {};
    history.forEach(h => { const w = mondayOf(isoDay(h.generated_at)); if (!byWeek[w] || new Date(h.generated_at) > new Date(byWeek[w].generated_at)) byWeek[w] = h; });
    return Object.keys(byWeek).sort().map(w => ({ week: w, totals: byWeek[w].totals }));
  }
  // previous week vs current week; missing previous week -> nearest older snapshot week; none -> n/a
  function wow(series, key) {
    if (series.length < 2) return { delta: null, text: "n/a", fallback: false };
    const cur = series[series.length - 1], prev = series[series.length - 2];
    const d = (cur.totals[key] || 0) - (prev.totals[key] || 0);
    return { delta: d, text: d === 0 ? "no change" : d > 0 ? `▲ +${d} vs last wk` : `▼ ${d} vs last wk`, fallback: diffDays(cur.week, prev.week) > 7, basisWeek: prev.week };
  }
  function wowTone(key, delta) { if (!delta) return "neu"; return BAD_UP[key] ? (delta > 0 ? "bad" : "good") : "neu"; }
  function sparkPoints(vals, w, h) {
    if (!vals.length) return "";
    const mx = Math.max(...vals), mn = Math.min(...vals), r = (mx - mn) || 1;
    return vals.map((v, i) => `${(vals.length === 1 ? w / 2 : 2 + i * (w - 4) / (vals.length - 1)).toFixed(1)},${(h - 2 - (v - mn) / r * (h - 4)).toFixed(1)}`).join(" ");
  }

  // ---------- calendar ----------
  function withConflicts(events) {
    const ev = events.map(e => ({ ...e, conflict: false, day: isoDay(e.start) }));
    for (let i = 0; i < ev.length; i++) for (let j = i + 1; j < ev.length; j++) {
      const a = ev[i], b = ev[j];
      if (a.day === b.day && new Date(a.start) < new Date(b.end) && new Date(b.start) < new Date(a.end)) a.conflict = b.conflict = true;
    }
    return ev;
  }
  function minutesBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 60000); }

  // ---------- audience / subject guesses (domains only) ----------
  const DEFAULT_RULES = {
    internalDomestic: ["example.com", "example.net"],
    internationalHints: ["intl", ".co.uk", ".de", ".fr", ".it", ".es", ".ae", ".sa", ".sg", ".in", ".au", ".cn", ".jp", ".mx", ".br"],
    domainMap: { "contoso.example": "Integrator/partner", "acmefab.example": "Owner/operator", "account-a.example": "Owner/operator" },
  };
  function isInternal(d, r) { return r.internalDomestic.some(x => d === x || d.endsWith("." + x)) || isIntl(d, r); }
  function isIntl(d, r) { return (d.includes("corp") || r.internalDomestic.some(x => d.endsWith(x))) && r.internationalHints.some(h => h.startsWith(".") ? d.endsWith(h) : d.includes(h)); }
  function guessAudience(domains, rules) {
    const r = rules || DEFAULT_RULES; const doms = (domains || []).map(d => d.toLowerCase());
    const ext = doms.filter(d => !isInternal(d, r));
    for (const d of ext) if (r.domainMap[d]) return { value: r.domainMap[d], why: `${d} is mapped to ${r.domainMap[d]}` };
    if (ext.length) return { value: "Owner/operator", why: `${ext[0]} is not mapped (fallback)` };
    if (doms.some(d => isIntl(d, r))) return { value: "Internal - International", why: "international internal domain" };
    if (doms.length) return { value: "Internal - Domestic", why: "only internal domains" };
    return { value: "Owner/operator", why: "no attendees (fallback)" };
  }
  function guessSubject(title) {
    const t = (title || "").toLowerCase();
    if (/training|webinar/.test(t)) return { value: "Training/education", why: "title says training/webinar" };
    if (/designtool|software|product/.test(t)) return { value: "Product/software", why: "title says software/product" };
    if (/design|review|submittal/.test(t)) return { value: "Technical/design support", why: "title says design/review/submittal" };
    if (/travel|flight/.test(t)) return { value: "Admin/travel", why: "title says travel/flight" };
    return { value: "Account strategy", why: "no keyword (fallback)" };
  }
  // A correction teaches: each external domain of that event -> chosen audience (local only).
  function learnAudience(rules, domains, audience) {
    const n = JSON.parse(JSON.stringify(rules || DEFAULT_RULES));
    (domains || []).forEach(d => { d = d.toLowerCase(); if (!isInternal(d, n)) n.domainMap[d] = audience; });
    return n;
  }

  // ---------- line ----------
  function lineHead(it) { return it.person ? (it.person === "Me" ? "Me" : it.person) : (it.account || "Me"); }
  function formatLine(it, max) {
    max = max || 69;
    const tail = it.due ? ` · ${dayLabel(it.due)}` : "";
    let head = `${lineHead(it)}: ${it.title}`;
    if ((head + tail).length > max) head = head.slice(0, max - tail.length - 1).trimEnd() + "…";
    return head + tail;
  }
  function managerItems(items) { return items.filter(it => isOpen(it) && !it.withhold); }

  // ---------- workload ----------
  const KINDS = ["Phone", "Teams chat", "Teams call", "Other"];
  function workload(entries, weekStart) {
    const end = addDays(weekStart, 6);
    const wk = (entries || []).filter(e => e.date >= weekStart && e.date <= end);
    const sum = (arr, k) => arr.reduce((o, e) => { const v = e[k] || "(none)"; o[v] = (o[v] || 0) + e.minutes; return o; }, {});
    const minutes = arr => arr.reduce((a, e) => a + e.minutes, 0);
    return { totalMin: minutes(wk), manualMin: minutes(wk.filter(e => e.source === "manual")), calendarMin: minutes(wk.filter(e => e.source === "calendar")),
      interactionMin: minutes(wk.filter(e => e.source === "interaction")), interactionCount: wk.filter(e => e.source === "interaction").length,
      byAudience: sum(wk, "audience"), bySubject: sum(wk, "subject"), byKind: sum(wk.filter(e => e.source === "interaction"), "kind"),
      topAccounts: Object.entries(sum(wk.filter(e => e.account), "account")).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5) };
  }
  // Calendar time: non-conflicting events up to today fill at once. Conflicting events fill only the one marked Attended.
  function calendarFills(events, today, attended) {
    const ev = withConflicts(events), out = [];
    ev.forEach(e => {
      if (e.day > today) return;
      if (!e.conflict || (attended || []).includes(e.id)) out.push(e);
    });
    return out;
  }
  function conflictPartners(events, id) {
    const ev = withConflicts(events), me = ev.find(e => e.id === id); if (!me) return [];
    return ev.filter(e => e.id !== id && e.day === me.day && new Date(e.start) < new Date(me.end) && new Date(me.start) < new Date(e.end)).map(e => e.id);
  }
  // Notebook log (format from Notebook commit 2fdcdb3). Only lines starting "- [log]" are read; every other line is ignored. The .md is never written.
  // - [log] YYYY-MM-DD HH:MM | 20m | Channel | Audience | Subject | Account | Person | note
  // Minutes lenient (20, 20m, 1h, 1h15m). Channel: Phone|Teams chat|Teams call|Other. Audience/Subject/Account/Person/note may be blank
  // (blank audience/subject are guessed later). Person must not contain "@".
  const AT = /[@\uff20\ufe6b]/;  // "@", full-width "＠", small "﹫"
  // Field fingerprint used to merge entries stored under the old line-number id scheme (no idv) into the current ids.
  function logFingerprint(e) { return hashStr([e.date, e.time, e.minutes, e.kind, e.account || "", e.person || "", e.note || ""].join("|").toLowerCase()); }
  // One-time migration: old-scheme notebook-log entries get legacy:true and a fingerprint; mergeLog() then re-keys them.
  function migrateLogEntries(entries) {
    let n = 0; (Array.isArray(entries) ? entries : []).forEach(e => { if (!e || typeof e !== "object") return; if (e.origin === "notebook-log" && e.idv !== 2 && !e.legacy) { e.legacy = true; e.fp = logFingerprint(e); n++; } }); return n;
  }
  // Merge parsed log entries into stored ones: same id = already there; a legacy entry with the same fingerprint is re-keyed (keeps the user's edits).
  function mergeLog(stored, parsed) {
    let added = 0, dup = 0, merged = 0; const out = [];
    parsed.forEach(e => {
      if (stored.some(x => x.id === e.id)) { dup++; return; }
      const old = stored.find(x => x.legacy && x.fp === e.fp);
      if (old) { old.id = e.id; old.idv = 2; delete old.legacy; merged++; return; }
      out.push(e); added++;
    });
    return { add: out, added, dup, merged };
  }
  function realDay(s) { const [y, m, d] = s.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; }
  function parseMinutes(v) {
    v = String(v || "").trim().toLowerCase(); let m;
    if (/^\d+$/.test(v)) return +v;
    if ((m = v.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/)) && (m[1] || m[2])) return (+(m[1] || 0)) * 60 + (+(m[2] || 0));
    return NaN;
  }
  function hashStr(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
  const ci = (arr, v) => arr.find(x => x.toLowerCase() === String(v || "").trim().toLowerCase()) || null;
  function parseNotebookLog(text, accountNames) {
    const entries = [], rejects = []; const names = accountNames || []; const seen = {};
    String(text || "").split(/\r?\n/).forEach((raw, i) => {
      const line = raw.trim(); if (!/^- \[log\]/i.test(line)) return;
      const norm = line.replace(/\s+/g, " ").replace(/\s*\|\s*/g, " | ").toLowerCase();  // case-only edits don't re-import
      const p = line.replace(/^- \[log\]\s*/i, "").split("|").map(x => x.trim());
      const bad = m => rejects.push(`line ${i + 1}: ${m}`);
      const dm = (p[0] || "").match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}):(\d{2})$/); if (!dm) return bad("must start with YYYY-MM-DD HH:MM");
      if (!realDay(dm[1])) return bad(`date ${dm[1]} does not exist`);
      if (+dm[2] > 23 || +dm[3] > 59) return bad(`time ${dm[2]}:${dm[3]} is not a valid 24-hour time`);
      const minutes = parseMinutes(p[1]); if (!(minutes >= 1 && minutes <= 720)) return bad("minutes must be 1 to 720 (e.g. 20m, 1h, 1h15m)");
      const kind = ci(KINDS, p[2]); if (!kind) return bad(`channel must be one of ${KINDS.join(", ")}`);
      const audience = p[3] ? ci(AUDIENCES, p[3]) : null; if (p[3] && !audience) return bad(`audience "${p[3]}" is not one of the six audiences`);
      const subject = p[4] ? ci(SUBJECTS, p[4]) : null; if (p[4] && !subject) return bad(`subject "${p[4]}" is not one of the five subjects`);
      const acc = p[5] ? ci(names, p[5]) : null; if (p[5] && !acc) return bad(`account "${p[5]}" is not in the snapshot`);
      const person = p[6] || null; if (person && AT.test(person)) return bad("person must not contain '@' (names only, no email addresses)");
      const note = p.slice(7).join(" | "); if (AT.test(note)) return bad("note must not contain '@' (no email addresses)");
      // R1: id = hash of the normalised line content + its n-th identical occurrence. Inserting or deleting other lines never changes it,
      // and two genuine identical lines stay two entries.
      const h = hashStr(norm); seen[h] = (seen[h] || 0) + 1;
      entries.push({ id: "log:" + h + ":" + seen[h], idv: 2, date: dm[1], time: `${dm[2]}:${dm[3]}`, minutes, kind, audience, subject, account: acc, person, note, source: "interaction", origin: "notebook-log" });
      entries[entries.length - 1].fp = logFingerprint(entries[entries.length - 1]);
    });
    return { entries, rejects };
  }
  // F6: a cell is neutralised when, after any leading whitespace (incl. NBSP/zero-width), tab, CR or quote, it starts with = + - @;
  // also when it starts with a tab or CR. Neutralised cells get a leading apostrophe. Every text cell is quoted.
  const CSV_DANGER = /^[\s\u00a0\u200b\u200c\u200d\u2060\ufeff"']*[=+\-@]|^[\t\r]/;
  function csvCell(v) {
    if (typeof v === "number") return String(v);
    v = v == null ? "" : String(v);
    if (CSV_DANGER.test(v)) v = "'" + v;
    return '"' + v.replace(/"/g, '""') + '"';
  }
  const CSV_COLS = ["date", "time", "minutes", "hours", "source", "channel", "audience", "subject", "account", "person", "task_id", "event_id", "title", "note"];
  function timeEntriesCSV(entries) {
    const rows = [...(entries || [])].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0).map(e => [e.date, e.time || "", e.minutes, (e.minutes / 60).toFixed(2), e.source, e.kind || "", e.audience || "", e.subject || "", e.account || "", e.person || "", e.taskId || "", e.eventId || "", e.title || "", e.note || ""].map(csvCell).join(","));
    return [CSV_COLS.join(","), ...rows].join("\r\n") + "\r\n";
  }
  function coldList(items, ctx) {
    return items.filter(it => isCold(it, ctx)).map(it => { const a = lastActivity(it, ctx); return { it, last: a, days: a ? diffDays(ctx.today, a) : null }; })
      .sort((x, y) => (y.days === null ? 1e9 : y.days) - (x.days === null ? 1e9 : x.days));
  }

  // ---------- CSV (tasks only; tasks.csv with the §3 column names) ----------
  function parseCSV(text) {
    const rows = []; let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true; else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += c;
    }
    if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => !(r.length === 1 && r[0] === ""));
  }
  function snapshotFromCSV(text) {
    let gen = null;
    const body = text.split(/\r?\n/).filter(l => { const m = l.match(/^#\s*generated_at=(.+)$/); if (m) { gen = m[1].trim(); return false; } return true; }).join("\n");
    const rows = parseCSV(body); const head = rows.shift().map(h => h.trim());
    ["id", "list", "title", "status", "withhold", "last_modified"].forEach(n => { if (!head.includes(n)) throw new Error(`CSV is missing column "${n}"`); });
    const accts = new Set();
    const tasks = rows.map(r => { const o = {}; head.forEach((h, i) => o[h] = (r[i] || "").trim());
      const w = o.withhold.toLowerCase();
      if (o.account) accts.add(o.account);
      return { id: o.id, list: o.list, title: o.title, account: o.account || null, person: o.person || null, next_date: o.next_date || null, status: o.status,
        last_modified: o.last_modified, withhold: w === "true" ? true : w === "false" ? false : o.withhold, est_minutes: o.est_minutes ? +o.est_minutes : null }; });
    return { schema_version: 1, generated_at: gen, source: "inbox-csv", tasks, accounts: [...accts].map(n => ({ name: n, tier: ((g.DASH_CONFIG && g.DASH_CONFIG.tier1Accounts) || []).includes(n) ? "T1" : "other" })), calendar: [], touches: [], totals_history: [] };
  }

  g.DASH = g.DASH || {};
  g.DASH.rules = { LISTS, STATUSES, AUDIENCES, SUBJECTS, TOTAL_KEYS, LIST_KEY, GROUPS, COLD_DAYS, DEFAULT_RULES,
    ymd, hm, hourCT, addDays, diffDays, sundayOf, mondayOf, dayLabel, isoDay, readSnapshot, isOpen, dateWord, statusWord, group, sortItems,
    lastActivity, isCold, inTotal, totals, mergeHistory, weeklySeries, wow, wowTone, sparkPoints, withConflicts, minutesBetween,
    guessAudience, guessSubject, learnAudience, lineHead, formatLine, managerItems, workload, parseCSV, snapshotFromCSV,
    KINDS, logFingerprint, migrateLogEntries, mergeLog, SOURCES, TOUCH_DIR, TOUCH_KIND, realDay, csvCell, calendarFills, conflictPartners, parseMinutes, parseNotebookLog, timeEntriesCSV, CSV_COLS, coldList };
})(typeof window !== "undefined" ? window : globalThis);
