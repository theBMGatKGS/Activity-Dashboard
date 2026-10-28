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

  // 00.05.001: the day boundary, 08:00 snooze return, as-of stamp and meeting times follow the computer's time zone.
  // No setting: the app calls setTimeZone(detectTimeZone()) at start and whenever it re-checks (poll, focus, visible).
  const DEFAULT_TZ = "America/Chicago";
  let TZ = DEFAULT_TZ, FMT = {};
  function validTimeZone(z) { if (typeof z !== "string" || !z) return false; try { new Intl.DateTimeFormat("en-US", { timeZone: z }); return true; } catch (e) { return false; } }
  function detectTimeZone() { let z; try { z = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { z = null; } return validTimeZone(z) ? z : DEFAULT_TZ; }
  function setTimeZone(z) { const n = validTimeZone(z) ? z : DEFAULT_TZ; if (n !== TZ) { TZ = n; FMT = {}; } return TZ; }
  function getTimeZone() { return TZ; }
  function fmt(k, o) { return FMT[k] || (FMT[k] = new Intl.DateTimeFormat(k.split("|")[0], Object.assign({ timeZone: TZ }, o))); }
  // Short zone label for stamps: "CT", "ET", "PT", "MST"…; zones without a short US name show their IANA id.
  function tzLabel(iso) {
    const p = fmt("en-US|tzl", { timeZoneName: "shortGeneric" }).formatToParts(iso ? new Date(iso) : new Date()).find(x => x.type === "timeZoneName");
    const v = p ? p.value : ""; return /^[A-Z]{2,5}$/.test(v) ? v : TZ;
  }
  function ymd(d) {
    const p = fmt("en-CA|ymd", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const o = {}; p.forEach(x => o[x.type] = x.value); return `${o.year}-${o.month}-${o.day}`;
  }
  function hm(iso) { return fmt("en-US|hm", { hour: "numeric", minute: "2-digit" }).format(new Date(iso)); }
  function hourCT(iso) { const p = fmt("en-US|h23", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)).split(":"); return +p[0] + p[1] / 60; }
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
        due: t.next_date || null, status: t.status, withhold: t.withhold, lastModified: isoDay(t.last_modified), lastModifiedAt: new Date(t.last_modified).toISOString(),
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

  // ---------- 00.05 Daily Focus (pure; no DOM) ----------
  // Wall-clock time on a day in the current zone -> ISO instant (DST-safe; a time inside a spring-forward gap moves forward).
  // (Name kept from 00.05.000; "CT" is now "the computer's zone".)
  function zoneOffsetMs(t) {
    const p = {}; fmt("en-US|off", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t)).forEach(x => p[x.type] = x.value);
    return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
  }
  function ctIso(day, hhmm) {
    const [y, m, d] = day.split("-").map(Number), wall = Date.UTC(y, m - 1, d, +hhmm.slice(0, 2), +hhmm.slice(3, 5));
    let t = wall - zoneOffsetMs(wall); t = wall - zoneOffsetMs(t);
    if (ymd(new Date(t)) !== day || Math.abs(hourCT(new Date(t).toISOString()) - (+hhmm.slice(0, 2) + hhmm.slice(3, 5) / 60)) > 1e-6) t = wall - zoneOffsetMs(wall - 3 * 3600e3) ;
    return new Date(t).toISOString();
  }
  // Snooze choices: Later today (+3 h), Tomorrow 08:00, Next Monday 08:00, a picked date 08:00 (computer's zone).
  function snoozeUntil(choice, nowIso, pickedDay) {
    const now = new Date(nowIso), today = ymd(now);
    if (choice === "later") return new Date(now.getTime() + 3 * 3600e3).toISOString();
    if (choice === "tomorrow") return ctIso(addDays(today, 1), "08:00");
    if (choice === "monday") { const w = weekday(today); return ctIso(addDays(today, w === 0 ? 1 : 8 - w), "08:00"); }
    if (choice === "date" && pickedDay && RE_DAY.test(pickedDay) && realDay(pickedDay)) return ctIso(pickedDay, "08:00");
    return null;
  }
  function prevBusinessDay(day) { let d = addDays(day, -1); while (weekday(d) === 0 || weekday(d) === 6) d = addDays(d, -1); return d; }
  // G1: "owed to outside" = the task has an account, or its person is not on the internal-people list.
  function isOutside(it, internal) {
    if (it.account) return true;
    const p = (it.person || "").trim(); if (!p || p.toLowerCase() === "me") return false;
    return !(internal || new Set()).has(p.toLowerCase());
  }
  // G3 + Q5: account-level last touch. Counts outbound touches, meetings that happened (calendar, or meeting_proposed once its
  // meeting_date has passed), To Do edits on that account's tasks, and time entries with that account. Inbound touches don't count.
  function lastTouch(account, s, ctx) {
    let d = null; const up = x => { if (x && x <= ctx.today && (!d || x > d)) d = x; };
    (s.touches || []).forEach(t => { if (t.account !== account) return;
      if (t.kind === "meeting_proposed") { if (t.meeting_date) up(t.meeting_date); return; }
      if (t.direction === "outbound") up(t.date); });
    (s.calendar || []).forEach(ev => { if (ev.account === account && (!ctx.nowIso || new Date(ev.start) <= new Date(ctx.nowIso))) up(isoDay(ev.start)); });
    (s.items || []).forEach(it => { if (it.account === account) up(it.lastModified); });
    (ctx.timeEntries || []).forEach(e => { if (e.account === account) up(e.date); });
    return d;
  }
  function keyCold(account, s, ctx) { const d = lastTouch(account, s, ctx); return { cold: !d || diffDays(ctx.today, d) >= COLD_DAYS, last: d, days: d ? diffDays(ctx.today, d) : null }; }
  // Dashboard-side overlays from the synced flag events, reconciled with the snapshot. To Do always wins:
  //  done:<id>   hidden until a snapshot shows the task done/removed (overlay cleared) or edited in To Do after the Done (reopened)
  //  snooze:<id> hidden until "until"; cleared when To Do re-dates the task or closes it
  function overlays(flags, s, nowIso) {
    const byId = new Map((s.items || []).map(it => [it.id, it])), out = { hidden: new Set(), doneHere: [], reopened: new Set(), snoozed: new Map(), starred: new Set(), internal: new Set(), cleared: [] };
    const gen = Date.parse(s.generatedAt), now = Date.parse(nowIso);
    (flags instanceof Map ? [...flags.entries()] : Object.entries(flags || {})).forEach(([id, f]) => {
      if (!f || f.on !== true) return;
      const i = id.indexOf(":"), kind = id.slice(0, i), key = id.slice(i + 1);
      if (kind === "star") { out.starred.add(key); return; }
      if (kind === "internal") { out.internal.add(key.toLowerCase()); return; }
      const it = byId.get(key);
      if (kind === "done") {
        if (!it || it.status === "done") { out.cleared.push(id); return; }
        if (f.snapAt && gen > Date.parse(f.snapAt) && it.lastModifiedAt && Date.parse(it.lastModifiedAt) > Date.parse(f.at)) { out.reopened.add(key); return; }
        out.hidden.add(key); out.doneHere.push(key); return;
      }
      if (kind === "snooze") {
        if (!it || it.status === "done" || (f.due || null) !== (it.due || null)) { out.cleared.push(id); return; }
        if (Date.parse(f.until) > now) out.snoozed.set(key, f.until);
      }
    });
    return out;
  }
  const FOCUS_SECTIONS = ["dueToday", "overdue", "owed", "waiting", "cold", "travel"];
  // The full Daily Focus model. s = readSnapshot() result; ctx = {today, nowIso, timeEntries}; ov = overlays(); opts = {cap, expanded:Set, history}.
  function focusSections(s, ctx, ov, opts) {
    opts = opts || {}; ov = ov || overlays({}, s, ctx.nowIso);
    const cap = opts.cap > 0 ? opts.cap : 12, today = ctx.today, sun = sundayOf(today), wk7 = addDays(today, 7);
    const open = s.items.filter(it => isOpen(it) && !ov.hidden.has(it.id));
    const live = open.filter(it => !ov.snoozed.has(it.id)), used = new Set(), sec = {};
    const take = (key, rows) => { sec[key] = rows; rows.forEach(r => r.it && used.add(r.it.id)); };
    const row = (it, status, extra) => Object.assign({ it, id: it.id, status, account: it.account, person: it.person, title: it.title, reopened: ov.reopened.has(it.id) }, extra || {});
    take("dueToday", live.filter(it => it.due === today && it.list !== "Waiting on").sort(sortItems).map(it => row(it, "today", { when: { kind: "today" } })));
    take("overdue", live.filter(it => it.due && it.due < today && it.list !== "Waiting on").sort(sortItems).map(it => row(it, "overdue", { when: { kind: "late", days: diffDays(today, it.due) } })));
    take("owed", live.filter(it => !used.has(it.id) && (it.list === "Follow-ups" || it.list === "Account touches") && ["not_started", "in_progress"].includes(it.status) && isOutside(it, ov.internal) && (!it.due || it.due > today))
      .sort(sortItems).map(it => row(it, !it.due || it.due <= sun ? "week" : "later", { when: it.due ? { kind: "day", day: it.due } : { kind: "nodate" } })));
    take("waiting", live.filter(it => !used.has(it.id) && it.list === "Waiting on" && it.due && it.due <= today).sort(sortItems).map(it => row(it, "waiting", { when: { kind: "was", day: it.due } })));
    const cold = [];
    [...ov.starred].sort().forEach(name => {
      if (!s.accounts.some(a => a.name === name)) return;
      const k = keyCold(name, s, ctx); if (!k.cold) return;
      const tasks = open.filter(it => it.account === name).sort((a, b) => (a.lastModifiedAt || "") < (b.lastModifiedAt || "") ? -1 : (a.lastModifiedAt || "") > (b.lastModifiedAt || "") ? 1 : a.id.localeCompare(b.id));
      const t = tasks.find(it => !used.has(it.id) && !ov.snoozed.has(it.id)), dated = tasks.some(it => it.due);
      if (t) cold.push(row(t, "cold", { coldDays: k.days, coldLast: k.last, when: t.due ? { kind: "day", day: t.due } : { kind: "nodate" } }));
      else cold.push({ it: null, id: "acct:" + name, status: "cold", account: name, person: null, title: "Log a touch", synthetic: true, coldDays: k.days, coldLast: k.last, when: { kind: "notouch", nodate: !dated } });
    });
    take("cold", cold.sort((a, b) => (b.coldDays === null ? 1e9 : b.coldDays) - (a.coldDays === null ? 1e9 : a.coldDays) || a.account.localeCompare(b.account)));
    const trav = live.filter(it => !used.has(it.id) && it.list === "Travel" && it.due && it.due >= today && it.due <= wk7).sort(sortItems).map(it => row(it, "travel", { when: { kind: "day", day: it.due } }));
    const travDays = new Set(s.items.filter(it => it.list === "Travel" && isOpen(it) && it.due).map(it => it.due));
    (s.calendar || []).forEach(ev => { const d = isoDay(ev.start); if (d < today || d > wk7 || travDays.has(d) || guessSubject(ev.title).value !== "Admin/travel") return;
      trav.push({ it: null, id: "cal:" + ev.id, status: "travel", account: ev.account || null, person: null, title: ev.title, calendar: true, when: { kind: "day", day: d } }); });
    take("travel", trav.sort((a, b) => a.when.day < b.when.day ? -1 : a.when.day > b.when.day ? 1 : a.id.localeCompare(b.id)));
    // Later this week (collapsed): open, due tomorrow..Sunday, not shown above; snoozed items that come back this week are listed here too.
    const later = open.filter(it => !used.has(it.id) && ((!ov.snoozed.has(it.id) && it.due && it.due > today && it.due <= sun) || (ov.snoozed.has(it.id) && ymd(new Date(ov.snoozed.get(it.id))) <= sun)))
      .sort(sortItems).map(it => row(it, ov.snoozed.has(it.id) ? "later" : "week", { when: it.due ? { kind: "day", day: it.due } : { kind: "nodate" }, snoozedUntil: ov.snoozed.get(it.id) || null }));
    // §8: open Follow-ups / Account touches / Waiting on / Travel items with no date that aren't in a section -> footer list.
    const noDate = open.filter(it => !used.has(it.id) && !it.due && !ov.snoozed.has(it.id)).sort(sortItems);
    // Row cap (§3): every non-empty section gets at least 1 row (Due Today and Overdue at least 3), then fill in section order.
    const exp = opts.expanded || new Set(), shown = {}; let budget = cap;
    FOCUS_SECTIONS.forEach(k => { const min = Math.min(sec[k].length, k === "dueToday" || k === "overdue" ? 3 : 1); shown[k] = exp.has(k) ? sec[k].length : min; budget -= shown[k]; });
    FOCUS_SECTIONS.forEach(k => { if (exp.has(k)) return; const add = Math.max(0, Math.min(sec[k].length - shown[k], budget)); shown[k] += add; budget -= add; });
    const sections = FOCUS_SECTIONS.map(k => ({ key: k, total: sec[k].length, rows: sec[k].slice(0, shown[k]), more: sec[k].length - shown[k] }));
    // Squares: full counts after overlays. Delta (§7, Q6): snapshot-only Due Today total vs the previous business day's latest snapshot.
    const counts = { dueToday: sec.dueToday.length, overdue: sec.overdue.length, waiting: sec.waiting.length, cold: sec.cold.length };
    const snapDue = totals(s.items, { today, calendar: s.calendar, timeEntries: [] }).dueToday;
    const doneDueToday = s.items.filter(it => isOpen(it) && ov.hidden.has(it.id) && it.due === today && it.list !== "Waiting on").length;
    return { sections, counts, later, noDate, delta: focusDelta(opts.history || [], today, snapDue), snapDueToday: snapDue, doneDueToday, doneHere: ov.doneHere.length, cap };
  }
  // Previous business day = the weekday before today (Monday -> Friday). Uses the latest history snapshot from that day up to
  // (not including) today; none -> null (the chip is hidden).
  function focusDelta(history, today, cur) {
    const pb = prevBusinessDay(today); let best = null;
    (history || []).forEach(h => { const d = isoDay(h.generated_at); if (d >= pb && d < today && h.totals && typeof h.totals.dueToday === "number" && (!best || new Date(h.generated_at) > new Date(best.generated_at))) best = h; });
    if (!best) return null;
    const d = cur - best.totals.dueToday;
    return { delta: d, text: d > 0 ? `▲+${d}` : d < 0 ? `▼−${-d}` : "=0", basisDay: isoDay(best.generated_at) };
  }

  // 00.05.003 Today's Clear: progress through what's due today + overdue (not Waiting on), counted against the first snapshot
  // seen today (baseIds, kept per day on this computer). Cleared = done in To Do today or ✓ Done here; snoozed never counts.
  function todaysClear(s, today, ov, baseIds) {
    const inScope = it => it.due && it.due <= today && it.list !== "Waiting on";
    const scope = s.items.filter(it => inScope(it) && (isOpen(it) || it.completedOn === today));
    const base = baseIds ? new Set(baseIds) : null, ticks = [];
    let done = 0, snoozed = 0, overdueOpen = 0, added = 0;
    scope.forEach(it => {
      let st;
      if (!isOpen(it) || ov.hidden.has(it.id)) { st = "done"; done++; }
      else if (ov.snoozed.has(it.id)) { st = "snoozed"; snoozed++; }
      else if (it.due < today) { st = "over"; overdueOpen++; }
      else st = "open";
      if (base && !base.has(it.id)) added++;
      ticks.push({ id: it.id, state: st });
    });
    const order = { done: 0, snoozed: 1, open: 2, over: 3 };
    ticks.sort((a, b) => order[a.state] - order[b.state] || a.id.localeCompare(b.id));
    const total = scope.length, pct = total ? (done === total ? 100 : Math.min(99, Math.floor(done / total * 100))) : 0;
    const parts = [`${done} of ${total} cleared`]; if (snoozed) parts.push(`${snoozed} snoozed`); if (overdueOpen) parts.push(`${overdueOpen} overdue still open`); if (added) parts.push(`${added} added today`);
    return { total, done, snoozed, overdueOpen, open: total - done - snoozed, added, pct, ticks, ids: scope.map(it => it.id), text: parts.join(", ") };
  }

  // ---------- 00.06.000 calendar feed + trips (Travel); docs: /docs/calendar-feed-schema.md ----------
  const ISO_OFF = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([+-]\d{2}:\d{2}|Z)$/, DOM = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
  const TEAMS_OK = u => typeof u === "string" && /^https:\/\/teams\.microsoft\.com\/[^\s"'<>]*$/.test(u);
  const MAP_OK = u => typeof u === "string" && /^https:\/\/(maps\.apple\.com)[\/?][^\s"'<>]*$/.test(u);
  const SEG_KINDS = ["flight", "hotel", "event", "drive"], NO_FIELDS = /confirm|pnr|record_?loc|loyalty|seat|ticket|passport/i;
  const str = (v, n) => typeof v === "string" ? v.slice(0, n) : null;
  function readCalendar(raw) {
    if (!raw || typeof raw !== "object" || raw.schema_version !== 1) throw new Error("calendar-snapshot: schema_version must be 1");
    if (!ISO_OFF.test(raw.generated_at || "")) throw new Error("calendar-snapshot: generated_at must be ISO with offset");
    if (!Array.isArray(raw.events)) throw new Error("calendar-snapshot: events must be an array");
    const rejects = [], events = [];
    raw.events.forEach((e, i) => {
      const bad = m => rejects.push(`event ${i + 1}: ${m}`);
      if (!e || typeof e.id !== "string" || !e.id) return bad("id missing");
      if (typeof e.title !== "string") return bad("title missing");
      if (!ISO_OFF.test(e.start || "") || !ISO_OFF.test(e.end || "") || !(Date.parse(e.end) > Date.parse(e.start))) return bad("start/end must be ISO with offset, end after start");
      const doms = Array.isArray(e.attendeeDomains) ? e.attendeeDomains : [];
      if (doms.some(d => typeof d !== "string" || d.includes("@") || !DOM.test(d))) return bad("attendeeDomains must be lower-case domains only (no names or emails)");
      if (e.attendees !== undefined || e.organizer !== undefined) return bad("names/emails are not accepted (use attendeeDomains, attendeeCount, organizerDomain)");
      if (e.organizerDomain != null && (typeof e.organizerDomain !== "string" || !DOM.test(e.organizerDomain))) return bad("organizerDomain must be a domain");
      events.push({ id: e.id, title: e.title.slice(0, 200), start: e.start, end: e.end, allDay: e.allDay === true, location: str(e.location, 200),
        organizerDomain: e.organizerDomain || null, attendeeDomains: [...new Set(doms)], attendeeCount: Number.isInteger(e.attendeeCount) && e.attendeeCount >= 0 ? e.attendeeCount : doms.length,
        teamsUrl: TEAMS_OK(e.teamsUrl) ? e.teamsUrl : null, bodyExcerpt: str(e.bodyExcerpt, 280), isPrivateHold: e.isPrivateHold === true,
        accountLabel: str(e.accountLabel, 120), linkedTodoIds: Array.isArray(e.linkedTodoIds) ? e.linkedTodoIds.filter(x => typeof x === "string") : [], calendar: e.calendar === "travel" ? "travel" : "main" });
    });
    return { generatedAt: raw.generated_at, source: str(raw.source, 40) || "outlook-web", events, rejects };
  }
  function readTrips(raw) {
    if (!raw || typeof raw !== "object" || raw.schema_version !== 1) throw new Error("trips: schema_version must be 1");
    if (!ISO_OFF.test(raw.generated_at || "")) throw new Error("trips: generated_at must be ISO with offset");
    if (!Array.isArray(raw.trips)) throw new Error("trips: trips must be an array");
    const rejects = [], trips = [];
    raw.trips.forEach((t, i) => {
      if (!t || typeof t.id !== "string" || !Array.isArray(t.segments)) { rejects.push(`trip ${i + 1}: id/segments missing`); return; }
      const segs = [];
      t.segments.forEach((g, j) => {
        const bad = m => rejects.push(`trip ${i + 1} segment ${j + 1}: ${m}`);
        if (!g || !SEG_KINDS.includes(g.kind)) return bad("kind must be flight, hotel, event or drive");
        if (Object.keys(g).some(k => NO_FIELDS.test(k))) return bad("confirmation / booking numbers are not accepted");
        if (!ISO_OFF.test(g.start || "") || !ISO_OFF.test(g.end || "") || !(Date.parse(g.end) >= Date.parse(g.start))) return bad("start/end must be ISO with offset");
        segs.push({ kind: g.kind, start: g.start, end: g.end, tz: str(g.tz, 64), from: str(g.from, 60), to: str(g.to, 60), airline: str(g.airline, 40), number: str(g.number, 12),
          place: str(g.place, 120), mapUrl: MAP_OK(g.mapUrl) ? g.mapUrl : null, cancelBy: ISO_OFF.test(g.cancelBy || "") ? g.cancelBy : null, driveMin: Number.isInteger(g.driveMin) && g.driveMin >= 0 ? g.driveMin : null });
      });
      trips.push({ id: t.id, name: str(t.name, 120) || "Trip", homeTz: str(t.homeTz, 64), segments: segs.sort((a, b) => Date.parse(a.start) - Date.parse(b.start)), openLoops: Array.isArray(t.openLoops) ? t.openLoops.filter(x => typeof x === "string") : [] });
    });
    return { generatedAt: raw.generated_at, trips, rejects };
  }
  // The inbox snapshot's calendar[] (7 days, domains only) as feed events: the fallback until the calendar feed is there.
  function eventsFromSnapshot(s) {
    return (s && s.calendar || []).map(e => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: false, location: e.location || null, organizerDomain: null,
      attendeeDomains: e.attendee_domains || [], attendeeCount: (e.attendee_domains || []).length, teamsUrl: null, bodyExcerpt: null, isPrivateHold: !(e.attendee_domains || []).length,
      accountLabel: e.account || null, linkedTodoIds: [], calendar: "main" }));
  }
  function mergeEvents(feed, snapEvents) { const m = new Map(); (snapEvents || []).forEach(e => m.set(e.id, e)); (feed || []).forEach(e => m.set(e.id, e)); return [...m.values()]; }
  function staleness(generatedAt, nowIso) { const h = (Date.parse(nowIso) - Date.parse(generatedAt)) / 3600000; return { hours: h, level: h > 24 ? "red" : h > 6 ? "amber" : "ok" }; }
  // Overlapping events sit side by side: clusters of overlapping events share the width, each event gets the first free column.
  function layoutLanes(evs) {
    const out = evs.slice().sort((a, b) => a.s - b.s || b.e - a.e || a.id.localeCompare(b.id)); let cluster = [], end = -1;
    const close = () => { const n = Math.max(1, ...cluster.map(x => x.col + 1)); cluster.forEach(x => x.cols = n); cluster = []; };
    out.forEach(ev => {
      if (ev.s >= end && cluster.length) close();
      const used = new Set(cluster.filter(x => x.e > ev.s).map(x => x.col)); let c = 0; while (used.has(c)) c++;
      ev.col = c; cluster.push(ev); end = Math.max(end, ev.e);
    });
    if (cluster.length) close();
    return out;
  }
  // Today strip model. Hours = 07–19 in this computer's zone, widened to the first start / last end of today's events and travel.
  function todayStrip(events, trips, items, today, nowIso, opts) {
    opts = opts || {}; const r = opts.rules || DEFAULT_RULES, bufferMin = opts.flightBufferMin == null ? 90 : opts.flightBufferMin;
    const dayOf = iso => isoDay(iso), H = iso => { const d = dayOf(iso); return d < today ? 0 : d > today ? 24 : hourCT(iso); };
    const allDay = [], timed = [];
    (events || []).forEach(e => {
      if (!(dayOf(e.start) <= today && dayOf(e.end) >= today)) return;
      const s = H(e.start), en = dayOf(e.end) > today ? 24 : hourCT(e.end); if (en <= s && !e.allDay) return;
      const ext = (e.attendeeDomains || []).filter(d => !isInternal(d, r)), kind = e.isPrivateHold || (!(e.attendeeDomains || []).length && !e.accountLabel) ? "hold" : e.accountLabel || ext.length ? "client" : "internal";
      const ev = Object.assign({}, e, { s, e: en, kind });
      (e.allDay ? allDay : timed).push(ev);
    });
    const lanes = layoutLanes(timed);
    lanes.forEach(a => { a.conflict = a.kind !== "hold" && lanes.some(b => b !== a && b.kind !== "hold" && b.s < a.e && a.s < b.e); });
    const travel = [], hotels = [];
    (trips || []).forEach(t => t.segments.forEach((g, i) => {
      if (!(dayOf(g.start) <= today && dayOf(g.end) >= today)) return;
      if (g.kind === "hotel") { hotels.push(Object.assign({ trip: t.name, tripId: t.id }, g)); return; }   // a hotel is a chip, not a band (it spans the night)
      const s = H(g.start), en = dayOf(g.end) > today ? 24 : Math.max(hourCT(g.end), s + 0.25);
      const seg = Object.assign({ trip: t.name, tripId: t.id }, g, { s, e: en });
      if (g.kind === "flight" && dayOf(g.start) === today) {
        const prev = t.segments[i - 1], drive = prev && prev.kind === "drive" ? (prev.driveMin != null ? prev.driveMin : Math.round((Date.parse(prev.end) - Date.parse(prev.start)) / 60000)) : 0;
        seg.leaveBy = new Date(Date.parse(g.start) - (bufferMin + drive) * 60000).toISOString(); seg.driveBefore = drive;
      }
      travel.push(seg);
    }));
    const band = timed.concat(travel), lo = Math.min(7, ...band.map(x => x.s > 0 ? Math.floor(x.s) : Math.max(0, Math.ceil(x.e) - 1))), hi = Math.max(19, ...band.map(x => x.e < 24 ? Math.ceil(x.e) : Math.min(24, Math.floor(x.s) + 1)));   // started yesterday / ends tomorrow: show its last / first hour
    const open = (items || []).filter(it => isOpen(it) && it.list !== "Waiting on" && it.due && it.due <= today);
    const leave = travel.filter(x => x.leaveBy).sort((a, b) => a.leaveBy < b.leaveBy ? -1 : 1)[0] || null;
    return { from: Math.max(0, lo), to: Math.min(24, hi), events: lanes, allDay, travel, hotels, leaveBy: leave ? leave.leaveBy : null,
      dueToday: open.filter(it => it.due === today).map(it => it.id), overdue: open.filter(it => it.due < today).map(it => it.id), now: dayOf(nowIso) === today ? hourCT(nowIso) : null };
  }


  // ---------- 00.07.000 Projects: a read-only mirror of Microsoft Planner (export only, nothing is written back) ----------
  // projects.json (schema_version 1) is read only when encrypted (purpose "projects"). Owners are names, never emails.
  const PROJ_STATUS = ["notStarted", "inProgress", "completed"], PROJ_PRI = ["urgent", "important", "medium", "low"];
  const PROJ_STATUS_WORD = { notStarted: "Not started", inProgress: "In progress", completed: "Completed" };
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const ownerOk = v => typeof v === "string" && !!v.trim() && v.length <= 80 && !hasEmail(v);
  function readProjects(raw) {
    if (!raw || typeof raw !== "object" || raw.schema_version !== 1) throw new Error("projects: schema_version must be 1");
    if (!ISO_OFF.test(raw.generated_at || "")) throw new Error("projects: generated_at must be ISO with offset");
    if (!Array.isArray(raw.plans)) throw new Error("projects: plans must be an array");
    const rejects = [], plans = [];
    raw.plans.forEach((p, i) => {
      if (!p || typeof p.id !== "string" || !p.id || typeof p.name !== "string" || !Array.isArray(p.tasks)) { rejects.push(`plan ${i + 1}: id/name/tasks missing`); return; }
      const buckets = (Array.isArray(p.buckets) ? p.buckets : []).filter(b => b && typeof b.id === "string" && typeof b.name === "string").map(b => ({ id: b.id, name: b.name.slice(0, 80) }));
      const bIds = new Set(buckets.map(b => b.id)), tasks = [], seen = new Set();
      p.tasks.forEach((t, j) => {
        const bad = m => rejects.push(`plan ${i + 1} task ${j + 1}: ${m}`);
        if (!t || typeof t.id !== "string" || !t.id || seen.has(t.id)) return bad("id missing or repeated");
        if (typeof t.title !== "string" || !t.title.trim()) return bad("title missing");
        if (t.assigneeEmails !== undefined || t.emails !== undefined) return bad("emails are not accepted (assignees are names only)");
        const as = Array.isArray(t.assignees) ? t.assignees : [];
        if (as.some(a => !ownerOk(a))) return bad("assignees must be names (no '@')");
        if (!PROJ_STATUS.includes(t.status)) return bad("status must be notStarted, inProgress or completed");
        for (const k of ["start", "due"]) if (t[k] != null && !(DAY_RE.test(t[k]) && realDay(t[k]))) return bad(`${k} must be YYYY-MM-DD`);
        if (t.start && t.due && t.due < t.start) return bad("due is before start");
        const pct = t.percent == null ? (t.status === "completed" ? 100 : t.status === "inProgress" ? 50 : 0) : t.percent;
        if (!Number.isFinite(pct) || pct < 0 || pct > 100) return bad("percent must be 0–100");
        const ck = t.checklist && Number.isInteger(t.checklist.done) && Number.isInteger(t.checklist.total) && t.checklist.total >= 0 && t.checklist.done >= 0 && t.checklist.done <= t.checklist.total ? { done: t.checklist.done, total: t.checklist.total } : null;
        seen.add(t.id);
        tasks.push({ id: t.id, title: t.title.slice(0, 200), bucketId: bIds.has(t.bucketId) ? t.bucketId : null, assignees: [...new Set(as.map(a => a.trim()))], status: t.status, percent: Math.round(pct),
          start: t.start || null, due: t.due || null, priority: PROJ_PRI.includes(t.priority) ? t.priority : "medium", labels: Array.isArray(t.labels) ? t.labels.filter(x => typeof x === "string").map(x => x.slice(0, 40)) : [],
          checklist: ck, account: str(t.account, 120), completedOn: DAY_RE.test(t.completedOn || "") ? t.completedOn : null });
      });
      plans.push({ id: p.id, name: p.name.slice(0, 120), buckets, tasks });
    });
    return { generatedAt: raw.generated_at, source: str(raw.source, 40) || "planner-export", plans, rejects };
  }
  // Effective owner: a local assignment (owners map, taskId -> name; "" = cleared) wins over Planner's assignees.
  function projectOwner(t, owners) { const o = owners && Object.prototype.hasOwnProperty.call(owners, t.id) ? owners[t.id] : null; return o != null && o !== "" ? o : (o === "" ? "" : t.assignees.join(", ")); }
  function projectDueWord(t, today) { if (t.status === "completed") return "Done"; if (!t.due) return "No date"; const d = diffDays(t.due, today); return d < 0 ? "Overdue" : d === 0 ? "Today" : d <= 7 ? "This week" : "Later"; }
  // Rows for one plan (or all), filtered by owner (exact, case-insensitive; "(unassigned)" = no owner) and completed toggle.
  function projectRows(feed, opts) {
    const o = opts || {}, today = o.today, owners = o.owners || {}, want = (o.owner || "").trim().toLowerCase();
    const out = [];
    (feed ? feed.plans : []).forEach(p => { if (o.planId && p.id !== o.planId) return;
      const bName = id => (p.buckets.find(b => b.id === id) || {}).name || "No bucket";
      p.tasks.forEach(t => {
        if (!o.showCompleted && t.status === "completed") return;
        const owner = projectOwner(t, owners), list = owner ? owner.split(", ").map(x => x.toLowerCase()) : [];
        if (want && !(want === "(unassigned)" ? !owner : list.includes(want))) return;
        out.push(Object.assign({}, t, { plan: p.name, planId: p.id, bucket: bName(t.bucketId), bucketOrder: t.bucketId ? p.buckets.findIndex(b => b.id === t.bucketId) : 999, owner, ownerLocal: Object.prototype.hasOwnProperty.call(owners, t.id), dueWord: projectDueWord(t, today) }));
      }); });
    return out.sort((a, b) => a.plan.localeCompare(b.plan) || a.bucketOrder - b.bucketOrder || (a.due || "9999").localeCompare(b.due || "9999") || a.id.localeCompare(b.id));
  }
  function projectSummary(rows) { const s = { total: rows.length, overdue: 0, today: 0, inProgress: 0, notStarted: 0, completed: 0, unassigned: 0 };
    rows.forEach(r => { if (r.dueWord === "Overdue") s.overdue++; if (r.dueWord === "Today") s.today++; s[r.status]++; if (!r.owner) s.unassigned++; }); return s; }
  function projectOwnerChoices(feed, configured, owners) {
    const set = new Map(); const add = n => { if (ownerOk(n)) { const k = n.trim().toLowerCase(); if (!set.has(k)) set.set(k, n.trim()); } };
    (configured || []).forEach(add); (feed ? feed.plans : []).forEach(p => p.tasks.forEach(t => t.assignees.forEach(add))); Object.values(owners || {}).forEach(add);
    return [...set.values()].sort((a, b) => a.localeCompare(b));
  }
  const PROJ_CSV_COLS = ["plan", "bucket", "task_id", "title", "owner", "owner_source", "status", "percent", "priority", "start", "due", "due_word", "checklist", "labels", "account"];
  function projectsCSV(rows) {
    return PROJ_CSV_COLS.join(",") + "\r\n" + rows.map(r => [r.plan, r.bucket, r.id, r.title, r.owner, r.ownerLocal ? "dashboard" : "planner", PROJ_STATUS_WORD[r.status], r.percent, r.priority, r.start || "", r.due || "", r.dueWord,
      r.checklist ? `${r.checklist.done}/${r.checklist.total}` : "", r.labels.join("; "), r.account || ""].map(csvCell).join(",")).join("\r\n") + "\r\n";
  }


  // ---------- 00.07.000 rev 2: Projects is the source of truth (store), Planner-ready exports (CSV, xlsx, Graph JSON) ----------
  // Pricing guard (P1). Text is NFKC-normalised first, so full-width ＄ ＠ ０-９ count as $ @ 0-9.
  const CUR_SYM = "$€£¥₹₩₽¢", CUR_CODE = "USD|CAD|EUR|GBP|AUD|NZD|JPY|CNY|RMB|MXN|INR|CHF|SEK|NOK|DKK|BRL|KRW|SGD|HKD|ZAR";
  const NUM = String.raw`\d[\d,]*(?:\.\d+)?`, MULT = String.raw`(?:\s?(?:[kKmMbB]|mm|thousand|million|billion|grand))?`;
  const SPELLED = "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|a few|several";
  const MONEY_RES = [
    new RegExp(`[${CUR_SYM}]\\s?\\d`),                                                     // currency symbol before the number (any width)
    new RegExp(`\\d${MULT}\\s?[${CUR_SYM}]`),                                              // currency symbol after the number
    new RegExp(`\\b(?:${CUR_CODE})\\s?\\$?\\s?\\d`, "i"),                                   // ISO code before the number
    new RegExp(`${NUM}${MULT}\\s?(?:${CUR_CODE}|dollars?|bucks|euros?|pounds? sterling|cents?)\\b`, "i"),   // number then code or word
    new RegExp(`\\b(?:${SPELLED})\\b(?:[\\s-]+[a-z]+){0,4}?[\\s-]+(?:dollars?|bucks|euros?|grand)\\b`, "i"), // spelled-out amounts
    new RegExp(`\\b(?:prices?|priced|pricing|costs?|costing|quoted?|quotes|budget(?:ed)?|fees?|msrp|list price|discount(?:ed)?|invoice[sd]?|po value|total cost)\\b\\s*(?:is|was|of|at|to|=|:|~|about|around|approx\\.?)?\\s*~?\\s*\\d`, "i"), // a price word then a number
    new RegExp(`\\b\\d{1,3}(?:,\\d{3})+\\.\\d{2}\\b`),                                      // 1,234.00
    new RegExp(`\\b\\d{1,3}(?:\\.\\d{3})+,\\d{2}\\b`),                                      // 1.234,00 (European)
    new RegExp(`\\b\\d[\\d,.]*\\s+grand\\b`, "i"),                                          // 9 grand
    new RegExp(`\\b(?:dollars?|bucks|euros?|${CUR_CODE})\\s*[:=]?\\s*\\d`, "i"),                  // dollars 500
  ];
  // Bare two-decimal numbers (P1b/P1c): "12.50" or "75.00" alone reads as money, but versions, steps, floors, times and
  // measurements don't. Rule: integer part of 2+ digits, not after a version/step/floor-type word, not before a unit or AM/PM.
  // So 1.00, 2.00 and other single-digit values are never flagged on their own (a price that small still needs $, USD, "price"…).
  const BARE_DEC = /(?<![\d.,])(\d{2,})\.(\d{2})(?![\d.,]|\s*(?:ft|feet|foot|in|inch|inches|mm|cm|m|km|mi|am|pm|a\.m|p\.m|%|l|ml|kg|g|lb|lbs|s|sec|min|h|hr|hrs|hz|khz|mhz|v|ma|a|w|kw|°|deg|psi|pa|bar|cfm|db)\b)/i;
  const BARE_DEC_WORDS = /\b(?:version|ver|v|rev|revision|release|step|floor|level|zone|node|loop|item|section|sec|no|number|page|pg|sheet|figure|fig|table|chapter|clause|para|room|rm|bay|grid|row|col|line|pin|port|slot)\.?\s*#?\s*$/i;
  function bareDecimalMoney(t) { const re = new RegExp(BARE_DEC.source, "gi"); let m; while ((m = re.exec(t))) { if (!BARE_DEC_WORDS.test(t.slice(0, m.index))) return true; } return false; }
  const ZW = /[\u200B-\u200D\u2060\uFEFF\u00AD\u180E]/g;
  const clean = v => v.normalize("NFKC").replace(ZW, "");
  const hasMoney = v => { if (typeof v !== "string") return false; const t = clean(v); return MONEY_RES.some(r => r.test(t)) || bareDecimalMoney(t); };
  // Email guard (P2): @ (any width), [at] (at) {at}, "x AT y DOT z", %40.
  // Email guard (P2/P2b): @ (any width), &#64; / &commat;, %40, [at] (at) {at} <at>, "name at host.tld" (a real dot between
  // host parts, spaces allowed: "jane.doe at contoso . com"), and the spelled-out "jane at contoso dot com" form in any case, which must end in a
  // domain-ending word (com, net, org, io, uk, example…), so "Walk at noon dot plan" is not an address.
  const EMAIL_RES = [/@/, /&#0*64;|&#x0*40;|&commat;/i, /%40/i, /[\[({<]\s*at\s*[\])}>]/i,
    /\b[\w.+-]+\s+at\s+[a-z][\w-]*(?:\s*\.\s*[a-z][\w-]*)*\s*\.\s*[a-z]{2,24}\b/i,
    /\b[\w.+-]+\s+at\s+[a-z][\w-]*(?:\s+dot\s+[a-z][\w-]*)*\s+dot\s+(?:com|net|org|edu|gov|mil|int|io|co|us|uk|ca|au|de|fr|es|it|nl|be|ch|se|no|dk|fi|ie|jp|cn|in|mx|br|biz|info|me|ai|app|dev|tech|cloud|example|test|local)\b/i];   // E3: spelled-out form, any case, must end in a domain-ending word
  const hasEmail = v => typeof v === "string" && EMAIL_RES.some(r => r.test(clean(v)));
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  // Validates one task; returns an error string or null. Used on every save and when reading the store.
  function taskProblem(t, bucketIds) {
    if (!t || !ID_RE.test(t.id || "")) return "id missing";
    if (typeof t.title !== "string" || !t.title.trim()) return "title is required";
    if (t.title.length > 255) return "title is too long (255 max)";
    if (bucketIds && t.bucketId != null && !bucketIds.has(t.bucketId)) return "unknown bucket";
    if (!Array.isArray(t.assignees) || t.assignees.some(a => !ownerOk(a))) return "owners must be names (no '@')";
    if (!PROJ_STATUS.includes(t.status)) return "status must be notStarted, inProgress or completed";
    for (const k of ["start", "due"]) if (t[k] != null && !(DAY_RE.test(t[k]) && realDay(t[k]))) return `${k} must be a real date (YYYY-MM-DD)`;
    if (t.start && t.due && t.due < t.start) return "due is before start";
    if (!Number.isFinite(t.percent) || t.percent < 0 || t.percent > 100) return "percent must be 0–100";
    if (!PROJ_PRI.includes(t.priority)) return "priority must be urgent, important, medium or low";
    if (!Array.isArray(t.checklist) || t.checklist.length > 20 || t.checklist.some(c => !c || !ID_RE.test(c.id || "") || typeof c.title !== "string" || !c.title.trim() || c.title.length > 100 || typeof c.done !== "boolean")) return "checklist items need a title (100 max, 20 items max)";
    if (t.notes != null && (typeof t.notes !== "string" || t.notes.length > 2000)) return "notes are too long";
    const texts = [t.title, t.notes || "", t.account || ""].concat(t.labels || [], t.checklist.map(c => c.title));
    if (texts.some(hasMoney)) return "no pricing or dollar figures in projects";
    if (texts.concat(t.assignees).some(hasEmail)) return "no email addresses in projects";
    return null;
  }
  function namedProblem(n, what) { if (typeof n !== "string" || !n.trim()) return `${what} name is required`; if (n.length > 100) return `${what} name is too long`; if (hasMoney(n)) return "no pricing or dollar figures in projects"; if (hasEmail(n)) return "no email addresses in projects"; return null; }
  function readStore(raw) {
    if (!raw || typeof raw !== "object" || raw.schema_version !== 1) throw new Error("projects-store: schema_version must be 1");
    if (!ISO_OFF.test(raw.updated_at || "")) throw new Error("projects-store: updated_at must be ISO with offset");
    if (!Array.isArray(raw.plans)) throw new Error("projects-store: plans must be an array");
    const rejects = [], plans = [];
    raw.plans.forEach((p, i) => {
      if (!p || !ID_RE.test(p.id || "") || namedProblem(p.name, "plan") || !Array.isArray(p.buckets) || !Array.isArray(p.tasks)) { rejects.push(`plan ${i + 1}: id/name/buckets/tasks missing or invalid`); return; }
      const buckets = p.buckets.filter(b => b && ID_RE.test(b.id || "") && !namedProblem(b.name, "bucket")).map(b => ({ id: b.id, name: b.name }));
      const bIds = new Set(buckets.map(b => b.id)), seen = new Set(), tasks = [];
      p.tasks.forEach((t, j) => { const e = taskProblem(t, bIds) || (seen.has(t.id) ? "id repeated" : null); if (e) { rejects.push(`plan ${i + 1} task ${j + 1}: ${e}`); return; } seen.add(t.id); tasks.push(normTask(t)); });
      plans.push({ id: p.id, name: p.name, buckets, tasks });
    });
    return { schema_version: 1, updated_at: raw.updated_at, plans, rejects };
  }
  function normTask(t) { return { id: t.id, title: t.title.trim(), bucketId: t.bucketId || null, assignees: [...new Set((t.assignees || []).map(a => a.trim()))], status: t.status, percent: Math.round(t.percent),
    start: t.start || null, due: t.due || null, priority: t.priority, labels: (t.labels || []).filter(x => typeof x === "string" && x.trim()).map(x => x.trim().slice(0, 40)), notes: t.notes || "", account: t.account || null,
    checklist: t.checklist.map(c => ({ id: c.id, title: c.title.trim(), done: c.done })), completedOn: DAY_RE.test(t.completedOn || "") ? t.completedOn : null }; }
  // Optional import: a Planner export feed (readProjects result) into the store. Checklist counts become placeholder items only if
  // the feed has no item titles (Planner exports counts), so they are skipped; the store keeps its own task when the ids match.
  function storeFromFeed(feed, store, nowIso) {
    const out = store ? JSON.parse(JSON.stringify({ schema_version: 1, updated_at: store.updated_at, plans: store.plans })) : { schema_version: 1, updated_at: nowIso, plans: [] };
    let added = 0;
    feed.plans.forEach(fp => {
      let p = out.plans.find(x => x.id === fp.id); if (!p) { p = { id: fp.id, name: fp.name, buckets: [], tasks: [] }; out.plans.push(p); }
      fp.buckets.forEach(b => { if (!p.buckets.some(x => x.id === b.id)) p.buckets.push({ id: b.id, name: b.name }); });
      fp.tasks.forEach(t => { if (p.tasks.some(x => x.id === t.id)) return;
        const nt = normTask({ id: t.id, title: t.title, bucketId: t.bucketId, assignees: t.assignees, status: t.status, percent: t.percent, start: t.start, due: t.due, priority: t.priority, labels: t.labels, notes: "", account: t.account, checklist: [], completedOn: t.completedOn });
        if (!taskProblem(nt, new Set(p.buckets.map(b => b.id)))) { p.tasks.push(nt); added++; } });
    });
    out.updated_at = nowIso; return { store: out, added };
  }
  // Store → the row shape used by the Projects table (checklist as counts).
  function storeAsFeed(store) { return store ? { generatedAt: store.updated_at, plans: store.plans.map(p => ({ id: p.id, name: p.name, buckets: p.buckets, tasks: p.tasks.map(t => Object.assign({}, t, { checklist: t.checklist.length ? { done: t.checklist.filter(c => c.done).length, total: t.checklist.length } : null })) })), rejects: store.rejects || [] } : null; }
  // --- exports (files only; nothing is sent anywhere) ---
  const PLANNER_COLS = ["Task ID", "Task Name", "Bucket Name", "Progress", "Priority", "Assigned To", "Start date", "Due date", "Late", "Completed Date", "Description", "Completed Checklist Items", "Checklist Items", "Labels"];
  const PRI_WORD = { urgent: "Urgent", important: "Important", medium: "Medium", low: "Low" }, PRI_GRAPH = { urgent: 1, important: 3, medium: 5, low: 9 };
  const usDate = d => d ? `${+d.slice(5, 7)}/${+d.slice(8, 10)}/${d.slice(0, 4)}` : "";
  function plannerRows(store, planId, today) {
    const out = [];
    store.plans.forEach(p => { if (planId && p.id !== planId) return;
      p.tasks.forEach(t => { const b = p.buckets.find(x => x.id === t.bucketId);
        out.push({ plan: p.name, planId: p.id, cells: [t.id, t.title, b ? b.name : "", PROJ_STATUS_WORD[t.status], PRI_WORD[t.priority], t.assignees.join("; "), usDate(t.start), usDate(t.due),
          String(!!(t.due && today && t.due < today && t.status !== "completed")).replace(/^./, c => c.toUpperCase()), usDate(t.completedOn), t.notes || "",
          t.checklist.filter(c => c.done).map(c => c.title).join("; "), t.checklist.map(c => c.title).join("; "), t.labels.join("; ")] }); }); });
    return out;
  }
  function plannerCSV(store, planId, today) {
    const rows = plannerRows(store, planId, today), multi = !planId && store.plans.length > 1;
    const head = (multi ? ["Plan Name"] : []).concat(PLANNER_COLS);
    return "\ufeff" + head.map(csvCell).join(",") + "\r\n" + rows.map(r => (multi ? [r.plan] : []).concat(r.cells).map(csvCell).join(",")).join("\r\n") + "\r\n";
  }
  // Graph-shaped JSON: plannerPlan / plannerBucket / plannerTask / plannerTaskDetails. Ids are local; Graph assigns its own on create.
  // Graph-ready JSON (G1). Writable fields only, in Graph's names; anything Graph sets itself or needs mapping is under x_ (hints).
  // Checklist keys are client GUIDs (stable per task + item, so re-exports match). orderHint is omitted: the service generates it.
  // dueDateTime / startDateTime: Graph stores UTC; Planner shows the date in the user's zone, so a date is sent as local midnight of
  // this computer's zone converted to UTC (e.g. 2026-10-16 → 2026-10-16T05:00:00Z in Central), which never shows a day early.
  function guidFrom(s) { const h = i => { let x = 0x811c9dc5 ^ i; for (let k = 0; k < s.length; k++) { x ^= s.charCodeAt(k); x = Math.imul(x, 0x01000193) >>> 0; } return x.toString(16).padStart(8, "0"); };
    const hex = h(1) + h(2) + h(3) + h(4); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${"89ab"[parseInt(hex[16], 16) & 3]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`; }
  function graphDate(d) { return d ? new Date(ctIso(d, "00:00")).toISOString().replace(".000Z", "Z") : null; }
  function plannerGraph(store, planId) {
    return { "x_about": "Local export shaped for Microsoft Graph Planner. Create the plan, then buckets (set planId), then tasks (set planId, bucketId, assignments from x_ownerNames), then PATCH each task's details. x_ fields are hints, not Graph properties. Nothing here was sent anywhere.", schema_version: 2,
      plans: store.plans.filter(p => !planId || p.id === planId).map(p => ({
        plannerPlan: { "@odata.type": "#microsoft.graph.plannerPlan", title: p.name, x_localId: p.id },
        plannerBuckets: p.buckets.map(b => ({ "@odata.type": "#microsoft.graph.plannerBucket", name: b.name, x_localId: b.id, x_planRef: p.id })),
        plannerTasks: p.tasks.map(t => ({ "@odata.type": "#microsoft.graph.plannerTask", title: t.title,
          percentComplete: t.status === "completed" ? 100 : t.status === "notStarted" ? 0 : Math.min(99, Math.max(1, t.percent)), priority: PRI_GRAPH[t.priority],
          startDateTime: graphDate(t.start), dueDateTime: graphDate(t.due), assignments: {}, appliedCategories: {},
          x_localId: t.id, x_planRef: p.id, x_bucketRef: t.bucketId, x_ownerNames: t.assignees, x_labels: t.labels, x_completedOn: t.completedOn,
          x_checklistItemCount: t.checklist.length, x_activeChecklistItemCount: t.checklist.filter(c => !c.done).length })),
        plannerTaskDetails: p.tasks.map(t => ({ "@odata.type": "#microsoft.graph.plannerTaskDetails", x_taskRef: t.id, description: t.notes || "", previewType: t.checklist.length ? "checklist" : "automatic",
          checklist: Object.fromEntries(t.checklist.map(c => [guidFrom(p.id + "/" + t.id + "/" + c.id), { "@odata.type": "#microsoft.graph.plannerChecklistItem", title: c.title, isChecked: c.done }])) })) })) };
  }
  // Minimal xlsx (Office Open XML, stored zip, inline strings): one sheet per plan with Planner's export columns.
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  const utf8 = s => new TextEncoder().encode(s);
  function zipStore(files) {
    const parts = [], cen = []; let off = 0;
    const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    files.forEach(([name, text]) => { const n = utf8(name), d = utf8(text), c = crc32(d);
      const lh = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x5821), u32(c), u32(d.length), u32(d.length), u16(n.length), u16(0));
      parts.push(Uint8Array.from(lh), n, d);
      cen.push(Uint8Array.from([].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x5821), u32(c), u32(d.length), u32(d.length), u16(n.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off))), n);
      off += lh.length + n.length + d.length; });
    const cl = cen.reduce((a, x) => a + x.length, 0);
    const end = Uint8Array.from([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cl), u32(off), u16(0)));
    const all = parts.concat(cen, [end]), out = new Uint8Array(all.reduce((a, x) => a + x.length, 0)); let p = 0; all.forEach(x => { out.set(x, p); p += x.length; }); return out;
  }
  const xesc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  function colName(i) { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  function sheetName(n, used) { let b = n.replace(/[\[\]:*?\/\\]/g, " ").trim().slice(0, 31) || "Plan"; let s = b, k = 2; while (used.has(s.toLowerCase())) s = b.slice(0, 28) + " " + k++; used.add(s.toLowerCase()); return s; }
  function plannerXlsx(store, planId, today) {
    const plans = store.plans.filter(p => !planId || p.id === planId), used = new Set(), names = plans.map(p => sheetName(p.name, used));
    const sheet = rows => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => `<c r="${colName(j)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${xesc(/^[=+\-@]/.test(v) ? "'" + v : v)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
    const files = [["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${plans.map((p, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
      ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xesc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`],
      ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${plans.map((p, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`]]
      .concat(plans.map((p, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheet([PLANNER_COLS].concat(plannerRows(store, p.id, today).map(r => r.cells)))]));
    return { bytes: zipStore(files), sheets: names };
  }

  g.DASH = g.DASH || {};
  g.DASH.rules = { LISTS, STATUSES, AUDIENCES, SUBJECTS, TOTAL_KEYS, LIST_KEY, GROUPS, COLD_DAYS, DEFAULT_RULES,
    DEFAULT_TZ, validTimeZone, detectTimeZone, setTimeZone, getTimeZone, tzLabel, zoneOffsetMs,
    ymd, hm, hourCT, addDays, diffDays, sundayOf, mondayOf, dayLabel, isoDay, readSnapshot, isOpen, dateWord, statusWord, group, sortItems,
    lastActivity, isCold, inTotal, totals, mergeHistory, weeklySeries, wow, wowTone, sparkPoints, withConflicts, minutesBetween,
    guessAudience, guessSubject, learnAudience, lineHead, formatLine, managerItems, workload, parseCSV, snapshotFromCSV,
    KINDS, logFingerprint, migrateLogEntries, mergeLog, SOURCES, TOUCH_DIR, TOUCH_KIND, realDay, csvCell, calendarFills, conflictPartners, parseMinutes, parseNotebookLog, timeEntriesCSV, CSV_COLS, coldList,
    ctIso, snoozeUntil, prevBusinessDay, isOutside, lastTouch, keyCold, overlays, focusSections, focusDelta, FOCUS_SECTIONS, todaysClear, readCalendar, readTrips, eventsFromSnapshot, mergeEvents, staleness, layoutLanes, todayStrip,
    PROJ_STATUS, PROJ_STATUS_WORD, readProjects, projectOwner, projectDueWord, projectRows, projectSummary, projectOwnerChoices, projectsCSV, PROJ_CSV_COLS, validOwner: ownerOk,
    hasMoney, hasEmail, guidFrom, graphDate, taskProblem, namedProblem, readStore, normTask, storeFromFeed, storeAsFeed, PLANNER_COLS, plannerRows, plannerCSV, plannerGraph, plannerXlsx, crc32, zipStore };
})(typeof window !== "undefined" ? window : globalThis);
