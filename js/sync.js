/* Activity Dashboard — multi-machine time sync (pure functions, no DOM, no I/O). window.DASH.sync
   Each machine appends events to Data/time-<machine>.json only. Every machine reads all Data/time-*.json files
   (including OneDrive conflict copies such as time-mac-Laptop2.json) and folds them the same way:
   events de-duplicated by eid; per entry, last writer wins by (ts, then machine name, then eid). */
(function (g) {
  "use strict";
  const MACHINE_RE = /^[a-z0-9]{1,20}$/;          // no hyphens, so "time-<machine>.json" is unambiguous
  const TIME_FILE_RE = /^time-.+\.json$/i;          // own file + any conflict copy
  const OPS = ["upsert", "remove", "map", "flag"];   // 00.05: "flag" = key-account star, Done/Snooze overlay, internal person (data.on boolean)
  const FUTURE_MS = 5 * 60 * 1000;                 // a stamp more than 5 min ahead of this clock -> ⚠ on the sync chip
  let counter = 0;
  const pad = (n, w) => String(n).padStart(w, "0");
  // Hybrid logical clock (F3): stamp = max(local clock, newest stamp seen) with a logical counter c for ties.
  function clock() {
    const st = { ms: 0, c: 0 };
    return {
      observe(evs) { (evs || []).forEach(e => { const m = Date.parse(e.ts); if (m > st.ms || (m === st.ms && (e.c || 0) > st.c)) { st.ms = m; st.c = e.c || 0; } }); },
      tick(nowMs) { if (nowMs > st.ms) { st.ms = nowMs; st.c = 0; } else st.c += 1; return { ts: new Date(st.ms).toISOString(), c: st.c }; },
      state: () => ({ ms: st.ms, c: st.c }),
    };
  }
  // Stable content string (sorted keys) used to break same-id ties deterministically (F3b).
  function canon(v) { if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]"; if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}"; return JSON.stringify(v); }
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  // Base machine of a time file name: time-mac.json, time-mac-Laptop2.json, "time-mac (1).json", Time-Mac.JSON -> "mac" (F6).
  function fileMachine(name) { const m = /^time-([a-z0-9]{1,20})(?:[^a-z0-9][^/]*)?\.json$/i.exec(name || ""); return m ? m[1].toLowerCase() : null; }

  function fileName(machine) { return `time-${machine}.json`; }
  function isTimeFile(name) { return TIME_FILE_RE.test(name); }
  function validMachine(m) { return MACHINE_RE.test(m || ""); }
  // F4: zero-padded counter so eids also sort in creation order as strings
  function makeEid(machine, nowMs) { counter = (counter + 1) % 1e8; return `${machine}.${pad(nowMs.toString(36), 9)}.${pad(counter, 8)}.${Math.random().toString(36).slice(2, 6)}`; }
  // Order: stamp (UTC ms, numeric), logical counter (numeric), machine, eid, then content.
  function cmp(a, b) {
    const ta = Date.parse(a.ts), tb = Date.parse(b.ts); if (ta !== tb) return ta < tb ? -1 : 1;
    const ca = a.c || 0, cb = b.c || 0; if (ca !== cb) return ca < cb ? -1 : 1;
    if (a.machine !== b.machine) return a.machine < b.machine ? -1 : 1;
    if (a.eid !== b.eid) return a.eid < b.eid ? -1 : 1;
    const xa = canon(a), xb = canon(b); return xa < xb ? -1 : xa > xb ? 1 : 0;
  }
  // F3: every stamp is normalised to UTC "YYYY-MM-DDTHH:MM:SS.sssZ"; c is a non-negative integer.
  function normalize(e) { const m = Date.parse(e.ts); if (isNaN(m)) return null; return Object.assign({}, e, { ts: new Date(m).toISOString(), c: Number.isInteger(e.c) && e.c >= 0 ? e.c : 0 }); }
  function validEvent(e) {
    return e && typeof e.eid === "string" && typeof e.ts === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(e.ts) && !isNaN(Date.parse(e.ts)) && validMachine(e.machine)
      && (e.c === undefined || (Number.isInteger(e.c) && e.c >= 0)) && (e.sup === undefined || typeof e.sup === "string")
      && OPS.includes(e.op) && typeof e.id === "string" && e.id.length > 0 && (e.op === "remove" || (e.data && typeof e.data === "object"))
      && (e.op !== "flag" || (/^[a-z]+:.+/.test(e.id) && typeof e.data.on === "boolean"));
  }
  // Parse one time file. Returns {machine, events, bad} — never throws on content, so one broken file can't stop the merge.
  function parseTimeFile(text, name) {
    let o; try { o = JSON.parse(text); } catch (e) { return { machine: null, events: [], bad: `${name}: not valid JSON` }; }
    const kinds = ["dash-time-log"].concat((g.DASH_CONFIG && g.DASH_CONFIG.legacyTimeKinds) || []);   // 00.03: older builds' time logs
    if (!o || !kinds.includes(o.kind) || o.version !== 1 || !Array.isArray(o.events)) return { machine: null, events: [], bad: `${name}: not an Activity Dashboard time log` };
    const base = fileMachine(name), probs = [];
    let events = o.events.filter(validEvent).map(normalize);
    if (events.length !== o.events.length) probs.push(`${o.events.length - events.length} invalid event(s) ignored`);
    if (!base) return { machine: null, events: [], bad: `${name}: machine name can't be read from the file name (a–z, 0–9, up to 20) — file ignored` };   // D6
    { const n = events.length; events = events.filter(e => e.machine === base); if (events.length !== n) probs.push(`${n - events.length} event(s) from another machine ignored (file belongs to "${base}")`); }
    const reports = Array.isArray(o.clock_reports) ? o.clock_reports.filter(r => r && validMachine(r.about) && Number.isFinite(r.ahead_min)) : [];
    return { machine: base, events, reports, updated_at: typeof o.updated_at === "string" && !isNaN(Date.parse(o.updated_at)) ? new Date(Date.parse(o.updated_at)).toISOString() : null, bad: probs.length ? `${name}: ${probs.join("; ")}` : null };
  }
  // reports: [{about, ahead_min}] — this machine telling the others their clock looks ahead (D5: the warning shows on both)
  function serialize(machine, events, nowIso, reports) {
    const own = dedupe(events.filter(e => e.machine === machine)).sort(cmp);
    const o = { app: "activity-dashboard", kind: "dash-time-log", version: 1, machine, updated_at: nowIso, events: own };
    if (reports && reports.length) o.clock_reports = reports;
    return JSON.stringify(o, null, 1) + "\n";
  }
  // Same eid twice with different content (corrupt/hand-edited file): keep the greater one by cmp, whatever the file order (F3b).
  function dedupe(events) { const m = new Map(); events.forEach(e => { if (!validEvent(e)) return; e = normalize(e); const o = m.get(e.eid); if (!o || cmp(e, o) > 0) m.set(e.eid, e); }); return [...m.values()]; }
  function futureStamps(events, nowMs, except) { return dedupe(events).filter(e => e.machine !== except && Date.parse(e.ts) > nowMs + FUTURE_MS); }
  // D5: stamps more than holdHours ahead of real time are held back: not folded, not observed by the clock, until time catches up.
  // DH6: "sup" only voids an event from the SAME machine (a machine can only repair its own events).
  function supersededBy(events) { return new Set((events || []).filter(e => e && e.sup).map(e => e.machine + "|" + e.sup)); }
  const isVoided = (set, e) => set.has(e.machine + "|" + e.eid);
  function quarantine(events, nowMs, holdHours) {
    const lim = nowMs + (holdHours > 0 ? holdHours : 24) * 3600e3, live = [], held = [];
    const voided = supersededBy(events);
    (events || []).forEach(e => { if (isVoided(voided, e)) return; (Date.parse(e.ts) > lim ? held : live).push(e); }); return { live, held };
  }
  // Repair (DG5). This machine's own stamps more than 5 min ahead of now are re-stamped as NEW events that supersede the
  // originals ("sup" = original eid), so a conflict copy holding the original can't revive it.
  // Intent ordering: the re-stamped events go right after this machine's newest stamp that was NOT ahead (L), keeping their
  // original order with the counter. So anything another machine did after L — after this clock went wrong — still wins;
  // limit: another machine's edit made between L and the wrong-clock edit also wins (the safe side). Never later than now.
  // DH1/DI1: floor for a re-stamp — meeting start + 1 ms (removal + 2 ms), else the entry's date + 1 ms; never 1970.
  function lowerBound(e, startOf) {
    const evId = (e.data && e.data.eventId) || (/^cal:(.+)$/.exec(e.id || "") || [])[1];
    const ev = evId && startOf ? startOf(evId) : null, st = ev && typeof ev === "object" ? ev.start : ev;
    if (st && !isNaN(Date.parse(st))) return Date.parse(st) + (e.op === "remove" ? 2 : 1);
    const d = e.data && e.data.date; if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(`${d}T00:00:00`))) return Date.parse(`${d}T00:00:00`) + 1;
    return null;
  }
  function restamp(events, machine, clk, nowMs, startOf) {
    const all = dedupe(events), lim = nowMs + FUTURE_MS, mine = all.filter(e => e.machine === machine);
    const bad = mine.filter(e => Date.parse(e.ts) > lim && !e.sup).sort(cmp);
    const voided = supersededBy(all), todo = bad.filter(e => !isVoided(voided, e));
    if (!todo.length) return { events: all, changed: 0 };
    const ok = mine.filter(e => Date.parse(e.ts) <= lim && !todo.includes(e)).sort(cmp), last = ok[ok.length - 1];
    // DI1: each event goes to max(last correct stamp, its own floor) — floor = meeting start + 1 ms (removal + 2 ms),
    // else entry date + 1 ms — capped at now. Events of one entry share the highest base; the counter keeps their order.
    const lastMs = last ? Date.parse(last.ts) : null, base = new Map();
    todo.forEach(e => { const lb = lowerBound(e, startOf); let v = lastMs == null ? (lb == null ? nowMs : lb) : (lb == null ? lastMs : Math.max(lastMs, lb)); v = Math.min(v, nowMs); base.set(e.id, Math.max(base.get(e.id) ?? -Infinity, v)); });
    const cnt = new Map();
    const fresh = todo.map(e => { const b = base.get(e.id); let c = cnt.has(e.id) ? cnt.get(e.id) + 1 : (last && lastMs === b ? (last.c || 0) + 1 : 0); cnt.set(e.id, c);
      return Object.assign({}, e, { eid: makeEid(machine, nowMs), ts: new Date(b).toISOString(), c, sup: e.eid }); });
    const at = fresh.map(e => e.ts).sort()[0];
    return { events: all.filter(e => !todo.includes(e)).concat(fresh), changed: fresh.length, at };
  }
  // DG5c: this clock looks behind if another machine's stamp or file time is more than 5 min ahead of it.
  function clockLooksBehind(otherEvents, otherFileTimes, nowMs) {
    const lim = nowMs + FUTURE_MS; return (otherEvents || []).some(e => Date.parse(e.ts) > lim) || (otherFileTimes || []).some(t => t && Date.parse(t) > lim);
  }
  // Fold all events into state: entries id -> data|null (null = removed/tombstone); maps domain -> audience.
  function fold(events) {
    // DG5: an event that names another in "sup" (a repaired re-stamp) replaces it everywhere, even if a conflict copy still has the original.
    const all = dedupe(events), voided = supersededBy(all);
    const evs = all.filter(e => !isVoided(voided, e)).sort(cmp), entries = new Map(), maps = new Map(), flags = new Map();
    evs.forEach(e => {
      if (e.op === "map") maps.set(e.id, e.data.audience);
      else if (e.op === "flag") flags.set(e.id, e.data);   // last writer wins per id (stamp, counter, machine), like upsert; "off" is on:false, never a removal
      else entries.set(e.id, e.op === "remove" ? null : e.data);
    });
    return { entries, maps, flags, count: evs.length, machines: [...new Set(evs.map(e => e.machine))].sort() };
  }
  // Materialise: live entries (sorted by id), removed calendar event ids (tombstones), learned domain map.
  function materialize(state) {
    const live = [], removedCal = [], removedIds = [];
    [...state.entries.keys()].sort().forEach(id => {
      const d = state.entries.get(id);
      if (d) live.push(Object.assign({}, d, { id })); else { removedIds.push(id); if (id.startsWith("cal:")) removedCal.push(id.slice(4)); }
    });
    const domainMap = {}; [...state.maps.keys()].sort().forEach(k => domainMap[k] = state.maps.get(k));
    const flags = {}; [...(state.flags || new Map()).keys()].sort().forEach(k => flags[k] = state.flags.get(k));
    return { entries: live, removedCal, removedIds, domainMap, flags };
  }
  const strip = e => { const o = Object.assign({}, e); delete o.id; return o; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  // Turn a local change (prev materialised view -> next view) into events. tsFor(entry) may return a fixed ts for
  // automatically created entries (calendar seeds, notebook-log lines) so they can never override a real edit elsewhere.
  // clk: a clock() (the app's hybrid clock) or a plain ms number (a fresh clock at that time).
  function diff(prev, next, machine, clk, tsFor) {
    let nowMs = Date.now(); if (typeof clk === "number") { nowMs = clk; clk = clock(); }
    const out = [], pm = new Map(prev.entries.map(e => [e.id, e])), nm = new Map(next.entries.map(e => [e.id, e]));
    const ev = (op, id, data, ts) => { let st;
      if (ts) st = { ts: new Date(Date.parse(ts)).toISOString(), c: 0 }; else st = clk.tick(nowMs);
      out.push(Object.assign({ eid: makeEid(machine, Date.parse(st.ts)), ts: st.ts, c: st.c, machine, op, id }, data === undefined ? {} : { data })); };
    nm.forEach((e, id) => { const p = pm.get(id); if (!p) ev("upsert", id, strip(e), tsFor && tsFor(e)); else if (!same(strip(p), strip(e))) ev("upsert", id, strip(e)); });
    pm.forEach((e, id) => { if (!nm.has(id)) ev("remove", id); });
    (next.removedCal || []).forEach(c => { if (!(prev.removedCal || []).includes(c) && !pm.has("cal:" + c) && !nm.has("cal:" + c)) ev("remove", "cal:" + c); });
    const pmap = prev.domainMap || {}, nmap = next.domainMap || {};
    Object.keys(nmap).forEach(d => { if (pmap[d] !== nmap[d]) ev("map", d, { audience: nmap[d] }); });
    const pf = prev.flags || {}, nf = next.flags || {};
    Object.keys(nf).sort().forEach(id => { if (nf[id] && typeof nf[id].on === "boolean" && !same(pf[id], nf[id])) ev("flag", id, nf[id]); });
    return out;
  }
  // One-time migration of 00.01 local entries (IndexedDB cache) into this machine's events (F2a).
  // Never stamped with now(): each entry keeps its own old time, so it can't override a removal or edit made since on the
  // other machine. eids are derived from the content, so running it twice adds nothing.
  //   startOf(eventId) -> ISO start of a calendar event if the snapshot has it.
  const EPOCH = "1970-01-01T00:00:00.000Z";
  function entryStamp(e, startOf) {
    // D7: a meeting entry from 00.01 may hold an adjustment or Attended pick, so it is stamped AFTER the automatic fill
    // (which uses the meeting start): its own update time if known, else start + 1 ms (else its date + 1 ms).
    if (e.eventId || e.source === "calendar") {
      const up = e.updatedAt || e.updated_at; if (up && !isNaN(Date.parse(up))) return new Date(Date.parse(up)).toISOString();
      const ev = e.eventId && startOf ? startOf(e.eventId) : null, st = ev && typeof ev === "object" ? ev.start : ev;
      // DG1: 00.01 never stored updatedAt. Only a real adjustment or Attended pick gets start + 1 ms; an untouched
      // automatic fill stays at the start, exactly like the other machine's fill.
      if (st && !isNaN(Date.parse(st))) return new Date(Date.parse(st) + (adjusted(e, ev) ? 1 : 0)).toISOString();
      if (e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date)) { const d = Date.parse(`${e.date}T00:00:00`); if (!isNaN(d)) return new Date(d + 1).toISOString(); }
    }
    const m = /^i(\d{12,14})/.exec(e.id || ""); if (m) return new Date(+m[1]).toISOString();          // manual entries: id carries its creation ms
    if (e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date)) { const d = Date.parse(`${e.date}T${/^\d{2}:\d{2}$/.test(e.time || "") ? e.time : "00:00"}:00`); if (!isNaN(d)) return new Date(d).toISOString(); }
    return EPOCH;
  }
  // A 00.01 meeting entry differs from the automatic fill if: Attended was picked, minutes differ from the meeting length,
  // or an audience/subject guess was replaced (00.01 cleared the "guessed" reason on edit).
  function adjusted(e, ev) {
    if (e.attended) return true;
    if (ev && typeof ev === "object" && ev.start && ev.end && Math.round((Date.parse(ev.end) - Date.parse(ev.start)) / 60000) !== e.minutes) return true;
    const g = e.guessed; if (g && (g.audience === null || g.subject === null)) return true;
    if (ev && typeof ev === "object" && "account" in ev && (e.account || null) !== (ev.account || null)) return true;   // DH3: account-only popup edit
    return false;
  }
  function migrationEvents(entries, tombstones, learnedMap, baseMap, machine, startOf) {
    if (typeof startOf !== "function") startOf = null;
    // DH5: a corrupt IndexedDB may hold a non-list here; skip it (the app warns) instead of throwing
    if (!Array.isArray(entries)) entries = []; if (!Array.isArray(tombstones)) tombstones = [];
    entries = entries.filter(e => e && typeof e === "object"); tombstones = tombstones.filter(t => typeof t === "string");
    if (!learnedMap || typeof learnedMap !== "object" || Array.isArray(learnedMap)) learnedMap = {};
    const out = [], mk = (op, id, data, ts) => { const e = { ts, c: 0, machine, op, id }; if (data !== undefined) e.data = data; e.eid = `${machine}.mig.${hash(op + "|" + id + "|" + canon(data === undefined ? null : data))}`; out.push(e); };
    (entries || []).forEach(e => { if (e && e.id) mk("upsert", e.id, strip(e), entryStamp(e, startOf)); });
    // A removed meeting: just after its start, so it beats the automatic fill (stamped at the start) but loses to any real later edit.
    (tombstones || []).forEach(c => { if ((entries || []).some(e => e.id === "cal:" + c)) return; const ev = startOf && startOf(c), st = ev && typeof ev === "object" ? ev.start : ev; mk("remove", "cal:" + c, undefined, st && !isNaN(Date.parse(st)) ? new Date(Date.parse(st) + 2).toISOString() : EPOCH); });
    Object.keys(learnedMap || {}).forEach(d => { if (!baseMap || baseMap[d] !== learnedMap[d]) mk("map", d, { audience: learnedMap[d] }, EPOCH); });
    return out;
  }
  g.DASH = g.DASH || {};
  g.DASH.sync = { MACHINE_RE, fileName, isTimeFile, validMachine, validEvent, parseTimeFile, fileMachine, clock, futureStamps, quarantine, restamp, clockLooksBehind, adjusted, normalize, canon, FUTURE_MS, serialize, dedupe, fold, materialize, diff, migrationEvents, cmp };
})(typeof window !== "undefined" ? window : globalThis);
