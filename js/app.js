/* Activity Dashboard — UI. Local-file app: open index.html directly. */
(function () {
  "use strict";
  if (window.DASH && window.DASH.framed) return;   // 00.04: inside another site's frame nothing starts (js/frame.js)
  const R = DASH.rules, A = DASH.accounts, DB = DASH.db, CFG = window.DASH_CONFIG || {};
  const REV = "00.09.001_261030";
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const qp = new URLSearchParams(location.search);
  const NOW = qp.get("now") ? new Date(qp.get("now")) : new Date();
  // 00.05.001: no time-zone setting. The zone is the computer's own (re-detected on every poll, focus and visibility change).
  R.setTimeZone(R.detectTimeZone());
  const TIPS = {
    overdue: "The next date is before today.", dueToday: "The next date is today.", thisWeek: "Due from tomorrow through Sunday.",
    iOwe: "Follow-ups and Account touches where the user owes the next move.", owedToMe: "Everything in Waiting on.",
    goingCold: "Any open item with no activity in 14+ days. Activity = a To Do edit, time logged on that item, or a meeting with its account.",
    followUps: "Everything open in the Follow-ups list.", waitingOn: "Everything open in the Waiting on list.",
    accountTouches: "Everything open in the Account touches list.", travel: "Everything open in the Travel list.",
  };
  const LABEL = { overdue: "Overdue", dueToday: "Due Today", thisWeek: "This Week", iOwe: "I Owe", owedToMe: "Owed to Me", goingCold: "Going Cold",
    followUps: "Follow-ups", waitingOn: "Waiting on", accountTouches: "Account touches", travel: "Travel" };
  // 00.05: Daily Focus is always the home view (Q9); ?view= opens another tab (deep links, tests).
  const VIEWS = ["focus", "dashboard", "workload", "projects", "accounts", "print", "manager"];
  const S = { snap: null, today: R.ymd(NOW), filter: null, open: {}, collapsed: {}, entries: [], removedCal: [], history: [], rules: R.DEFAULT_RULES, view: VIEWS.includes(qp.get("view")) ? qp.get("view") : "focus", wkOffset: 0, trends: false,
    flags: {}, focusExp: new Set(), laterOpen: false, noDateOpen: false, focusAnimated: false };
  // "now" for Snooze: the ?now= test clock if given, else the real clock.
  const nowDate = () => qp.get("now") ? new Date(NOW.getTime()) : new Date();

  // ---------- loading ----------
  function loadScript(src) {
    return new Promise(res => { const s = document.createElement("script"); s.src = src + "?t=" + Date.now(); s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s); });
  }
  async function boot() {
    wireMenus(); registerPWA();
    try { const lg = await DB.migrateLegacy(CFG.legacyDbNames || []); if (lg) S.legacyImported = lg; } catch (e) { banner("⚠ The older browser cache couldn't be copied: " + (e.message || e), true); }
    await DB.loadFlags();
    await setupMachine();
    await connectStored();
    if (S.dir) { await loadKeyring(); await ensureUnlocked(); }   // 00.03.001: unlock before reading the (encrypted) cache
    await hubBoot();                                              // 00.04: GitHub data hub (the store on iPad, a mirror next to a folder)
    await offerLegacyDelete();
    S.history = (await DB.get("history")) || [];
    if (S.vault.kr && S.vault.key) await cleanupExampleHistory();   // 00.09.001: once
    { const cb = await DB.get("clearBase"); S.clearBase = cb && typeof cb.day === "string" && Array.isArray(cb.ids) ? cb : null; }   // 00.05.003: Today's Clear baseline {day, ids} (this computer only)
    S.own = (await DB.get("ownEvents")) || [];
    recompute();
    let raw = null, from = "";
    if (S.dir && S.vault.kr && S.vault.key) await adoptPlainSnapshots();   // 00.09.001: newer plain deliveries are encrypted first, then read
    if (S.dir) { const r = await readDirSnapshot(); if (r) { raw = r; from = "Inbox Exporter snapshot"; } }
    if (!raw && !S.vault.kr && await loadScript(CFG.snapshotPath || "Data/inbox-snapshot.js") && window.DASH_SNAPSHOT) { raw = window.DASH_SNAPSHOT; from = "Inbox Exporter snapshot"; }
    const opened = await DB.get("openedSnapshot");
    if (opened && (!raw || new Date(opened.generated_at) > new Date(raw.generated_at))) { raw = opened; from = "opened file"; }
    if (!raw && await loadScript(CFG.examplePath || "examples/example-snapshot.js") && window.DASH_EXAMPLE_SNAPSHOT) { raw = window.DASH_EXAMPLE_SNAPSHOT; from = "example snapshot"; }
    if (!raw) { await migrateV01(null); banner("No snapshot found. Put inbox-snapshot.js in the data folder, or use File → Open snapshot….", true); render(); return; }
    await migrateV01(raw && !raw.example ? raw : null);
    if (await useSnapshot(raw, from)) await autoloadLog();
    watchTz(); startPolling();
  }
  // Data/notebook-log.js is made on the box by tools/make_log_js.py (only "- [log]" lines). Missing file = nothing to do; File → Import stays the fallback.
  async function autoloadLog() {
    if (S.dir) { const L = await readDirLog(); if (L) { importLog("notebook-log.js", L.lines.join("\n"), true); return; } }
    if (S.vault.kr || !(await loadScript(CFG.notebookLogPath || "Data/notebook-log.js")) || !window.DASH_NOTEBOOK_LOG) return;
    const L = window.DASH_NOTEBOOK_LOG; if (!L || !Array.isArray(L.lines)) { banner("Data/notebook-log.js is not in the expected format; use File → Import notebook log….", true); return; }
    importLog("notebook-log.js", L.lines.join("\n"), true);
  }
  async function useSnapshot(raw, from) {
    let s;
    try { s = R.readSnapshot(raw); } catch (e) { banner("Snapshot not loaded: " + e.message + " The previous data is kept.", true); if (!S.snap) render(); return false; }
    const wasExample = !!(S.snap && S.snap.example);
    s.from = from; s.raw_generated_at = raw.generated_at; S.snap = s; S.snapRaw = raw;
    // 00.09.001 (F2): leaving EXAMPLE DATA for a real snapshot drops the example's weekly totals; only the stored real history is kept
    if (wasExample && !s.example) { let h = []; try { h = (await DB.get("history")) || []; } catch (e) { h = []; } S.history = Array.isArray(h) ? h.filter(x => x && !x.example) : []; }
    await calForSnapshot(s);
    const cur = { generated_at: s.generatedAt, totals: R.totals(s.items, ctx()) };
    S.history = R.mergeHistory(R.mergeHistory(S.history, s.history), [cur]);
    if (!s.example) await DB.set("history", S.history);
    seedCalendarEntries();
    S.snapDone = s.raw_generated_at;   // 00.09.001: set once the snapshot and its history merge are applied (tests wait on it)
    if (s.rejects.length) banner(`⚠ Incomplete: ${s.rejects.length} row(s) skipped — ${s.rejects.slice(0, 3).join("; ")}${s.rejects.length > 3 ? "; …" : ""}`);
    render(); return true;
  }
  // 00.09.001: one-time cleanup of history that 00.09.000 polluted with the example's weekly totals. Removes only entries equal to
  // the example fixture's totals_history (date and every value). Backs the store up first (read back to check), then sets a marker.
  const canon = o => JSON.stringify(o && typeof o === "object" ? Object.keys(o).sort().reduce((a, k) => (a[k] = o[k], a), {}) : o);
  // Oct 19 rule (00.09.001, v2): the example's own computed week. Removed only when its stamp is exactly the example fixture's
  // generated_at AND all 10 counts equal R.totals(example items) for some day from that date through today (the app's own logic).
  function exampleWeekMatch(h, ex) {
    if (!h || !ex || h.generated_at !== ex.generated_at || !h.totals) return false;
    let s; try { s = R.readSnapshot(ex); } catch (e) { return false; }
    const first = R.isoDay(ex.generated_at), last = R.ymd(nowDate()), want = canon(h.totals);
    if (Object.keys(h.totals).length !== R.TOTAL_KEYS.length) return false;
    for (let d = first, i = 0; d <= last && i < 400; d = R.addDays(d, 1), i++) {
      if (canon(R.totals(s.items, { today: d, calendar: s.calendar, timeEntries: [] })) === want) return true;
    }
    return false;
  }
  async function cleanupExampleHistory() {
    if (!S.vault.kr || !S.vault.key) return;
    try {
      const mk = await DB.get("historyCleanup0901");
      const expire = async at => { if (at && Date.now() - Date.parse(at) > 30 * 864e5 && await DB.get("historyBackup0901") !== undefined) { await DB.set("historyBackup0901", undefined); toast("The 30-day history backup was discarded."); } };   // L1
      if (mk && mk.v >= 2) { await expire(mk.at); return; }
      window.DASH_EXAMPLE_SNAPSHOT || await loadScript(CFG.examplePath || "examples/example-snapshot.js");
      const ex = window.DASH_EXAMPLE_SNAPSHOT; if (!ex || !Array.isArray(ex.totals_history)) return;
      const known = new Set(ex.totals_history.map(h => h.generated_at + "|" + canon(h.totals)));
      const cur = (await DB.get("history")) || []; if (!Array.isArray(cur)) return;
      // A marker without v (written by the first build of this cleanup) means the fixture weeks were already handled: only the Oct 19 rule runs.
      const fixtureRule = !mk;
      const drop = h => !!h && ((fixtureRule && known.has(h.generated_at + "|" + canon(h.totals))) || exampleWeekMatch(h, ex));
      const keep = cur.filter(h => !drop(h)), removed = cur.length - keep.length;
      let at = mk && mk.at ? mk.at : new Date().toISOString();
      if (removed) {
        // Back up first. A backup kept from the first pass predates both passes, so it is kept as is; otherwise the current store is backed up.
        const prev = await DB.get("historyBackup0901");
        if (prev === undefined) {
          await DB.set("historyBackup0901", cur);
          if (JSON.stringify(await DB.get("historyBackup0901")) !== JSON.stringify(cur)) throw new Error("backup read-back failed");
          at = new Date().toISOString();
        }
        await DB.set("history", keep);
        if (JSON.stringify(await DB.get("history")) !== JSON.stringify(keep)) { await DB.set("history", cur); throw new Error("read-back failed; history put back"); }
        S.history = keep; S.cleanupNotice = `Removed ${removed} example week${removed > 1 ? "s" : ""} from your trend history (left by 00.09.000). A backup was kept on this computer.`; toast(S.cleanupNotice);
      }
      await DB.set("historyCleanup0901", { v: 2, at, removed: ((mk && mk.removed) || 0) + removed });
      await expire(at);
    } catch (e) { S.problems.push("History cleanup: " + (e.message || e) + " (nothing changed)"); }
  }
  function ctx() { return { today: S.today, calendar: S.snap ? S.snap.calendar : [], timeEntries: S.entries }; }
  function banner(msg, err) { const b = $("#banner"); b.textContent = msg; b.className = "banner" + (err ? " err" : ""); }

  // Calendar meeting time counts at once (Adjust to change it). Overlapping meetings fill nothing until one is marked Attended.
  function seedCalendarEntries() {
    recompute();
    const attended = S.entries.filter(e => e.source === "calendar" && e.attended).map(e => e.eventId);
    let changed = false;
    // An entry seeded before an overlapping event appeared stops counting until one meeting is marked Attended.
    const conflicted = new Set(R.withConflicts(S.snap.calendar).filter(e => e.conflict).map(e => e.id));
    const before = S.entries.length;
    S.entries = S.entries.filter(e => !(e.source === "calendar" && !e.attended && conflicted.has(e.eventId)));
    if (S.entries.length !== before) changed = true;
    R.calendarFills(S.snap.calendar, S.today, attended).forEach(ev => {
      if (S.entries.some(e => e.eventId === ev.id) || S.removedCal.includes(ev.id)) return;  // F12: removed stays removed
      S.entries.push(calEntry(ev, ev.conflict)); changed = true;
    });
    if (changed) saveEntries();
  }
  function calEntry(ev, attended) {
    const a = R.guessAudience(ev.attendee_domains, S.rules), sj = R.guessSubject(ev.title);
    return { id: "cal:" + ev.id, eventId: ev.id, taskId: null, date: R.isoDay(ev.start), minutes: R.minutesBetween(ev.start, ev.end), audience: a.value, subject: sj.value,
      account: ev.account, source: "calendar", confirmed: true, attended: !!attended, guessed: { audience: a.why, subject: sj.why }, title: ev.title };
  }
  function markAttended(id) {
    const ev = S.snap.calendar.find(e => e.id === id); if (!ev) return;
    const partners = R.conflictPartners(S.snap.calendar, id);
    S.entries = S.entries.filter(e => !(e.source === "calendar" && partners.includes(e.eventId)));
    if (S.removedCal.includes(id)) { S.removedCal = S.removedCal.filter(x => x !== id); saveRemoved(); }
    if (!S.entries.some(e => e.eventId === id)) S.entries.push(calEntry(ev, true));
    saveEntries(); toast(partners.length ? `Marked "${ev.title}" attended. Only this meeting's time is counted.` : `Counting "${ev.title}" again.`); render();
  }
  function unmarkAttended(id) { S.entries = S.entries.filter(e => !(e.source === "calendar" && e.eventId === id)); saveEntries(); render(); }
  // Pending IndexedDB writes; reloads wait for them (DASH.app.flush) so a tombstone is never lost.
  const pending = new Set();
  // 00.09.001 (L2): a failed tracked write is recorded and shown as a problem line at once; reloads stop while one is outstanding.
  const writeFails = [];
  function track(p) { if (p && p.then) { pending.add(p); p.finally(() => pending.delete(p)).catch(e => { writeFails.push(e); S.saveProblems.write = `A save failed (${(e && e.message) || e}); not reloaded, so nothing in this window is lost`; renderSync(); }); } return p; }
  function flush() { return Promise.all([...pending].map(p => p.catch(() => {}))); }
  async function reloadSafely() {
    await flush(); await new Promise(r => setTimeout(r, 0));
    if (writeFails.length) { const n = writeFails.length; if (!S.problems.includes(S.saveProblems.write)) S.problems.push(S.saveProblems.write); banner(`⚠ ${n} save${n > 1 ? "s" : ""} failed, so the dashboard did not reload.  Check the sync chip, then try again.`, true); renderSync(); writeFails.length = 0; return false; }
    location.reload(); return true;
  }
  function saveRemoved() { return commit(); }
  async function removeEntry(id) {
    const e = S.entries.find(x => x.id === id); if (!e) return;
    const ps = [];
    if (e.source === "calendar" && e.eventId && !S.removedCal.includes(e.eventId)) { S.removedCal.push(e.eventId); ps.push(saveRemoved()); }
    S.entries = S.entries.filter(x => x.id !== id); ps.push(saveEntries()); render();
    await Promise.all(ps);
  }
  function saveEntries() { return commit(); }

  // ---------- multi-machine sync (00.02) ----------
  // This machine writes only Data/time-<machine>.json; it reads every Data/time-*.json (conflict copies too) and folds
  // them with DASH.sync (last writer wins per entry: timestamp, then machine name). IndexedDB keeps a cache + this machine's events.
  const R2 = DASH.sync, POLL_MS = (CFG.pollSeconds || 60) * 1000;
  Object.assign(S, { saveProblems: {}, clock: R2.clock(), future: [], fileProblems: {}, machine: null, own: [], fileEvents: {}, seen: {}, problems: [], dir: null, dirStored: null, granted: false, lastSync: null, machines: [], view0: { entries: [], removedCal: [], domainMap: {} } });
  const isExample = () => S.snap && S.snap.example && !S.allowExampleWrites;
  function learned(rules) { const d = (rules && rules.domainMap) || {}, b = R.DEFAULT_RULES.domainMap, o = {}; Object.keys(d).forEach(k => { if (b[k] !== d[k]) o[k] = d[k]; }); return o; }
  function recompute() {
    // D5: stamps more than holdHours ahead are held: not applied and not seen by the clock until real time catches up.
    const q = R2.quarantine(S.own.filter(e => e.machine === S.machine).concat(...Object.values(S.fileEvents)), Date.now(), CFG.holdHours || 24);
    const all = q.live, st = R2.fold(all), m = R2.materialize(st);
    S.clock.observe(all); S.held = R2.dedupe(q.held); S.future = R2.futureStamps(all, Date.now(), S.machine); S.removedIds = new Set(m.removedIds);
    const rep = {}; S.future.concat(S.held).forEach(e => { if (e.machine === S.machine) return; const a = Math.round((Date.parse(e.ts) - Date.now()) / 60000); rep[e.machine] = Math.max(rep[e.machine] || 0, a); });
    const prevAt = {}; (S.myReports || []).forEach(r => { prevAt[r.about + ":" + r.ahead_min] = r.at; });   // 00.09.001: keep "at" while a report is unchanged
    const fresh = t => t && Date.now() - Date.parse(t) < 12 * 3.6e6;   // a report that still holds is re-dated every 12 h, so it doesn't expire while the clock is still off
    const reports = Object.keys(rep).sort().map(k => ({ about: k, ahead_min: rep[k], at: fresh(prevAt[k + ":" + rep[k]]) ? prevAt[k + ":" + rep[k]] : new Date().toISOString() }));
    const sameR = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
    if (!sameR(reports, S.myReports)) { S.myReports = reports; if (S.machine) setTimeout(() => scheduleWrite(), 0); }
    const upd = S.fileUpdated || {}, nowMs = Date.now();   // O1: reports older than 24 h (or than the reporter's last write, for files without "at") are ignored
    S.aboutMe = [].concat(...Object.entries(S.fileReports || {}).map(([n, rs]) => (rs || []).filter(r => r.about === S.machine && R2.fileMachine(n) !== S.machine && R2.liveReport(r, upd[n], nowMs, CFG.clockReportHours || 24)).map(r => Object.assign({ by: R2.fileMachine(n) }, r))));
    // Unattended time for a meeting that now overlaps another doesn't count (and isn't deleted): it returns if the overlap goes away.
    const conflicted = S.snap ? new Set(R.withConflicts(S.snap.calendar).filter(e => e.conflict).map(e => e.id)) : new Set();
    m.entries = m.entries.filter(e => !(e.source === "calendar" && !e.attended && conflicted.has(e.eventId)));
    S.entries = m.entries; S.removedCal = m.removedCal; S.machines = st.machines;
    S.rules = Object.assign({}, R.DEFAULT_RULES, { domainMap: Object.assign({}, R.DEFAULT_RULES.domainMap, m.domainMap) });
    S.flags = m.flags || {};
    S.view0 = JSON.parse(JSON.stringify({ entries: m.entries, removedCal: m.removedCal, domainMap: m.domainMap, flags: S.flags }));
    if (S.snap && !isExample()) track(DB.set("timeEntries", S.entries));   // cache only
  }
  // Automatic entries get a fixed, old timestamp so they can never override a real edit or removal made on the other machine.
  function tsFor(e) {
    if (e.source === "calendar" && !e.attended) { const ev = S.snap && S.snap.calendar.find(x => x.id === e.eventId); if (ev) return new Date(ev.start).toISOString(); }
    if (e.origin === "notebook-log" && e.date) { const d = new Date(`${e.date}T${e.time || "00:00"}:00`); if (!isNaN(d)) return d.toISOString(); }
    return null;
  }
  function commit() {
    const next = { entries: S.entries, removedCal: S.removedCal, domainMap: learned(S.rules), flags: S.flags };
    const evs = R2.diff(S.view0, next, S.machine, S.clock, tsFor);
    if (!evs.length) return Promise.resolve();
    S.own.push(...evs); recompute();
    if (isExample()) return Promise.resolve();
    return track(Promise.all([DB.set("ownEvents", S.own), scheduleWrite()]));
  }
  let wTimer = null, wPromise = null, wResolve = null;
  function scheduleWrite() {
    if (!S.dir) return Promise.resolve();
    if (!wPromise) wPromise = new Promise(r => wResolve = r);
    clearTimeout(wTimer); wTimer = setTimeout(async () => { const r = wResolve; wPromise = null; await writeOwn(); r(); }, 300);
    return track(wPromise);
  }
  async function writeOwn() {
    if (!S.dir || !S.granted || isExample() || locked()) return;
    const inner = R2.fileName(S.machine), name = S.vault.kr ? inner + ENC : inner;   // 00.03: encrypted folder → time-<machine>.json.enc
    try {
      let text = R2.serialize(S.machine, S.own, new Date().toISOString(), S.myReports);
      if (S.vault.kr) text = await V.encrypt(S.vault.key, S.vault.kr, "time", text);
      const f = await writeText(name, text); S.seen[name] = f.lastModified + ":" + f.size; S.fileEvents[inner] = S.own.filter(e => e.machine === S.machine); delete S.fileProblems[name];
      if (S.hub && !S.hubOnly && S.vault.kr) { try { await S.hub.write(name, text, "sync", { mtime: Number(f.lastModified) || Date.now() }); delete S.hubState.pending; } catch (e) { S.hubState.pending = true; S.hubState.error = e.message || String(e); } }
    } catch (e) { S.problems.push(`could not write ${name}: ${e.message || e}`); }
    renderSync();
  }
  async function setupMachine() {
    S.machine = await DB.get("machine");
    const q = new URLSearchParams(location.search).get("machine");
    if (!S.machine && R2.validMachine(q)) { S.machine = q; await DB.set("machine", q); }
    if (!S.machine) { S.machine = await askMachine(); await DB.set("machine", S.machine); }
    $("#machine").textContent = "💻 " + S.machine; $("#machine").title = "This machine: " + S.machine + " (writes Data/time-" + S.machine + ".json)";
  }
  // One-time: 00.01 local entries -> this machine's events. Runs once the snapshot is known, so meeting entries keep
  // their meeting's start as their stamp (F2a: never now()).
  async function migrateV01(raw) {
    if (await DB.get("migratedV2")) return;
    const legacy = (await DB.get("timeEntries")) || [], tomb = (await DB.get("calTombstones")) || [], rules = await DB.get("audienceRules");
    const bad = []; if (!Array.isArray(legacy)) bad.push("time entries"); if (!Array.isArray(tomb)) bad.push("removed-meeting list");
    // DI4: drop malformed items (null, numbers, strings) from the 00.01 lists before any migration step, with a warning
    let dropped = 0;
    const legacyOk = Array.isArray(legacy) ? legacy.filter(e => { const ok = e && typeof e === "object" && typeof e.id === "string"; if (!ok) dropped++; return ok; }) : legacy;
    const tombOk = Array.isArray(tomb) ? tomb.filter(t => { const ok = typeof t === "string"; if (!ok) dropped++; return ok; }) : tomb;
    if (dropped) bad.push(`${dropped} malformed item${dropped > 1 ? "s" : ""}`);
    if (Array.isArray(legacyOk)) R.migrateLogEntries(legacyOk);
    const cal = (raw && Array.isArray(raw.calendar)) ? raw.calendar : [], startOf = id => { const ev = cal.find(x => x.id === id); return ev ? { start: ev.start, end: ev.end, account: ev.account } : null; };
    if (bad.length) banner(`⚠ Incomplete: the 00.01 ${bad.join(" and ")} stored in this browser couldn't be read and were skipped. Other data moved normally.`, true);
    const evs = R2.migrationEvents(legacyOk, tombOk, rules && rules.domainMap, R.DEFAULT_RULES.domainMap, S.machine, startOf);
    if (evs.length) { S.own = R2.dedupe(S.own.concat(evs)); await DB.set("ownEvents", S.own); S.migrated = evs.length; }
    await DB.set("migratedV2", { at: new Date().toISOString(), events: evs.length });
    recompute();
  }
  // D5 repair: re-stamp this machine's own future stamps at now (new events), write the file, reload.
  async function repairClock() {
    const now = Date.now(), others = [].concat(...Object.values(S.fileEvents)).filter(e => e.machine !== S.machine);
    const otherTimes = Object.entries(S.fileUpdated || {}).filter(([n]) => R2.fileMachine(n) !== S.machine).map(([, t]) => t);
    if (R2.clockLooksBehind(others, otherTimes, now)) {   // DG5c: repairing with a slow clock would back-date your edits
      banner("⚠ Repair refused: this computer's clock looks behind another machine's (a stamp or file time from it is more than 5 min ahead). Set the date and time to automatic on both computers, then try again.", true); return; }
    const cal = S.snap ? S.snap.calendar : [], startOf = id => { const ev = cal.find(x => x.id === id); return ev ? { start: ev.start, end: ev.end } : null; };
    const r = R2.restamp(S.own, S.machine, R2.clock(), now, startOf);
    if (!r.changed) { toast("No time stamps from this computer are ahead of its clock. Nothing to repair."); return; }
    if (!confirm(`Re-stamp ${r.changed} change(s) made on this computer while its clock was ahead? They are placed right after this computer's last correct stamp (${new Date(r.at).toLocaleString()}), so anything the other computer changed since then still wins. Do this only after this clock is set correctly.`)) return;
    S.own = r.events; await DB.set("ownEvents", S.own); await writeOwn(); toast(`Re-stamped ${r.changed}. Reloading…`); setTimeout(reloadSafely, 600);
  }
  function askMachine() {
    return new Promise(res => {
      const d = document.createElement("div"); d.className = "overlay open"; d.id = "machinedlg";
      d.innerHTML = `<div class="dlg" role="dialog" aria-label="Name this machine"><b style="font-size:14px">Name this machine</b>
        <p>Each computer that opens the dashboard needs its own short name. Time you log here is saved as <code>Data/time-&lt;name&gt;.json</code>. Use lower-case letters and digits only, and a different name on each computer.</p>
        <div style="display:flex;gap:6px;margin:6px 0"><button class="btn" data-pick="mac">mac</button><button class="btn" data-pick="workpc">workpc</button></div>
        <input id="mach-name" autocomplete="off" aria-label="Machine name" placeholder="e.g. mac">
        <div id="mach-err" class="faint" style="margin-top:4px">1–20 characters: a–z, 0–9.</div>
        <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn primary" id="mach-ok" disabled>Use this name</button></div></div>`;
      document.body.appendChild(d);
      const inp = $("#mach-name"), ok = $("#mach-ok"), upd = () => { ok.disabled = !R2.validMachine(inp.value); };
      d.querySelectorAll("[data-pick]").forEach(b => b.onclick = () => { inp.value = b.dataset.pick; upd(); });
      inp.oninput = upd; ok.onclick = () => { if (!R2.validMachine(inp.value)) return; d.remove(); res(inp.value); };
    });
  }
  async function permOK(h) { try { return (await h.queryPermission({ mode: "readwrite" })) === "granted"; } catch (e) { return false; } }
  async function connectStored() {
    if (window.DASH_TEST_FS) { S.dirStored = window.DASH_TEST_FS; if (!window.DASH_TEST_FS.denied) { S.dir = S.dirStored; S.granted = true; } return; }   // test harness only (denied: a folder whose permission lapsed)
    let h = null; try { h = await DB.get("dataDir"); } catch (e) { h = null; }
    if (!h || !h.queryPermission) return;
    S.dirStored = h; if (await permOK(h)) { S.dir = h; S.granted = true; }
  }
  async function connectFolder() {
    try {
      if (S.dirStored && !S.granted && S.dirStored.requestPermission) {   // reconnect: one click, same folder
        if ((await S.dirStored.requestPermission({ mode: "readwrite" })) === "granted") { S.dir = S.dirStored; S.granted = true; await afterConnect(); return; }
      }
      if (!window.showDirectoryPicker) { banner("This browser can't connect a folder. Use File → GitHub sync… (works on iPad), or open the dashboard in Edge or Chrome.", true); return; }
      const h = await window.showDirectoryPicker({ id: "dash-data", mode: "readwrite" });
      if (h.name !== "Data" && !confirm(`You picked "${h.name}". The dashboard expects the Dashboard/Data folder. Use "${h.name}" anyway?`)) return;
      if ((await h.queryPermission({ mode: "readwrite" })) !== "granted" && (await h.requestPermission({ mode: "readwrite" })) !== "granted") { banner("Folder access was not granted.", true); return; }
      try { await DB.set("dataDir", h); } catch (e) { banner("Connected for this session only (the browser would not save the folder handle).", true); }
      S.dir = S.dirStored = h; S.granted = true; await afterConnect();
    } catch (e) { if (e && e.name !== "AbortError") banner("Could not connect the folder: " + (e.message || e), true); }
  }
  async function afterConnect() {
    S.seen = {}; await syncNow(true);
    if (!S.own.length || !Object.keys(S.fileEvents).includes(R2.fileName(S.machine))) await writeOwn();
    toast("Data folder connected. Syncing every " + POLL_MS / 1000 + " s.");
  }
  // ---------- encryption (00.03) ----------
  // A Data folder with keyring.json is encrypted: every data file is <name>.enc (AES-256-GCM, js/vault.js), plaintext data files
  // found there are encrypted on the next sync and (if you agreed) deleted. Without keyring.json the folder works as in 00.02.
  const V = DASH.vault, ENC = ".enc", KEYRING = "keyring.json";
  const SNAP_NAMES = ["inbox-snapshot.json", "inbox-snapshot.js"].concat(CFG.snapshotNames || []), LOG_NAMES = ["notebook-log.js"].concat(CFG.notebookLogNames || []);
  S.vault = { kr: null, key: null, locked: false, plainLeft: [], plainDone: {}, adopted: [], snapUndeleted: {}, snapWaiting: null, refused: {} };
  const locked = () => !!(S.vault.kr && !S.vault.key);
  // "time-mac.json.enc" → "time-mac.json"; a OneDrive conflict copy "time-mac.json-WORKPC.enc" → "time-mac-WORKPC.json"
  function innerName(n) { if (!/\.enc$/i.test(n)) return n; const b = n.slice(0, -4); return /\.(json|js)$/i.test(b) ? b : b.replace(/\.(json|js)([^.]*)$/i, "$2.$1"); }
  const isSnapName = n => SNAP_NAMES.includes(n) || /^inbox-snapshot(?:[^a-z0-9][^/]*)?\.jso?n?$/i.test(n);
  const isLogName = n => LOG_NAMES.includes(n) || /^notebook-log(?:[^a-z0-9][^/]*)?\.js$/i.test(n);
  const CAL_NAME = "calendar-snapshot.json", TRIPS_NAME = "trips.json", PROJ_NAME = "projects.json", STORE_NAME = "projects-store.json", ACC_NAME = "accounts-store.json", CONTACTS_NAME = "contacts.json";   // 00.09.000: account plans + contacts, encrypted only   // 00.07.000: optional Planner export feed + the Projects store (source of truth), both encrypted only
  const FEED_READ = { calendar: raw => R.readCalendar(raw), trips: raw => R.readTrips(raw), projects: raw => R.readProjects(raw), projstore: raw => R.readStore(raw), accstore: raw => A.readAccStore(raw), contacts: raw => A.readContacts(raw) };
  const stampOf = raw => raw.generated_at || raw.updated_at;
    // 00.06.000: calendar / travel assistants feeds (encrypted only)
  const purposeOf = n => R2.isTimeFile(n) ? "time" : n === CAL_NAME ? "calendar" : n === TRIPS_NAME ? "trips" : n === PROJ_NAME ? "projects" : n === STORE_NAME ? "projstore" : n === ACC_NAME ? "accstore" : n === CONTACTS_NAME ? "contacts" : isSnapName(n) ? "snapshot" : isLogName(n) ? "log" : null;
  async function writeText(name, text) {
    const fh = await S.dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();            // Chromium writes to a temporary swap file; close() swaps it in (atomic)
    await w.write(text); await w.close();
    if (name === KEYRING && S.hub && !S.hubOnly) { try { await S.hub.write(KEYRING, text, "sync"); } catch (e) { S.hubState.error = e.message || String(e); } }   // 00.04: a new passphrase reaches the hub at once
    return fh.getFile();
  }
  // F4: encrypted files go to <name>.tmp first, are read back and decrypted, and only then replace <name>.
  // A failed write leaves the previous good file untouched.
  async function writeVerified(target, purpose, body) {
    const ct = await V.encrypt(S.vault.key, S.vault.kr, purpose, body), tmp = target + ".tmp";
    await writeText(tmp, ct);
    let good = false; try { good = await V.decrypt(S.vault.key, S.vault.kr, (await readName(tmp)).text, purpose) === body; } catch (e) { good = false; }
    if (!good) { try { await S.dir.removeEntry(tmp); } catch (e) { /* left for the next try */ } throw new Error("read-back check failed; the previous encrypted copy is kept"); }
    const h = await S.dir.getFileHandle(tmp);
    if (h.move) { try { await h.move(target); return; } catch (e) { /* fall back below */ } }
    // Fallback (no move(), or it failed): write the target in place, read it back, and put the previous bytes back if it doesn't check out.
    let old = null; try { old = (await readName(target)).text; } catch (e) { old = null; }
    await writeText(target, ct);
    let ok = false; try { ok = await V.decrypt(S.vault.key, S.vault.kr, (await readName(target)).text, purpose) === body; } catch (e) { ok = false; }
    if (!ok) { if (old != null) { try { await writeText(target, old); } catch (e) { /* reported below */ } } try { await S.dir.removeEntry(tmp); } catch (e) { /* harmless */ } throw new Error("read-back check failed; the previous encrypted copy was put back"); }
    try { await S.dir.removeEntry(tmp); } catch (e) { /* harmless */ }
  }
  async function readName(name) { const h = await S.dir.getFileHandle(name); return readText(h); }
  async function loadKeyring() {
    try { const r = await readName(KEYRING); S.seen[KEYRING] = r.sig; const kr = V.parseKeyring(r.text);
      if (S.vault.kr && S.vault.kr.keyId !== kr.keyId) { S.vault.key = null; }   // a different keyring replaced this one
      S.vault.kr = kr; await DB.requireEncryption(); return kr; }
    catch (e) { if (e && e.name !== "NotFoundError") S.problems.push(`${KEYRING}: ${e.message || e}`); return null; }
  }
  async function ensureUnlocked() {
    if (!S.vault.kr || S.vault.key) return true;
    try { const rem = await DB.get("vaultKey"); if (rem && rem.keyId === S.vault.kr.keyId && rem.key) { S.vault.key = rem.key; S.vault.remembered = true; await activateCache(); return true; } } catch (e) { /* not remembered */ }
    const key = await unlockDialog();
    if (!key) { DB.setCipher(null); S.vault.locked = true; banner("🔒 The Data folder is encrypted and locked. Nothing is read from or written to it until you unlock (File → Encryption…).", true); return false; }
    S.vault.key = key; S.vault.locked = false; await activateCache(); return true;
  }
  // 00.03.002: after the older build's cache was copied (and, for an encrypted folder, encrypted) and every value reads back the same,
  // offer once to delete the old plaintext database. Never without confirmation; never if verification fails or the cache is locked.
  async function offerLegacyDelete() {
    const info = await DB.get("legacyImported"); if (!info || info.deleted || info.declined) return;
    if (await DB.dbGone(info.from)) { await DB.set("legacyImported", Object.assign({}, info, { deleted: new Date().toISOString() })); return; }   // a queued delete finished later
    if (locked()) return;
    const v = await DB.verifyLegacy(info.from);
    if (!v.ok) { S.legacyVerify = v; if (v.why && !/can't be read/.test(v.why)) banner(`⚠ The older browser cache was copied, but it doesn't match on read-back (${v.why}); it is kept.`, true); return; }
    const enc = !!S.vault.kr;
    const yes = confirm(`Your data from the older version of this dashboard was copied into this one and checked (${v.keys} item(s), all match${enc ? ", now stored encrypted" : ""}).\n\nThe older version's copy in this browser is still stored unencrypted. Delete it now?\n\nOK = delete the old copy. Cancel = keep it (you won't be asked again).`);
    if (yes) { const ok = await DB.deleteDb(info.from); await DB.set("legacyImported", Object.assign({}, info, ok ? { deleted: new Date().toISOString() } : {})); toast(ok ? "Old unencrypted browser copy deleted." : "The old copy is waiting to be deleted: close any other tab of the older version. It's checked again on the next launch."); }
    else await DB.set("legacyImported", Object.assign({}, info, { declined: new Date().toISOString() }));
  }
  // 00.03.001: the browser cache uses the same data key (purpose "cache"). On unlock: plaintext cache values are encrypted in place,
  // and anything this page holds in memory (e.g. edits made while locked) is merged back in.
  async function activateCache() {
    const key = S.vault.key, kr = S.vault.kr; if (!key || !kr) return;
    DB.setCipher({ enc: t => V.encrypt(key, kr, "cache", t), dec: t => V.decrypt(key, kr, t, "cache") });
    await DB.requireEncryption(); S.cacheConverted = await DB.encryptExisting();
    if (S.own && S.own.length) { const o = (await DB.get("ownEvents")) || []; S.own = R2.dedupe(o.concat(S.own)); await DB.set("ownEvents", S.own); }
  }
  async function rememberKey(on) { if (on) { await DB.set("vaultKey", { keyId: S.vault.kr.keyId, key: S.vault.key }); S.vault.remembered = true; } else { await DB.set("vaultKey", undefined); S.vault.remembered = false; } }
  function dialog(id, html, wire) {
    return new Promise(res => {
      const d = document.createElement("div"); d.className = "overlay open"; d.id = id;
      d.innerHTML = `<div class="dlg vaultdlg" role="dialog" aria-modal="true">${html}</div>`; document.body.appendChild(d);
      const done = v => { d.remove(); res(v); }; wire(d, done); const f = d.querySelector("input,button.primary"); if (f) f.focus();
    });
  }
  const passFields = (a, b) => `<label class="vlab">${a}<input type="password" id="vp1" autocomplete="new-password"></label>
      <label class="vlab">${b}<input type="password" id="vp2" autocomplete="new-password"></label>`;
  function checkNew(d) { const a = d.querySelector("#vp1").value, b = d.querySelector("#vp2").value, p = V.passProblem(a); return p || (a !== b ? "The two passphrases don't match." : null); }
  function unlockDialog() {
    return dialog("vaultunlock", `<b class="vt">🔒 Unlock the Data folder</b>
      <p>This Data folder is encrypted. Enter the passphrase to read and save your data on this computer.</p>
      <div id="vu-pass"><label class="vlab">Passphrase<input type="password" id="vault-pass" autocomplete="current-password"></label></div>
      <div id="vu-rk" class="hidden"><label class="vlab">Recovery key<input id="vault-rk" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"></label>
        <p class="faint">After the recovery key opens the folder, you set a new passphrase.</p>${passFields("New passphrase", "New passphrase again")}</div>
      <label class="vchk"><input type="checkbox" id="vault-remember" checked> Remember on this computer (stays unlocked until you choose Lock or Forget)</label>
      <div id="vault-err" class="verr" role="alert"></div>
      <div class="vbtns"><button class="btn" id="vault-later">Not now</button><button class="btn" id="vault-userk">Use recovery key</button><button class="btn primary" id="vault-ok">Unlock</button></div>`,
    (d, done) => {
      let rk = false; const err = m => { d.querySelector("#vault-err").textContent = m || ""; };
      d.querySelector("#vault-later").onclick = () => done(null);
      d.querySelector("#vault-userk").onclick = () => { rk = !rk; d.querySelector("#vu-rk").classList.toggle("hidden", !rk); d.querySelector("#vu-pass").classList.toggle("hidden", rk); d.querySelector("#vault-userk").textContent = rk ? "Use passphrase" : "Use recovery key"; err(""); };
      const go = async () => {
        const ok = d.querySelector("#vault-ok"); ok.disabled = true; err("Checking…");
        try {
          let key;
          if (!rk) key = await V.unlock(S.vault.kr, d.querySelector("#vault-pass").value);
          else {
            const p = checkNew(d); if (p) throw new Error(p);
            const v = d.querySelector("#vault-rk").value; if (!V.validRecovery(v)) throw new Error("A recovery key has 32 letters and digits (dashes optional).");
            key = await V.unlockWithRecovery(S.vault.kr, v);
            const kr = await V.changePassphrase(S.vault.kr, v, true, d.querySelector("#vp1").value);
            await writeText(KEYRING, JSON.stringify(kr, null, 1) + "\n"); S.vault.kr = kr; toast("New passphrase set. Use it on every computer from now on.");
          }
          S.vault.key = key; if (d.querySelector("#vault-remember").checked) await rememberKey(true);
          done(key);
        } catch (e) { err(e.message || String(e)); ok.disabled = false; }
      };
      d.querySelector("#vault-ok").onclick = go; d.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
    });
  }
  function recoveryDialog(rk, title) {
    return dialog("vaultrk", `<b class="vt">${title}</b>
      <p>Keep this recovery key in <b>two places</b>: your <b>password manager</b> and a <b>printed copy</b> stored somewhere safe. Not in the Data folder, OneDrive or email. It's the <b>only</b> way back in if the passphrase is forgotten, and it's shown once.</p>
      <div class="rkbox mono" id="rk-value">${esc(rk)}</div>
      <div class="vbtns" style="justify-content:flex-start"><button class="btn" id="rk-copy">Copy</button><button class="btn" id="rk-print">Print…</button><button class="btn" id="rk-save">Save as .txt…</button></div>
      <label class="vchk"><input type="checkbox" id="rk-done"> I've saved it in my password manager and printed a copy</label>
      <div class="vbtns"><button class="btn primary" id="rk-ok" disabled>Continue</button></div>`,
    (d, done) => {
      d.querySelector("#rk-done").onchange = e => { d.querySelector("#rk-ok").disabled = !e.target.checked; };
      d.querySelector("#rk-copy").onclick = () => { try { navigator.clipboard.writeText(rk); toast("Recovery key copied. Paste it into your password manager, then clear the clipboard."); } catch (e) { toast("Copy failed; write it down instead."); } };
      d.querySelector("#rk-print").onclick = () => { const w = window.open("", "_blank", "width=600,height=400"); if (!w) { toast("Pop-up blocked: write the key down instead."); return; }
        w.document.write(`<title>Recovery key</title><body style="font:16px sans-serif;padding:24px"><h2>Activity Dashboard recovery key</h2><p>Keyring id: ${esc(S.vault.kr ? S.vault.kr.keyId : "")}</p><p style="font:20px monospace">${esc(rk)}</p><p>Keep with your important papers. Not in the Data folder.</p></body>`); w.document.close(); w.focus(); w.print(); };
      d.querySelector("#rk-save").onclick = () => download("activity-dashboard-recovery-key.txt", null, `Activity Dashboard recovery key\nKeyring id: ${S.vault.kr ? S.vault.kr.keyId : ""}\n\n${rk}\n\nKeep this off the synced Data folder.\n`);
      d.querySelector("#rk-ok").onclick = () => done(true);
    });
  }
  async function turnOnEncryption() {
    if (!S.dir || !S.granted) { banner("Connect the Data folder first (File → Connect Data folder…), then turn on encryption.", true); return; }
    if (await loadKeyring()) { toast("This Data folder is already encrypted (another computer turned it on)."); await ensureUnlocked(); S.seen = {}; await syncNow(true); return; }
    const setup = await dialog("vaultsetup", `<b class="vt">🔐 Encrypt the Data folder</b>
      <p>Every data file in the connected Data folder, and this browser's own cache, is encrypted on this computer before it's saved (AES-256-GCM). Other computers need the same passphrase. The app can't recover a lost passphrase. Only the recovery key can, so next you'll save it in your password manager and print a copy.</p>
      ${passFields("Passphrase (12+ characters; a few unrelated words works well)", "Passphrase again")}
      <label class="vchk"><input type="checkbox" id="vs-remember" checked> Remember on this computer</label>
      <label class="vchk"><input type="checkbox" id="vs-delete" checked> After the encrypted copies are checked, delete the plaintext originals from the Data folder</label>
      <div id="vs-err" class="verr" role="alert"></div>
      <div class="vbtns"><button class="btn" id="vs-cancel">Cancel</button><button class="btn primary" id="vs-ok">Encrypt</button></div>`,
    (d, done) => {
      d.querySelector("#vs-cancel").onclick = () => done(null);
      d.querySelector("#vs-ok").onclick = async () => {
        const p = checkNew(d); if (p) { d.querySelector("#vs-err").textContent = p; return; }
        d.querySelector("#vs-ok").disabled = true; d.querySelector("#vs-err").textContent = "Creating the key…";
        try { const r = await V.createKeyring(d.querySelector("#vp1").value);
          done(Object.assign(r, { remember: d.querySelector("#vs-remember").checked, del: d.querySelector("#vs-delete").checked })); }
        catch (e) { d.querySelector("#vs-err").textContent = e.message || String(e); d.querySelector("#vs-ok").disabled = false; }
      };
    });
    if (!setup) return;
    S.vault.kr = setup.keyring; S.vault.key = setup.key;
    await recoveryDialog(setup.recoveryKey, "Save your recovery key");
    if (await loadKeyring() && S.vault.kr.keyId !== setup.keyring.keyId) { banner("Another computer encrypted this folder at the same moment. Its keyring is kept; unlock with its passphrase.", true); S.vault.key = null; await ensureUnlocked(); return; }
    S.vault.kr = setup.keyring; S.vault.key = setup.key;
    await writeText(KEYRING, JSON.stringify(setup.keyring, null, 1) + "\n"); await activateCache();
    if (setup.remember) await rememberKey(true);
    const prefs = (await DB.get("prefs")) || {}; prefs.deletePlain = !!setup.del; await DB.set("prefs", prefs);
    S.seen = {}; await syncNow(true); await writeOwn();
    toast(`Data folder encrypted.${S.vault.plainLeft.length ? ` ${S.vault.plainLeft.length} plaintext original(s) kept.` : " Plaintext originals deleted."}`);
  }
  // Plaintext data files in an encrypted folder: encrypt each into its .enc twin (merging with one that exists), read it back to check,
  // then delete the original if this computer's setting says so. Returns how many were encrypted.
  async function encryptPlain(list) {
    if (!S.vault.key) return { n: 0, left: list.map(x => x[0]) };
    const prefs = (await DB.get("prefs")) || {}; let n = 0; const left = [];
    for (const [name, sig] of list) {
      try {
        const text = (await readName(name)).text, purpose = purposeOf(name);
        let target, body;
        if (purpose === "time") {
          target = name + ENC; const p = R2.parseTimeFile(text, name); if (!p.machine) throw new Error(p.bad || "not a time log");
          let events = p.events, reports = p.reports;
          try { const old = await V.decrypt(S.vault.key, S.vault.kr, (await readName(target)).text, "time"), q = R2.parseTimeFile(old, name); events = R2.dedupe(q.events.concat(events)); } catch (e) { if (e && e.name !== "NotFoundError" && !/not found/i.test(e.message || "")) throw e; }
          body = R2.serialize(p.machine, events, new Date().toISOString(), reports);
        } else if (purpose === "snapshot") {
          target = "inbox-snapshot.json" + ENC; const raw = parseSnapshotText(name, text);
          try { R.readSnapshot(raw); } catch (e) { throw new Error("snapshot rejected (" + e.message + "); not encrypted or uploaded, the previous one is kept"); }   // 00.04.001
          if (raw && raw.example) throw new Error("example snapshot; example data is never encrypted into the Data folder");   // 00.09.001
          if (futureSnap(raw)) { const e = new Error("generated_at is in the future"); e.refused = true; throw e; }   // F1 / D2: listed apart from plaintext originals
          body = JSON.stringify(raw);
          try { const old = JSON.parse(await V.decrypt(S.vault.key, S.vault.kr, (await readName(target)).text, "snapshot")); R.readSnapshot(old); if (!futureSnap(old) && new Date(old.generated_at) >= new Date(raw.generated_at)) body = null; } catch (e) { /* none yet, or the old one is invalid: replace it */ }   // 00.09.001: same generated_at = same snapshot, no rewrite
        } else if (FEED_READ[purpose]) {   // 00.06.000 (00.07.000: + projects): validate, keep the newer copy
          target = name + ENC; const raw = JSON.parse(text); FEED_READ[purpose](raw); body = JSON.stringify(raw);
          try { const old = JSON.parse(await V.decrypt(S.vault.key, S.vault.kr, (await readName(target)).text, purpose)); if (Date.parse(stampOf(old)) > Date.parse(stampOf(raw))) body = null; } catch (e) { /* none yet */ }
        } else { target = "notebook-log.js" + ENC; parseLogJs(text); body = text; }
        if (body != null) {
          await writeVerified(target, purpose, body);
        }
        n++;
        if (purpose === "snapshot") {   // 00.09.001: a snapshot is a regenerated export: the plain file is always deleted once the encrypted copy checks out
          const gen = parseSnapshotText(name, text).generated_at; let gone = false;
          try { if (S.dir.removeEntry) { await S.dir.removeEntry(name); gone = true; } } catch (e) { /* reported below */ }
          if (!gone) { S.vault.plainDone[name] = sig; S.vault.snapUndeleted[name] = true; S.fileProblems[name] = `${name}: encrypted, but the plain file couldn't be deleted; delete it by hand`; }
          S.vault.adopted.push({ name, gen, used: body != null, gone });
          continue;
        }
        if (prefs.deletePlain && S.dir.removeEntry) await S.dir.removeEntry(name); else { S.vault.plainDone[name] = sig; left.push(name); }
      } catch (e) {
        if (e && e.refused) { S.vault.refused[name] = true; S.fileProblems[name] = `${name}: refused (its date is in the future), not encrypted and no encrypted copy; delete it by hand or with File → Encryption… → Delete refused file`; continue; }
        S.fileProblems[name] = `${name}: plaintext file not encrypted (${e.message || e})`; left.push(name); }
    }
    return { n, left };
  }
  // D2: a refused (future-dated) file has its own confirmation; it deletes only that file and leaves the delete-plaintext setting alone.
  async function deleteRefused(name) {
    if (!S.vault.refused[name]) return;
    if (!confirm(`Delete ${name} from the Data folder?\n\nIt was refused because its date is in the future.  It has NO encrypted copy, so deleting it removes it for good.\n\nOK = delete this one file. Cancel = keep it.`)) return;
    try { await S.dir.removeEntry(name); delete S.vault.refused[name]; delete S.fileProblems[name]; toast(`${name} deleted.`); }
    catch (e) { toast(`${name} couldn't be deleted (${e.message || e}).`); }
    S.seen = {}; await syncNow(true);
  }
  async function deletePlainNow() {
    const left = S.vault.plainLeft.filter(n => !S.vault.refused[n]); if (!left.length) { toast("No plaintext data files are left in the Data folder."); return; }
    if (!confirm(`Delete ${left.length} plaintext file(s) from the Data folder? Their encrypted copies were checked.\n\n${left.join("\n")}`)) return;
    const prefs = (await DB.get("prefs")) || {}; prefs.deletePlain = true; await DB.set("prefs", prefs);
    S.vault.plainDone = {}; S.seen = {}; await syncNow(true); toast("Plaintext originals deleted.");
  }
  async function encryptionDialog() {
    if (!S.vault.kr) { await turnOnEncryption(); return; }
    if (!S.vault.key) { if (await ensureUnlocked()) { await cleanupExampleHistory(); S.seen = {}; if (!S.hub) await hubBoot(); await syncNow(true); } return; }
    S.vault.hasHistBackup = (await DB.get("historyBackup0901")) !== undefined;   // L1
    const act = await dialog("vaultmenu", `<b class="vt">🔐 Encryption</b>
      <p>This Data folder is encrypted (keyring <span class="mono">${esc(S.vault.kr.keyId)}</span>, created ${esc(new Date(S.vault.kr.created).toLocaleDateString())}). It's unlocked on this computer${S.vault.remembered ? " and remembered" : " for this session only"}.</p>
      ${S.vault.plainLeft.length ? `<p class="verr">⚠ ${S.vault.plainLeft.length} plaintext file(s) are still in the Data folder: ${esc(S.vault.plainLeft.join(", "))}</p>` : ""}
      <div class="vcol">
        <button class="btn" data-v="pass">Change passphrase…</button>
        <button class="btn" data-v="rk">New recovery key…</button>
        <button class="btn" data-v="rem">${S.vault.remembered ? "Forget on this computer" : "Remember on this computer"}</button>
        ${S.vault.plainLeft.length ? `<button class="btn" data-v="del">Delete plaintext originals…</button>` : ""}
        ${Object.keys(S.vault.refused).map(n => `<button class="btn" data-v="ref:${esc(n)}">Delete refused file ${esc(n)}…</button>`).join("")}
        ${S.vault.hasHistBackup ? `<button class="btn" data-v="discardHist">Discard history backup…</button>` : ""}
        <button class="btn" data-v="lock">Lock now</button>
      </div><div class="vbtns"><button class="btn primary" data-v="">Close</button></div>`,
    (d, done) => d.querySelectorAll("[data-v]").forEach(b => b.onclick = () => done(b.dataset.v)));
    if (act === "rem") { await rememberKey(!S.vault.remembered); toast(S.vault.remembered ? "Remembered on this computer." : "Forgotten: you'll be asked for the passphrase next time."); }
    // Lock: the hub client (and the token it holds) and the name codec leave memory too; unlocking attaches them again.
    if (act === "lock") { detachHub(); hubCodec = null; DB.setCipher(null); S.vault.key = null; await rememberKey(false); S.vault.locked = true; banner("🔒 Locked. File → Encryption… to unlock.", true); renderSync(); }
    if (act === "del") await deletePlainNow();
    if (act === "discardHist" && confirm("Discard the backup of your trend history kept by the 00.09.001 cleanup?\n\nYour current history is not changed.  Without the backup, the removed example weeks can't be put back.\n\nOK = discard. Cancel = keep it (it is discarded on its own after 30 days).")) { await DB.set("historyBackup0901", undefined); S.vault.hasHistBackup = false; toast("History backup discarded."); }
    if (act && act.startsWith("ref:")) await deleteRefused(act.slice(4));
    if (act === "pass") {
      const r = await dialog("vaultpass", `<b class="vt">Change passphrase</b><label class="vlab">Current passphrase<input type="password" id="vc-old"></label>${passFields("New passphrase", "New passphrase again")}
        <div id="vc-err" class="verr" role="alert"></div><div class="vbtns"><button class="btn" id="vc-cancel">Cancel</button><button class="btn primary" id="vc-ok">Change</button></div>`,
      (d, done) => { d.querySelector("#vc-cancel").onclick = () => done(null);
        d.querySelector("#vc-ok").onclick = async () => { const p = checkNew(d); if (p) { d.querySelector("#vc-err").textContent = p; return; }
          try { done(await V.changePassphrase(S.vault.kr, d.querySelector("#vc-old").value, false, d.querySelector("#vp1").value)); } catch (e) { d.querySelector("#vc-err").textContent = e.message; } }; });
      if (r) { await writeText(KEYRING, JSON.stringify(r, null, 1) + "\n"); S.vault.kr = r; toast("Passphrase changed. Your other computers ask for the new one next time they're locked."); }
    }
    if (act === "rk") {
      const pass = await dialog("vaultnewrk", `<b class="vt">New recovery key</b><p>The old recovery key stops working.</p><label class="vlab">Passphrase<input type="password" id="vr-pass"></label>
        <div id="vr-err" class="verr" role="alert"></div><div class="vbtns"><button class="btn" id="vr-cancel">Cancel</button><button class="btn primary" id="vr-ok">Make new key</button></div>`,
      (d, done) => { d.querySelector("#vr-cancel").onclick = () => done(null);
        d.querySelector("#vr-ok").onclick = async () => { try { done(await V.replaceRecovery(S.vault.kr, d.querySelector("#vr-pass").value)); } catch (e) { d.querySelector("#vr-err").textContent = e.message; } }; });
      if (pass) { await recoveryDialog(pass.recoveryKey, "Your new recovery key"); await writeText(KEYRING, JSON.stringify(pass.keyring, null, 1) + "\n"); S.vault.kr = pass.keyring; toast("New recovery key saved in the keyring. The old one no longer works."); }
    }
  }
  // ---------- GitHub data hub (00.04) ----------
  // A private repo holds only keyring.json and *.enc (js/hub.js refuses anything else). Each computer has its own fine-grained
  // token (one repo, Contents read/write). It's kept in IndexedDB only as a vault envelope (purpose "token") under the data key,
  // so it's unreadable while locked and never in plain localStorage or git. With a Data folder: the folder is the backup and
  // encrypted files are mirrored both ways each sync. Without one (iPad Safari): the hub is the store (S.dir = Hub.dir).
  const H = DASH.hub;
  S.hubState = {};
  async function hubCfg() { try { return (await DB.get("hubCfg")) || null; } catch (e) { return null; } }
  // 00.04 N3: data files go to the hub under opaque blob names (js/hub.js opaque/codec); the codec needs the unlocked data key.
  let hubCodec = null;
  async function getHubCodec() {
    if (!S.vault.key || !S.vault.kr) throw new Error("locked: unlock first");
    if (!hubCodec || hubCodec.keyId !== S.vault.kr.keyId || hubCodec.key !== S.vault.key) { const cd = await H.codec(S.vault.key, S.vault.kr); cd.key = S.vault.key; hubCodec = cd; }
    return hubCodec;
  }
  function attachHub(repo, token) {
    const c = H.opaque(H.client({ repo, token }), getHubCodec); S.hub = c; S.hubState = { repo };
    if (!S.dir || S.dir.isHub) { S.dir = S.dirStored = H.dir(c); S.granted = true; S.hubOnly = true; } else S.hubOnly = false;
    return c;
  }
  function detachHub() { const was = S.hubOnly; S.hub = null; S.hubState = {}; if (was) { S.dir = S.dirStored = null; S.granted = false; S.hubOnly = false; } }
  async function hubBoot() {
    const cfg = await hubCfg(); if (!cfg || !cfg.repo || !cfg.tokenEnv || !cfg.keyring) return;
    if (!S.dir) {                                   // no folder: GitHub is the store. Unlock with the keyring saved at setup.
      if (!S.vault.kr) { S.vault.kr = cfg.keyring; await DB.requireEncryption(); }
      if (!(await ensureUnlocked())) return;
    } else if (!S.vault.kr || !S.vault.key) return;
    if (S.vault.kr.keyId !== cfg.keyId) { S.hubState = { repo: cfg.repo, error: "GitHub sync was set up for a different keyring. Set it up again (File → GitHub sync…)." }; return; }
    let token; try { token = await V.decrypt(S.vault.key, S.vault.kr, cfg.tokenEnv, "token"); } catch (e) { S.hubState = { repo: cfg.repo, error: "The saved token can't be opened. Set up GitHub sync again." }; return; }
    attachHub(cfg.repo, token);
    if (S.hubOnly) { const kr = await loadKeyring(); if (kr && kr.keyId === cfg.keyId && JSON.stringify(kr) !== JSON.stringify(cfg.keyring)) { cfg.keyring = kr; await DB.set("hubCfg", cfg); } if (kr && !S.vault.key) await ensureUnlocked(); }
  }
  // 00.04 N1: decrypt + parse a hub file with the data key before it may replace anything in the local backup folder.
  // 00.04.001: decrypt + validate a copy (local or hub) and return its content stamp, so the mirror can pick the newer valid one.
  async function hubInspect(name, text) {
    const inner = innerName(name), purpose = purposeOf(inner); if (!purpose) return { ok: false, why: "unknown file type" };
    let plain; try { plain = await V.decrypt(S.vault.key, S.vault.kr, text, purpose); } catch (e) { return { ok: false, why: e.message || String(e) }; }
    try {
      if (purpose === "time") { const p = R2.parseTimeFile(plain, inner); if (p.bad || !p.machine) return { ok: false, why: p.bad || "not a time log" }; return { ok: true, stamp: p.updated_at }; }
      if (purpose === "log") { parseLogJs(plain); return { ok: true, stamp: null }; }
      if (FEED_READ[purpose]) { const raw = JSON.parse(plain); FEED_READ[purpose](raw); return { ok: true, stamp: stampOf(raw) }; }
      const raw = parseSnapshotText(inner, plain); R.readSnapshot(raw); return { ok: true, stamp: raw.generated_at };   // invalid snapshot (e.g. wrong source) = not ok
    } catch (e) { return { ok: false, why: e.message || String(e) }; }
  }
  async function hubMirror() {
    if (S.hubOnly || !S.hub || !S.dir || !S.granted || !S.vault.key) return;
    try {
      const r = await H.mirror(S.dir, S.hub, { ownFile: R2.fileName(S.machine) + ENC, message: "sync", inspect: hubInspect });
      S.hubState.last = new Date(); S.hubState.error = r.problems.length ? r.problems.join(" ") : null; S.hubState.up = r.up.length; S.hubState.down = r.down.length;
      if (r.down.includes(KEYRING)) await loadKeyring();
    } catch (e) { S.hubState.error = e.message || String(e); }
    if (S.hubState.error) S.problems.push("GitHub: " + S.hubState.error);
  }
  async function saveHub(repo, token) {
    const tokenEnv = await V.encrypt(S.vault.key, S.vault.kr, "token", token);
    await DB.set("hubCfg", { repo, keyId: S.vault.kr.keyId, keyring: S.vault.kr, tokenEnv, saved: new Date().toISOString() });
  }
  // Checks the repo (private, reachable, same keyring), then saves and attaches. Returns "ok" | "cancelled".
  async function hubConnect(repo, token) {
    const pr = H.repoProblem(repo) || H.tokenProblem(token); if (pr) throw new Error(pr);
    const c = H.client({ repo, token }), list = await c.test(), hasKr = list.some(x => x.name === KEYRING);
    const hubKr = hasKr ? V.parseKeyring((await c.read(KEYRING)).text) : null;
    if (S.dir && !S.dir.isHub) {                    // computer with a Data folder
      if (!S.vault.kr || !S.vault.key) throw new Error("Turn on encryption (and unlock) first: File → Encryption…. Only encrypted files go to GitHub.");
      if (hubKr && hubKr.keyId !== S.vault.kr.keyId) throw new Error("That repo already holds data from a different encryption setup (another keyring). Use an empty repo, or this folder's passphrase setup everywhere.");
      await saveHub(repo, token); attachHub(repo, token);
    } else if (hubKr) {                             // iPad / no folder, hub already set up by another computer
      if (!S.vault.kr || S.vault.kr.keyId !== hubKr.keyId) { S.vault.kr = hubKr; S.vault.key = null; await DB.requireEncryption(); }
      if (!(await ensureUnlocked())) return "cancelled";
      await saveHub(repo, token); attachHub(repo, token);
    } else {                                        // no folder and an empty hub: start encryption here, straight into GitHub
      attachHub(repo, token); await turnOnEncryption();
      if (!S.vault.kr || !S.vault.key) { detachHub(); return "cancelled"; }
      await saveHub(repo, token);
    }
    S.seen = {}; await syncNow(true); await writeOwn(); return "ok";
  }
  async function hubForget() { await DB.set("hubCfg", undefined); detachHub(); renderSync(); }
  async function hubDialog() {
    if (S.vault.kr && !S.vault.key && !(await ensureUnlocked())) return;
    const cfg = await hubCfg(), on = !!(cfg && S.hub);
    await dialog("hubdlg", `<b class="vt">☁ GitHub sync</b>
      ${on ? `<p>Connected to <span class="mono">${esc(cfg.repo)}</span>${S.hubOnly ? " (the store on this device)" : " (mirrored with the Data folder, which stays the backup)"}. ${S.hubState.error ? `<span class="verr">⚠ ${esc(S.hubState.error)}</span>` : S.hubState.last ? "Last sync " + hhmm(S.hubState.last) + "." : ""}</p>`
        : `<p>Sync through your own <b>private</b> GitHub repo. Only encrypted files (<code>.enc</code>) and <code>keyring.json</code> are sent; anything else is refused before it leaves this browser. Your passphrase and data key never leave this device.</p>`}
      <details class="hubsteps"${on ? "" : " open"}><summary>Make this computer's access token (2 minutes)</summary><ol>
        <li>Once only: on github.com create a <b>private</b> repo for the data (empty).</li>
        <li>github.com → your picture → <b>Settings</b> → <b>Developer settings</b> → <b>Personal access tokens</b> → <b>Fine-grained tokens</b> → <b>Generate new token</b>.</li>
        <li>Token name: this computer's name (<span class="mono">${esc(S.machine || "")}</span>). Expiration: <b>Custom</b>, one year from today.</li>
        <li>Repository access: <b>Only select repositories</b> → the data repo only.</li>
        <li>Repository permissions → <b>Contents: Read and write</b>. Leave everything else at No access (Metadata: Read-only is added automatically).</li>
        <li><b>Generate token</b>, copy it (starts <span class="mono">github_pat_</span>) and paste it below. Don't save it anywhere else.</li>
        <li>Lost a device? Delete its token on that same GitHub page. Other computers keep working.</li></ol></details>
      <label class="vlab">Repo (owner/name)<input id="hub-repo" autocomplete="off" spellcheck="false" placeholder="owner/activity-data-hub" value="${esc(cfg ? cfg.repo : "")}"></label>
      <label class="vlab">Access token for this computer${on ? " (leave empty to keep the saved one)" : ""}<input type="password" id="hub-token" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></label>
      <p class="faint">The token is stored only in this browser, encrypted with your data key. It's unreadable while the app is locked.</p>
      <div id="hub-err" class="verr" role="alert"></div>
      <div class="vbtns"><button class="btn" id="hub-cancel">Close</button>${cfg ? `<button class="btn" id="hub-off">Disconnect this computer</button>` : ""}<button class="btn primary" id="hub-ok">${on ? "Save" : "Connect"}</button></div>`,
    (d, done) => {
      const err = m => { d.querySelector("#hub-err").textContent = m || ""; };
      d.querySelector("#hub-cancel").onclick = () => done(null);
      const off = d.querySelector("#hub-off"); if (off) off.onclick = async () => { if (!confirm("Stop GitHub sync on this computer and forget its token here? Also delete the token on github.com.")) return; await hubForget(); toast("GitHub sync is off on this computer. Delete its token on github.com too."); done(null); };
      d.querySelector("#hub-ok").onclick = async () => {
        const repo = d.querySelector("#hub-repo").value.trim(), tok = d.querySelector("#hub-token").value.trim();
        if (on && !tok && cfg && repo === cfg.repo) { done(null); return; }
        const ok = d.querySelector("#hub-ok"); ok.disabled = true; err("Checking the repo…");
        try { d.style.display = "none"; const r = await hubConnect(repo, tok); d.style.display = "";
          if (r === "ok") { toast("GitHub sync connected."); done(true); } else { err("Not connected."); ok.disabled = false; } }
        catch (e) { d.style.display = ""; err(e.message || String(e)); ok.disabled = false; }
      };
    });
    renderSync();
  }
  // ---------- PWA (00.03): installable from https (GitHub Pages) or localhost; file:// keeps working without it ----------
  let installEvt = null;
  function registerPWA() {
    window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; const b = document.querySelector('[data-act="install"]'); if (b) b.classList.remove("hidden"); });
    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register("sw.js").catch(e => console.warn("service worker not registered", e));
  }
  async function installApp() {
    if (installEvt) { installEvt.prompt(); try { await installEvt.userChoice; } catch (e) { /* dismissed */ } installEvt = null; return; }
    toast(/^https?:$/.test(location.protocol) ? "In Edge: the ⋯ menu → Apps → Install this site as an app." : "Install works from the web address (https), not from a file opened on disk.");
  }
  async function readText(h) { const f = await h.getFile(); return { text: await f.text(), sig: f.lastModified + ":" + f.size }; }
  // 00.09.001: plain snapshot deliveries (inbox-snapshot.js / .json, dated names) in an encrypted folder. Unlocked: encrypt the
  // newest into inbox-snapshot.json.enc (encryptPlain keeps the newer of the two by generated_at), check it, delete the plain file.
  // Only file names and generated_at are ever shown; snapshot contents are never logged.
  // F1: a snapshot stamped more than FUTURE_MS ahead of now is refused (never adopted, deleted, or allowed to win a comparison)
  const futureSnap = raw => { const t = Date.parse(raw && raw.generated_at); return !isNaN(t) && t - nowDate().getTime() > R2.FUTURE_MS; };
  const isPlainSnap = n => !/\.enc$/i.test(n) && !/\.csv$/i.test(n) && purposeOf(n) === "snapshot";
  async function plainSnapList() {
    const out = [];
    for await (const [name, h] of S.dir.entries()) {
      if (h.kind !== "file" || !isPlainSnap(name) || S.vault.snapUndeleted[name]) continue;
      try { const f = await h.getFile(); out.push([name, f.lastModified + ":" + f.size, f.lastModified]); } catch (e) { /* unreadable: the sync reports it */ }
    }
    return out;
  }
  async function adoptPlainSnapshots() {
    if (!S.dir || !S.vault.kr || !S.vault.key) return 0;
    let list; try { list = await plainSnapList(); } catch (e) { return 0; }
    if (!list.length) return 0;
    const r = await encryptPlain(list.map(x => [x[0], x[1]])); snapNotice(); return r.n;
  }
  function snapNotice() {
    const a = S.vault.adopted.splice(0); if (!a.length) return;
    const used = a.filter(x => x.used).map(x => x.gen).filter(Boolean).sort().pop();
    const when = g => { const d = new Date(g); return isNaN(d) ? "" : `${R.dayLabel(R.isoDay(g))}, ${R.hm(g)} ${R.tzLabel(g)}`; };
    const gone = a.every(x => x.gone);
    const msg = (used ? `New snapshot from ${when(used)} encrypted and loaded.` : `Plain snapshot was not newer than the encrypted copy, so it wasn't used.`)
      + (gone ? ` The plain file${a.length > 1 ? "s were" : " was"} deleted.` : ` ⚠ A plain file couldn't be deleted; delete it by hand.`);
    S.snapNoticeText = msg; toast(msg);
  }
  // Locked: names, sizes and dates only (no contents). A plain snapshot newer than the encrypted copy means one is waiting.
  async function scanWaiting() {
    S.vault.snapWaiting = null; if (!S.dir) return;
    try {
      let enc = 0; const plain = [];
      for await (const [name, h] of S.dir.entries()) {
        if (h.kind !== "file") continue;
        if (name === "inbox-snapshot.json" + ENC) { try { enc = (await h.getFile()).lastModified; } catch (e) { /* none */ } }
        else if (isPlainSnap(name) && !S.vault.snapUndeleted[name]) { try { plain.push([name, (await h.getFile()).lastModified]); } catch (e) { /* skip */ } }
      }
      const newer = plain.filter(x => x[1] > enc); if (newer.length) S.vault.snapWaiting = { names: newer.map(x => x[0]) };
    } catch (e) { /* folder unreadable: the chip says so */ }
  }
  async function readDirSnapshot() {
    if (S.vault.kr) {
      if (!S.vault.key) return null; const n = "inbox-snapshot.json" + ENC;
      try { const r = await readName(n); S.seen[n] = r.sig; const o = JSON.parse(await V.decrypt(S.vault.key, S.vault.kr, r.text, "snapshot"));
        if (futureSnap(o)) { S.fileProblems[n] = `${n}: generated_at is in the future; not used`; return null; } return o; }
      catch (e) { if (e && e.name !== "NotFoundError") S.problems.push(`${n}: ${e.message || e}`); return null; }
    }
    for (const n of SNAP_NAMES) {
      try { const h = await S.dir.getFileHandle(n); const r = await readText(h); S.seen[n] = r.sig; return parseSnapshotText(n, r.text); }
      catch (e) { if (e && e.name !== "NotFoundError") S.problems.push(`${n}: ${e.message || e}`); }
    }
    return null;
  }
  function parseLogJs(text) { const m = text.match(/window\.DASH_NOTEBOOK_LOG\s*=\s*([\s\S]*?);?\s*$/); const o = JSON.parse(m ? m[1] : text); if (!o || !Array.isArray(o.lines)) throw new Error("not in the expected format"); return o; }
  async function readDirLog() {
    if (S.vault.kr) {
      if (!S.vault.key) return null; const n = "notebook-log.js" + ENC;
      try { const r = await readName(n); S.seen[n] = r.sig; return parseLogJs(await V.decrypt(S.vault.key, S.vault.kr, r.text, "log")); }
      catch (e) { if (e && e.name !== "NotFoundError") S.problems.push(`${n}: ${e.message || e}`); return null; }
    }
    try { const h = await S.dir.getFileHandle("notebook-log.js"); const r = await readText(h); S.seen["notebook-log.js"] = r.sig; return parseLogJs(r.text); }
    catch (e) { if (e && e.name !== "NotFoundError") S.problems.push(`notebook-log.js: ${e.message || e}`); return null; }
  }
  let syncing = null;
  function syncNow(manual) { if (!syncing) syncing = doSync(manual).finally(() => { syncing = null; }); return syncing; }
  async function doSync(manual, again) {
    S.problems = S.problems.filter(p => p.startsWith("picked"));
    if (!S.dir) { await scriptPoll(); S.lastSync = new Date(); renderSync(); return; }
    if (!window.DASH_TEST_FS && !(await permOK(S.dir))) { S.granted = false; render(); return; }
    S.granted = true; let changed = false; const names = new Set(); let snapOk = false, snapRaw = null, logObj = null, feeds = {}, plain = [], kept = [], keyringSeen = false;
    if (S.vault.kr && !S.vault.key) { await scanWaiting(); S.lastSync = new Date(); render(); return; }   // encrypted and locked: touch nothing (00.09.001: names and dates only)
    S.vault.snapWaiting = null;
    // 00.05.002: GitHub sync is attached on any sync once the folder is unlocked, not only at start-up (a folder unlocked later,
    // e.g. after "Not now", a folder reconnect or a recovery-key reset, otherwise never synced with the hub). A saved set-up
    // that can't attach (different keyring, unreadable token) is reported in the chip as "⚠ GitHub not connected".
    let hubNew = false;
    if (!S.hub && S.vault.kr && S.vault.key) { await hubBoot(); hubNew = !!S.hub; if (hubNew) S.seen = {}; }
    if (!S.hub && S.hubState && S.hubState.error) S.problems.push("GitHub: " + S.hubState.error);
    if (S.hub && (!again || hubNew)) await hubMirror();
    try {
      for await (const [name, h] of S.dir.entries()) {
        if (h.kind !== "file") continue; names.add(name);
        if (name === KEYRING) { keyringSeen = true; continue; }
        if (/\.enc\.tmp$/i.test(name)) { S.fileProblems[name] = `${name}: leftover temporary file from an interrupted save; not used, safe to delete`; continue; }   // 00.09.001
        const isEnc = /\.enc$/i.test(name), inner = innerName(name), purpose = purposeOf(inner);
        if (!purpose || (purpose === "snapshot" && /\.csv$/i.test(inner))) continue;
        names.add(inner);
        if (S.vault.kr && !isEnc) {                                        // plaintext in an encrypted folder: encrypted below (once per version)
          try { const f = await h.getFile(), sig = f.lastModified + ":" + f.size; if (S.vault.plainDone[name] === sig) kept.push(name); else plain.push([name, sig]); } catch (e) { kept.push(name); }
          continue; }
        if (!S.vault.kr && isEnc) { S.fileProblems[name] = `${name}: encrypted, but this folder has no ${KEYRING}`; continue; }
        let r; try { const f = await h.getFile(); const sig = f.lastModified + ":" + f.size; if (S.seen[name] === sig && !(purpose === "time" && !S.fileEvents[inner])) continue; r = { text: await f.text(), sig }; }
        catch (e) { S.fileProblems[name] = `${name}: unreadable (${e.message || e})`; continue; }
        S.seen[name] = r.sig; delete S.fileProblems[name];
        if (FEED_READ[purpose] && !isEnc) { S.fileProblems[name] = `${name}: plaintext; the calendar, trips and projects feeds are only read encrypted (File → Encryption…)`; continue; }
        try {
          if (isEnc) r.text = await V.decrypt(S.vault.key, S.vault.kr, r.text, purpose);
          if (purpose === "time") { const p = R2.parseTimeFile(r.text, inner); if (p.bad) S.fileProblems[name] = p.bad; S.fileEvents[inner] = p.events; (S.fileReports = S.fileReports || {})[inner] = p.reports || []; (S.fileUpdated = S.fileUpdated || {})[inner] = p.updated_at; changed = true; }
          else if (purpose === "log") logObj = parseLogJs(r.text);
          else if (FEED_READ[purpose]) { const raw = JSON.parse(r.text); FEED_READ[purpose](raw); feeds[purpose] = raw; }
          else {   // 00.04.001: several snapshot files (e.g. a renamed backup): use the newest one that passes validation
            const cand = parseSnapshotText(inner, r.text); let okc = true; try { R.readSnapshot(cand); } catch (e) { okc = false; }
            if (futureSnap(cand)) { S.fileProblems[name] = `${name}: generated_at is in the future; not used`; continue; }   // F1
            const better = !snapRaw || (okc && (!snapOk || Date.parse(cand.generated_at) > Date.parse(snapRaw.generated_at)));
            if (better) { snapRaw = cand; snapOk = okc; }
          }
        } catch (e) { S.fileProblems[name] = `${name}: unreadable (${e.message || e})`; if (purpose === "time") { delete S.fileEvents[inner]; changed = true; } }
      }
    } catch (e) { if (S.hubOnly) { S.hubState.error = e.message || String(e); S.problems.push("GitHub: " + S.hubState.error); renderSync(); return; } S.problems.push("Data folder: " + (e.message || e)); }
    if (S.hubOnly) { delete S.hubState.error; S.hubState.last = new Date(); if (S.hub.problems) S.problems.push(...S.hub.problems().map(x => "GitHub: " + x)); }
    if (keyringSeen && !S.vault.kr && !again) {   // another computer turned on encryption: unlock, then read the encrypted files
      if (await loadKeyring()) { await ensureUnlocked(); S.seen = {}; return doSync(manual, true); }
    }
    if (S.vault.kr) {
      if (!again) Object.keys(S.vault.refused).forEach(n => { if (!names.has(n)) delete S.vault.refused[n]; });
      const r = plain.length && !again ? await encryptPlain(plain) : { n: 0, left: plain.map(x => x[0]).filter(n => !S.vault.refused[n]) };
      S.vault.plainLeft = kept.concat(r.left);
      snapNotice();
      if (r.n) { S.seen = {}; return doSync(manual, true); }
    }
    if (S.vault.plainLeft.length) S.problems.push(`${S.vault.plainLeft.length} plaintext file(s) still in the Data folder (File → Encryption… → Delete plaintext originals)`);
    Object.keys(S.fileEvents).forEach(n => { if (!n.startsWith("picked:") && !names.has(n)) { delete S.fileEvents[n]; changed = true; } });
    Object.keys(S.fileProblems).forEach(n => { if (!names.has(n)) delete S.fileProblems[n]; });
    S.problems.push(...Object.values(S.fileProblems));
    S.problems.push(...Object.values(S.saveProblems));   // D1
    // absorb this machine's own events found in any file (e.g. a OneDrive conflict copy of my own file)
    const mine = new Set(S.own.map(e => e.eid)), extra = [].concat(...Object.values(S.fileEvents)).filter(e => e.machine === S.machine && !mine.has(e.eid));
    if (extra.length) { S.own = R2.dedupe(S.own.concat(extra)); track(DB.set("ownEvents", S.own)); }
    const ownFile = S.fileEvents[R2.fileName(S.machine)] || [], inFile = new Set(ownFile.map(e => e.eid));
    if (S.own.some(e => !inFile.has(e.eid))) { await writeOwn(); }
    if (S.fileReports) Object.keys(S.fileReports).forEach(n => { if (!names.has(n)) delete S.fileReports[n]; });
    if (changed || extra.length || (S.held && S.held.length)) recompute();
    if (snapRaw && S.snap && (S.snap.example || snapRaw.generated_at !== S.snap.raw_generated_at)) await useSnapshot(snapRaw, "Inbox Exporter snapshot");
    if (logObj) importLog("notebook-log.js", logObj.lines.join("\n"), true);
    useFeeds(feeds);
    S.lastSync = new Date(); render(); renderSync();
    if (manual === true && S.problems.length) toast("Synced with ⚠ " + S.problems.length + " problem(s). Hover the sync chip for details.");
  }
  // Without a connected folder: re-read the script files (snapshot, notebook log) so a fresh Inbox Exporter snapshot still shows up.
  async function scriptPoll() {
    if (!S.snap || S.snap.from !== "Inbox Exporter snapshot") return;
    const before = window.DASH_SNAPSHOT; window.DASH_SNAPSHOT = undefined;
    if (await loadScript(CFG.snapshotPath || "Data/inbox-snapshot.js") && window.DASH_SNAPSHOT && window.DASH_SNAPSHOT.generated_at !== S.snap.raw_generated_at) await useSnapshot(window.DASH_SNAPSHOT, "Inbox Exporter snapshot");
    else if (!window.DASH_SNAPSHOT) window.DASH_SNAPSHOT = before;
    window.DASH_NOTEBOOK_LOG = undefined;
    if (await loadScript(CFG.notebookLogPath || "Data/notebook-log.js") && window.DASH_NOTEBOOK_LOG && Array.isArray(window.DASH_NOTEBOOK_LOG.lines)) importLog("notebook-log.js", window.DASH_NOTEBOOK_LOG.lines.join("\n"), true);
  }
  // 00.05.001: follow the computer's time zone (travel). If the zone or the local day changed: re-read the snapshot's
  // day fields, recompute Due Today / Overdue / snooze returns / as-of and meetings, no reload. Returns true on a change.
  function checkTz() {
    const old = R.getTimeZone(), z = R.setTimeZone(R.detectTimeZone()), day = R.ymd(nowDate()), zoneChanged = z !== old;
    if (!zoneChanged && day === S.today) { renderTz(); return false; }
    S.today = day;
    if (zoneChanged && S.snap && S.snapRaw) { try { const n = R.readSnapshot(S.snapRaw); n.from = S.snap.from; n.raw_generated_at = S.snap.raw_generated_at; S.snap = n; } catch (e) { /* keep the current one */ } }
    render(); renderTz();
    if (zoneChanged) toast(`Time zone is now ${R.tzLabel()} (${z}). Today, Due Today, Overdue, snooze times and meetings follow it.`);
    return true;
  }
  function renderTz() {
    const c = $("#tz"); if (!c) return;
    const z = R.getTimeZone(), l = R.tzLabel();
    c.textContent = l === z ? z : `${l} · ${z}`; c.setAttribute("aria-label", `Time zone ${l === z ? z : `${z} (${l})`}, from this computer's clock`);
    c.title = `Time zone: ${z}, from this computer's clock (no setting). Today, Due Today, Overdue, the 08:00 snooze return, meeting times and the as-of stamp use it. Checked every ${POLL_MS / 1000} s and when the window comes back.`;
    const a = $("#about-tz"); if (a) a.textContent = `${z} (${l}), from this computer's clock`;
  }
  let tzTimer = null;
  function watchTz() {
    if (tzTimer) return;
    tzTimer = setInterval(checkTz, POLL_MS);
    window.addEventListener("focus", checkTz);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) checkTz(); });
    renderTz();
  }
  function startPolling() {
    setInterval(() => syncNow(), POLL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) syncNow(); });
    if (S.dir) syncNow(); else renderSync();
  }
  function hhmm(d) { return d ? R.hm(d) : "—"; }
  function renderSync() {
    const c = $("#sync"); if (!c) return;
    const ms = [...new Set(S.machines.concat(S.machine ? [S.machine] : []))].sort().join(", ");
    let txt, warn = false, act = "syncNow", tip;
    if (!S.dir && !window.showDirectoryPicker && !window.DASH_TEST_FS) { warn = true; act = "hub"; txt = "⚠ Set up GitHub sync"; tip = "This browser can't connect a folder (e.g. iPad Safari). Click to sync through your private GitHub data repo instead. Other option: File → Save my time file… / Open time files…."; }
    else if (!S.dirStored) { warn = true; act = "connect"; txt = "⚠ Connect Data folder"; tip = "Click and pick the Dashboard/Data folder so time syncs between your machines."; }
    else if (S.vault && S.vault.kr && !S.vault.key && S.granted) { warn = true; act = "encryption"; txt = S.vault.snapWaiting ? "🔒 New snapshot waiting · Unlock to import" : "🔒 Data locked"; tip = S.vault.snapWaiting ? `A newer snapshot is in the Data folder (${S.vault.snapWaiting.names.join(", ")}). Click to unlock; it is then encrypted, loaded, and the plain file deleted.` : "The Data folder is encrypted. Click to unlock with your passphrase."; }
    else if (!S.granted) { warn = true; act = "connect"; txt = "⚠ Reconnect Data folder"; tip = "The browser needs your OK again to use the Data folder. Click, then Allow. New snapshots are checked once it's reconnected."; }
    else if (S.aboutMe && S.aboutMe.length) { warn = true; const mx = Math.max(...S.aboutMe.map(r => r.ahead_min)), by = [...new Set(S.aboutMe.map(r => r.by))].join(", ");
      txt = "⚠ This computer's clock is ahead"; tip = `${by} sees time stamps from this computer up to ${mx} min in the future. Set this computer's clock to automatic, then Help → FAQ → "Repair clock stamps".`; }
    else if (S.held && S.held.length) { warn = true; const who = [...new Set(S.held.map(e => e.machine))].join(", ");
      txt = `⚠ Clock ahead · ${who} · ${S.held.length} held`; tip = `${S.held.length} change(s) from ${who} are stamped more than ${CFG.holdHours || 24} h in the future (latest ${S.held.map(e => e.ts).sort().pop()}). They are held — not applied — until real time reaches them. Fix: on ${who}, set the clock to automatic and use File → Repair clock stamps…. See Help → FAQ.`; }
    else if (S.future.length) { warn = true; const mx = S.future.reduce((a, e) => Math.max(a, Date.parse(e.ts)), 0), mins = Math.round((mx - Date.now()) / 60000), who = [...new Set(S.future.map(e => e.machine))].join(", ");
      txt = `⚠ Clock ahead · ${who}`; tip = `${S.future.length} time stamp(s) from ${who} are up to ${mins} min in the future. Check that clock is set automatically. Edits here still count after them (the dashboard's clock moves past the newest stamp it has seen).` + (S.problems.length ? "\n\n" + S.problems.join("\n") : ""); }
    else { warn = S.problems.length > 0; const hubDown = !S.hub && !!(S.hubState && S.hubState.error);   // GitHub sync set up but not running
      if (hubDown) { warn = true; act = "hub"; }
      txt = `${hubDown ? "⚠ GitHub not connected" : `${warn ? "⚠" : S.vault && S.vault.kr ? "🔐" : "⟳"} Synced ${hhmm(S.lastSync)}`} · ${ms}${warn ? ` · ${S.problems.length} problem${S.problems.length > 1 ? "s" : ""}` : ""}`; tip = (warn ? S.problems.join("\n") + "\n\n" : "") + `Machines seen: ${ms}. Checks ${S.hubOnly ? "GitHub" : S.hub ? "the Data folder and GitHub" : "the Data folder"} every ${POLL_MS / 1000} s. Click to sync now.`;
      if (S.hub) txt += S.hubState.error ? " · ☁ ⚠" : " · ☁"; }
    c.textContent = txt; c.title = tip; c.dataset.act = act; c.classList.toggle("stale", warn);
  }
  function pickFiles(accept, cb) { const i = document.createElement("input"); i.type = "file"; i.accept = accept; i.multiple = true; i.onchange = async () => { const out = []; for (const f of i.files) out.push([f.name, await f.text()]); cb(out); }; i.click(); }

  // ---------- render ----------
  function render() {
    renderHeader();
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("hidden", v.id !== "view-" + S.view));
    document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", String(t.dataset.view === S.view)));
    if (!S.snap) return;
    if (S.view === "focus") renderFocus();
    if (S.view === "dashboard") renderDashboard();
    if (S.view === "workload") renderWorkload();
    if (S.view === "projects") renderProjects();
    if (S.view === "accounts") renderAccounts();
    // Both sheets are always rendered so Ctrl+P from any tab prints a real sheet (F11).
    $("#sheet-print").innerHTML = sheet(false); $("#sheet-manager").innerHTML = sheet(true);
  }
  function asOfText() {
    if (!S.snap) return "No data";
    const d = new Date(S.snap.generatedAt);
    const day = R.dayLabel(R.isoDay(S.snap.generatedAt)).replace(" ", " ");
    return `As of ${day}, ${R.hm(S.snap.generatedAt)} ${R.tzLabel(S.snap.generatedAt)} · ${S.snap.from === "opened file" ? "opened snapshot" : "Inbox Exporter snapshot"}`;
  }
  function isStale() { return S.snap && (NOW - new Date(S.snap.generatedAt)) / 3.6e6 > (CFG.staleHours || 24); }
  // 00.09.001: what the as-of stamp says instead of "Stale" when the reason is known
  function staleState() {
    if (!isStale()) return null;
    if (S.vault && S.vault.kr && !S.vault.key && S.vault.snapWaiting) return { txt: "🔒 New snapshot waiting · Unlock to import · ", tip: "A newer snapshot is in the Data folder. Unlock to encrypt and load it." };
    if (S.dirStored && !S.granted) return { txt: "⚠ Reconnect the Data folder to check for new snapshots · ", tip: "The browser needs your OK again to read the Data folder. Click the sync chip, then Allow." };
    if (S.hubOnly) return { txt: "⚠ Stale · ", tip: "This snapshot is more than 24 hours old. Open the dashboard on a computer with the Data folder to bring in the latest snapshot." };
    return { txt: "⚠ Stale · ", tip: "This snapshot is more than 24 hours old. Ask Inbox Exporter for a fresh one." };
  }
  function renderHeader() {
    const a = $("#asof"), ss = staleState(); a.textContent = (ss ? ss.txt : "") + asOfText(); a.classList.toggle("stale", !!ss);
    a.title = ss ? ss.tip : "Time the snapshot was made (Central Time).";
    $("#exbadge").classList.toggle("hidden", !(S.snap && S.snap.example));
    renderSync();
  }

  function series() { return R.weeklySeries(S.history); }
  function tile(key, n, big) {
    const ser = series(), w = R.wow(ser, key), tone = R.wowTone(key, w.delta);
    const vals = ser.map(p => p.totals[key] || 0);
    const sp = vals.length > 1 ? `<svg class="spark" width="${big ? 110 : 90}" height="14" aria-hidden="true"><polyline fill="none" stroke="${tone === "bad" ? "#f85149" : "#3a9ad6"}" stroke-width="1.4" points="${R.sparkPoints(vals, big ? 110 : 90, 14)}"/></svg>` : "";
    return `<button class="tile${S.filter === key ? " sel" : ""}" data-filter="${key}" aria-pressed="${S.filter === key}">
      <div class="cap">${LABEL[key]}</div><span class="info" aria-hidden="true">ⓘ</span>
      <div class="n">${n}</div>
      <div class="d ${tone}">${esc(w.text)}${w.fallback ? " *" : ""}</div>${sp}
      <span class="tip" role="tooltip">${esc(TIPS[key])}${w.fallback ? "<br><i>* compared with the nearest older snapshot week</i>" : ""}</span></button>`;
  }
  function renderDashboard() {
    const items = S.snap.items, c = ctx(), t = R.totals(items, c);
    $("#tiles-status").innerHTML = ["overdue", "dueToday", "thisWeek", "iOwe", "owedToMe", "goingCold"].map(k => tile(k, t[k], true)).join("");
    $("#tiles-lists").innerHTML = ["followUps", "waitingOn", "accountTouches", "travel"].map(k => tile(k, t[k], false)).join("");
    const ser = series(); $("#trend-since").textContent = ser.length ? `Trend since ${R.dayLabel(ser[0].week)} · ${ser.length} week${ser.length > 1 ? "s" : ""}` : "";
    $("#trends").classList.toggle("hidden", !S.trends);
    $("#trends-toggle").textContent = S.trends ? "Hide trends ▴" : "Show trends ▾";
    if (S.trends) $("#trend-grid").innerHTML = R.TOTAL_KEYS.map(k => { const v = ser.map(p => p.totals[k] || 0);
      return `<div class="trow"><span>${LABEL[k]}</span><svg width="150" height="18"><polyline fill="none" stroke="#3a9ad6" stroke-width="1.4" points="${R.sparkPoints(v, 150, 18)}"/></svg><span class="mono">${v.join(" ") ? v[v.length - 1] : ""}</span></div>`; }).join("");
    renderCalendar();
    renderList(items.filter(R.isOpen), c);
    const cold = R.coldList(items, c);
    $("#coldlist").innerHTML = `<div class="rowhead"><span class="cap">Going Cold · ${cold.length} item${cold.length === 1 ? "" : "s"} with no activity in 14+ days</span><span class="faint" style="font-size:11px">activity = To Do edit, time logged on that item, or a meeting with the account</span></div>` +
      (cold.length ? `<table class="tbl"><thead><tr><th>Item</th><th>List</th><th>Account</th><th>Last activity</th><th>Days</th></tr></thead><tbody>${cold.map(x => `<tr><td><span class="line" data-toggle="${esc(x.it.id)}">${esc(R.formatLine(x.it))}</span></td><td>${esc(x.it.list)}</td><td>${acctTag(x.it.account)}</td><td class="mono">${x.last ? R.dayLabel(x.last) : "none"}</td><td class="mono" style="color:var(--inctx);font-weight:700">${x.days === null ? "—" : x.days}</td></tr>`).join("")}</tbody></table>` : `<div class="faint">Nothing going cold.</div>`);
  }
  function renderCalendar() {
    const evs = R.withConflicts(S.snap.calendar), x0 = 7, x1 = 18, pct = h => ((Math.min(Math.max(h, x0), x1) - x0) / (x1 - x0) * 100);
    let ax = ""; for (let h = x0; h <= x1; h++) ax += `<span style="left:calc(150px + (100% - 150px) * ${(h - x0) / (x1 - x0)});transform:translateX(-50%)">${h > 12 ? h - 12 : h} ${h >= 12 ? "PM" : "AM"}</span>`;
    let ticks = ""; for (let h = x0; h <= x1; h++) ticks += `<div class="tick" style="left:${pct(h)}%"></div>`;
    const lanes = [[S.today, "Today"], [R.addDays(S.today, 1), "Tomorrow"]].map(([day, name]) => {
      const list = evs.filter(e => e.day === day).sort((a, b) => a.start < b.start ? -1 : 1);
      let body = "";
      if (!list.length) body = `<div class="track empty">Nothing scheduled.</div>`;
      else {
        let lastEnd = [];
        body = `<div class="track">${ticks}` + list.map((e, i) => {
          const s = R.hourCT(e.start), en = R.hourCT(e.end); const lane = e.conflict ? (lastEnd.some(x => x > s) ? 1 : 0) : 0; lastEnd.push(en);
          const ent = S.entries.find(x => x.eventId === e.id), past = e.day <= S.today, cy = lane ? 74 : 52;
          let tchip = "";
          if (past && ent) tchip = `<button class="chip evtime conf" data-ent="${esc(ent.id)}" style="left:${pct(s)}%;top:${cy}px" title="Counted: ${fmtMin(ent.minutes)}. Click to adjust.">✓ ${e.conflict ? "Attended · " : ""}${fmtMin(ent.minutes)} · Adjust</button>`;
          else if (past && e.conflict) tchip = `<button class="chip evtime att" data-attend="${esc(e.id)}" style="left:${pct(s)}%;top:${cy}px" title="Overlapping meetings fill no time until you mark the one you attended.">Attended?</button>`;
          else if (past) tchip = `<button class="chip evtime pend" data-attend="${esc(e.id)}" style="left:${pct(s)}%;top:${cy}px" title="You removed this meeting's time. Click to count it again.">Removed · Count again</button>`;
          return `<div class="ev${e.conflict ? " cf" : ""}" style="left:${pct(s)}%;width:calc(${pct(en) - pct(s)}% - 2px);top:${lane ? 27 : 2}px" title="${esc(R.hm(e.start) + "–" + R.hm(e.end) + " " + e.title + (e.location ? " · " + e.location : ""))}"><span class="mono">${esc(R.hm(e.start).replace(/ [AP]M/, ""))}</span> ${esc(e.title)}${e.conflict ? " ⚠" : ""}</div>${tchip}`;
        }).join("") + (list.some(e => e.conflict) ? "" : "") + `</div>`;
      }
      const cf = list.filter(e => e.conflict).length;
      return `<div class="lane"><div class="lbl">${name} · ${R.dayLabel(day)}${cf ? ` <span class="chip p-Today" title="Two or more events overlap">⚠ Conflict</span>` : ""}</div>${body}</div>`;
    }).join("");
    $("#cal").innerHTML = `<div class="rowhead"><span class="cap">Calendar · Today &amp; Tomorrow · ${esc(R.tzLabel())}</span><span class="faint" style="font-size:11px">from the snapshot · overlaps marked ⚠ Conflict · ✓ = counted (Adjust to change) · overlaps fill nothing until you mark one Attended</span></div><div class="axis">${ax}</div>${lanes}`;
  }
  function fmtMin(m) { return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? " " + (m % 60) + "m" : ""}` : m + "m"; }
  function pill(w) { return `<span class="chip p-${w.replace(" ", "-")}">${w}</span>`; }
  function acctTag(name) { if (!name) return ""; const a = S.snap.accounts.find(x => x.name === name); return `<span class="chip">${esc(name)}${a && a.tier === "T1" ? '<span class="t1" title="Top tier (T1)">T1</span>' : ""}</span>${starBtn(name)}`; }
  // 00.05 key-account star (owner's pick of key accounts), synced as a flag event. Toggle with click, Space or Enter.
  const isStarred = name => !!(S.flags["star:" + name] && S.flags["star:" + name].on);
  function starBtn(name) { if (!name) return ""; const on = isStarred(name);
    return `<button class="star${on ? " on" : ""}" data-star="${esc(name)}" aria-pressed="${on}" aria-label="${on ? "Unstar" : "Star"} ${esc(name)} as a key account" title="${on ? "Key account (click to unstar)" : "Star as a key account"}">${on ? "★" : "☆"}</button>`; }
  function setFlag(id, data) { S.flags = Object.assign({}, S.flags, { [id]: data }); return commit(); }
  function renderList(items, c) {
    const shown = S.filter ? items.filter(it => R.inTotal(it, S.filter, c)) : items;
    $("#filterbar").innerHTML = S.filter ? `<span class="chip fchip">Showing: ${LABEL[S.filter]} (${shown.length}) · <button id="clearf">Clear</button></span>` : `<span class="faint" style="font-size:11.5px">Click a total to filter the list. Click it again to clear.</span>`;
    let html = "";
    R.GROUPS.forEach(g => {
      const rows = shown.filter(it => R.group(it, S.today) === g).sort(R.sortItems); if (!rows.length) return;
      const col = S.collapsed[g];
      html += `<button class="grp${g === "Overdue" ? " over" : ""}" data-grp="${g}" aria-expanded="${!col}">${col ? "▸" : "▾"} ${g} <span class="faint">(${rows.length})</span></button>`;
      if (col) return;
      rows.forEach(it => {
        const w = R.statusWord(it, S.today), la = R.lastActivity(it, c), cold = R.isCold(it, c);
        const logged = S.entries.filter(e => e.taskId === it.id && e.confirmed).reduce((a, e) => a + e.minutes, 0);
        html += `<div class="row" data-id="${esc(it.id)}"><span class="line" data-toggle="${esc(it.id)}" title="${esc(R.lineHead(it) + ": " + it.title)}">${esc(R.formatLine(it))}${cold ? ' <span class="chip p-Today" title="No activity in 14+ days">❄ Going cold</span>' : ""}${it.estMinutes && it.estMinutes <= 15 ? ' <span class="chip" title="Quick win: 15 minutes or less">⚡</span>' : ""}${it.withhold ? ' <span class="chip withheld" title="Tagged Withhold in To Do: never shown on Manager\'s sheet">⊘ Withheld</span>' : ""}</span>
          <span><span class="chip lst">${esc(it.list)}</span></span><span>${acctTag(it.account)}</span>
          <span>${[15, 30, 60].map(m => `<button class="tc" data-add="${m}" data-id="${esc(it.id)}" aria-label="Log ${m} minutes">+${m}</button>`).join("")}<button class="tc" data-custom="${esc(it.id)}" aria-label="Log custom time">⋯</button>${logged ? ` <span class="faint mono" style="font-size:10.5px">${fmtMin(logged)}</span>` : ""}</span>
          <span>${pill(w)}</span></div>`;
        if (S.open[it.id]) html += `<div class="detail">${esc(it.list)} · ${it.due ? "next date " + R.dayLabel(it.due) : "no date"} · last activity ${la ? R.dayLabel(la) + " (" + R.diffDays(S.today, la) + " days ago)" : "none"}${it.withhold ? " · <b>Withheld</b> from Manager's sheet (To Do tag)" : ""}${it.importance === "high" ? " · high importance" : ""}${logged ? " · logged " + fmtMin(logged) : ""}</div>`;
      });
    });
    $("#filterbar").insertAdjacentHTML("beforeend", `<span style="margin-left:auto"><button class="btn" data-logcall title="Phone, Teams chat, Teams call or Other — counted at once">+ Log call</button></span>`);
    $("#list").innerHTML = html || `<div class="detail">Nothing here${S.filter ? " for this filter" : ""}.</div>`;
  }

  // ---------- time entry ----------
  function itemGuess(it) {
    const acc = S.snap.accounts.find(a => a.name === it.account);
    const a = acc && acc.domains.length ? R.guessAudience(acc.domains, S.rules) : { value: "Owner/operator", why: "no account domain (fallback)" };
    return { a, s: R.guessSubject(it.title + " " + (it.list === "Travel" ? "travel" : "")) };
  }
  function addEntry(it, minutes, opts) {
    const g = itemGuess(it);
    const e = { id: "t" + Date.now() + Math.random().toString(36).slice(2, 6), taskId: it.id, eventId: null, date: S.today, minutes,
      audience: (opts && opts.audience) || g.a.value, subject: (opts && opts.subject) || g.s.value, account: (opts && "account" in opts) ? opts.account : it.account,
      source: "manual", confirmed: true, guessed: { audience: opts && opts.audience ? null : g.a.why, subject: opts && opts.subject ? null : g.s.why }, title: it.title };
    S.entries.push(e); saveEntries(); toast(`Logged ${fmtMin(minutes)} on "${it.title}". Undo in Workload.`); render();
  }
  function popover(anchor, cfg) {
    closePop();
    const p = document.createElement("div"); p.className = "pop"; p.id = "pop"; p.setAttribute("role", "dialog"); p.setAttribute("aria-label", cfg.title);
    const opts = (arr, v) => arr.map(x => `<option${x === v ? " selected" : ""}>${esc(x)}</option>`).join("");
    p.innerHTML = `<div style="display:flex;justify-content:space-between"><b>${esc(cfg.title)}</b><button class="btn" id="pop-x" aria-label="Close">✕</button></div>
      <div class="faint" style="margin-top:2px">${esc(cfg.sub || "")}</div>
      ${cfg.kind ? `<label>Type <select id="pop-kind">${opts(R.KINDS, cfg.kind)}</select></label>` : ""}
      <label>Minutes <input id="pop-min" type="number" min="1" max="720" step="5" value="${cfg.minutes}"></label>
      <label>Audience ${cfg.ga ? `<span class="guess" title="${esc(cfg.ga)}">guessed</span>` : ""}<select id="pop-aud">${opts(R.AUDIENCES, cfg.audience)}</select></label>
      <label>Subject ${cfg.gs ? `<span class="guess" title="${esc(cfg.gs)}">guessed</span>` : ""}<select id="pop-sub">${opts(R.SUBJECTS, cfg.subject)}</select></label>
      <label>Account <select id="pop-acc"><option value="">(none)</option>${S.snap.accounts.map(a => `<option${a.name === cfg.account ? " selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
      ${cfg.kind ? `<label>Note (stays in this browser) <input id="pop-note" maxlength="120" value="${esc(cfg.note || "")}" placeholder="e.g. Sam K. — riser question"></label>` : ""}
      ${cfg.extra || ""}
      <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:10px"><button class="btn" id="pop-cancel">Cancel</button><button class="btn primary" id="pop-ok">${esc(cfg.ok)}</button></div>`;
    document.body.appendChild(p);
    const r = anchor.getBoundingClientRect(); p.style.left = Math.min(r.left, innerWidth - 330) + "px"; p.style.top = (r.bottom + 6 + 330 > innerHeight ? Math.max(8, r.top - 336) : r.bottom + 6) + "px";
    $("#pop-min").focus();
    $("#pop-x").onclick = $("#pop-cancel").onclick = closePop;
    $("#pop-ok").onclick = () => {
      const m = Math.round(+$("#pop-min").value);
      if (!(m >= 1 && m <= 720)) { $("#pop-min").setCustomValidity("Enter 1 to 720 minutes"); $("#pop-min").reportValidity(); return; }
      cfg.save({ minutes: m, audience: $("#pop-aud").value, subject: $("#pop-sub").value, account: $("#pop-acc").value || null, kind: $("#pop-kind") ? $("#pop-kind").value : undefined, note: $("#pop-note") ? $("#pop-note").value.trim() : undefined }); closePop();
    };
  }
  function closePop() { const p = $("#pop"); if (p) p.remove(); }
  function editCalendarEntry(anchor, ent) {
    const ev = S.snap.calendar.find(e => e.id === ent.eventId), cf = ev && R.conflictPartners(S.snap.calendar, ev.id).length;
    popover(anchor, { title: "Adjust meeting time", sub: (ev ? `${R.hm(ev.start)}–${R.hm(ev.end)} ${ev.title}` : ent.title) + " · already counted", minutes: ent.minutes, audience: ent.audience, subject: ent.subject, account: ent.account,
      ga: ent.guessed && ent.guessed.audience, gs: ent.guessed && ent.guessed.subject, ok: "Save",
      extra: cf ? `<button class="btn" id="pop-unattend" style="margin-top:8px">Not attended (count nothing)</button>` : "",
      save: v => { delete v.kind; delete v.note; updateEntry(ent, v); saveEntries(); render(); } });
    const u = $("#pop-unattend"); if (u) u.onclick = () => { closePop(); unmarkAttended(ev.id); };
  }
  function logCall(anchor, pre) {
    pre = pre || {};
    popover(anchor, { title: pre.title || "Log call", sub: pre.sub || "Unscheduled interaction · counted at once", kind: "Phone", minutes: 15, audience: pre.audience || "Owner/operator", subject: "Account strategy", account: pre.account || null, note: pre.note || "", ok: pre.ok || "Log call",
      save: v => {
        const acc = S.snap.accounts.find(a => a.name === v.account);
        S.entries.push({ id: "i" + Date.now() + Math.random().toString(36).slice(2, 6), taskId: null, eventId: null, date: S.today, minutes: v.minutes, kind: v.kind, note: v.note || "",
          audience: v.audience, subject: v.subject, account: v.account, source: "interaction", origin: "quick-add", confirmed: true, guessed: {}, title: `${v.kind}${v.note ? ": " + v.note : ""}` });
        if (acc && acc.domains.length && v.audience !== R.guessAudience(acc.domains, S.rules).value) teach({ account: v.account }, v.audience);
        saveEntries(); toast(`Logged ${fmtMin(v.minutes)} ${v.kind}${v.account ? " · touch for " + v.account : ""}.`); render(); if (pre.after) pre.after(); } });
  }
  function importLog(name, text, quiet) {
    const r = R.parseNotebookLog(text, S.snap.accounts.map(a => a.name));
    // F5: a log line you removed stays removed and adds no event on later loads
    const gone = r.entries.filter(e => S.removedIds && S.removedIds.has(e.id)).length;
    const m = R.mergeLog(S.entries, r.entries.filter(e => !(S.removedIds && S.removedIds.has(e.id)))); let added = 0; const dup = m.dup + m.merged + gone;
    m.add.forEach(e => {
      const acc = S.snap.accounts.find(a => a.name === e.account);
      const a = acc && acc.domains.length ? R.guessAudience(acc.domains, S.rules) : { value: "Owner/operator", why: "no account (fallback)" }, sj = R.guessSubject(e.note);
      const who = [e.person, e.note].filter(Boolean).join(" — ");
      S.entries.push(Object.assign(e, { taskId: null, eventId: null, audience: e.audience || a.value, subject: e.subject || sj.value, confirmed: true,
        guessed: { audience: e.audience ? null : a.why, subject: e.subject ? null : sj.why }, title: `${e.kind}${who ? ": " + who : ""}` })); added++;
    });
    saveEntries(); render();
    if (quiet && !added && !r.rejects.length) return;
    toast(`${name}: imported ${added} [log] line(s)${dup ? `, ${dup} already imported` : ""}. Other lines ignored. The file was not changed.`);
    if (r.rejects.length) banner(`⚠ Incomplete: ${r.rejects.length} [log] line(s) skipped — ${r.rejects.slice(0, 3).join("; ")}`);
  }
  function clearDialog() {
    closePop(); const n = S.entries.length;
    const d = document.createElement("div"); d.className = "overlay open"; d.id = "cleardlg";
    d.innerHTML = `<div class="dlg" role="dialog" aria-label="Clear local data"><b style="font-size:14px">Clear local data</b>
      <p>This clears trend history and the opened snapshot in this browser. <b>Your ${n} time entr${n === 1 ? "y is" : "ies are"} kept</b>, and so are this machine's name and Data folder.</p>
      <label class="danger"><input type="checkbox" id="clr-time"> Also delete all ${n} time entries — on every machine that syncs</label>
      <div id="clr-confirm" class="hidden" style="margin-top:8px"><div style="color:#ffb3ae">This removes them on every machine that shares the Data folder and can't be undone. Export time entries (CSV) or local data first. Type <b>DELETE</b> to confirm.</div><input id="clr-word" autocomplete="off" aria-label="Type DELETE"></div>
      <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:12px"><button class="btn" id="clr-csv">Export time CSV…</button><button class="btn" id="clr-cancel">Cancel</button><button class="btn primary" id="clr-ok">Clear, keep time entries</button></div></div>`;
    document.body.appendChild(d);
    const ok = $("#clr-ok"), chk = $("#clr-time"), word = $("#clr-word");
    const upd = () => { $("#clr-confirm").classList.toggle("hidden", !chk.checked); ok.className = "btn " + (chk.checked ? "dangerbtn" : "primary"); ok.textContent = chk.checked ? "Delete everything" : "Clear, keep time entries"; ok.disabled = chk.checked && word.value !== "DELETE"; };
    chk.onchange = upd; word.oninput = upd; $("#clr-cancel").onclick = () => d.remove(); $("#clr-csv").onclick = ACTIONS.exportCSV;
    ok.onclick = async () => { if (chk.checked && word.value !== "DELETE") return;
      if (chk.checked) {   // as in 00.01: logged time goes; meetings in the current snapshot refill from the calendar (unadjusted)
        const cal = S.snap ? S.snap.calendar : [];
        S.entries = R.calendarFills(cal, S.today, []).map(ev => calEntry(ev, false));
        S.removedCal = S.removedCal.filter(id => !cal.some(x => x.id === id)); commit(); }
      await flush(); await DB.clearAll(); location.reload(); };
  }
  function updateEntry(ent, v) {
    if (v.audience !== ent.audience) { teach(ent, v.audience); ent.guessed = Object.assign({}, ent.guessed, { audience: null }); }
    if (v.subject !== ent.subject) ent.guessed = Object.assign({}, ent.guessed, { subject: null });
    Object.assign(ent, v);
  }
  function teach(ent, audience) {
    let doms = [];
    if (ent.eventId) { const ev = S.snap.calendar.find(e => e.id === ent.eventId); doms = ev ? ev.attendee_domains : []; }
    else { const acc = S.snap.accounts.find(a => a.name === ent.account); doms = acc ? acc.domains : []; }
    if (!doms.length) return;
    S.rules = R.learnAudience(S.rules, doms, audience);
    commit();
  }

  // ---------- workload ----------
  function renderWorkload() {
    const mon = R.addDays(R.mondayOf(S.today), -7 * S.wkOffset), wl = R.workload(S.entries, mon);
    const bars = (obj, order) => { const max = Math.max(1, ...Object.values(obj)); return order.filter(k => obj[k]).concat(Object.keys(obj).filter(k => !order.includes(k)))
      .map(k => `<div class="bar"><span>${esc(k)}</span><span class="b"><i style="width:${obj[k] / max * 100}%"></i></span><span class="mono" style="text-align:right">${(obj[k] / 60).toFixed(2)} h</span></div>`).join("") || `<div class="faint">No time this week.</div>`; };
    const weekEntries = S.entries.filter(e => e.date >= mon && e.date <= R.addDays(mon, 6)).sort((a, b) => a.date < b.date ? 1 : -1);
    const sel = (arr, v, id, k) => `<select data-ed="${esc(id)}" data-k="${k}" aria-label="${k}">${arr.map(x => `<option${x === v ? " selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
    $("#view-workload").innerHTML = `
      <div class="rowhead"><div style="display:flex;gap:8px;align-items:center"><button class="btn" id="wk-prev" aria-label="Previous week">◂</button><b style="font-size:15px">Week of ${R.dayLabel(mon)} – ${R.dayLabel(R.addDays(mon, 6))}</b><button class="btn" id="wk-next" aria-label="Next week" ${S.wkOffset === 0 ? "disabled" : ""}>▸</button></div>
      <span class="faint">Time entries live only in this browser. They are never written back to To Do.</span></div>
      <div class="tiles" style="grid-template-columns:repeat(4,1fr)">
        <div class="tile" style="cursor:default"><div class="cap">Total hours</div><div class="n">${(wl.totalMin / 60).toFixed(2)}</div></div>
        <div class="tile" style="cursor:default"><div class="cap">From tasks (quick-add)</div><div class="n">${(wl.manualMin / 60).toFixed(2)}</div></div>
        <div class="tile" style="cursor:default"><div class="cap">From calendar</div><div class="n">${(wl.calendarMin / 60).toFixed(2)}</div></div>
        <div class="tile" style="cursor:default"><div class="cap">Calls &amp; chats</div><div class="n">${(wl.interactionMin / 60).toFixed(2)}</div><div class="d neu">${wl.interactionCount} logged · ${Object.entries(wl.byKind).map(([k, m]) => `${esc(k)} ${fmtMin(m)}`).join(" · ") || "none"}</div></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="card"><div class="cap">Hours by audience</div>${bars(wl.byAudience, R.AUDIENCES)}</div>
        <div class="card"><div class="cap">Hours by subject</div>${bars(wl.bySubject, R.SUBJECTS)}</div></div>
      <div class="card"><div class="cap">Top accounts by time</div>${wl.topAccounts.map(([a, m], i) => `<div class="bar"><span>${i + 1}. ${esc(a)}</span><span class="b"><i style="width:${m / wl.topAccounts[0][1] * 100}%"></i></span><span class="mono" style="text-align:right">${(m / 60).toFixed(2)} h</span></div>`).join("") || '<div class="faint">No account time this week.</div>'}</div>
      <div class="card"><div class="rowhead"><span class="cap">Entries this week · change audience or subject inline; your audience changes teach the guess for those domains</span><span><button class="btn" data-logcall>+ Log call</button> <button class="btn" data-exportcsv>Export CSV</button></span></div>
      <table class="tbl"><thead><tr><th>Date</th><th>What</th><th>Min</th><th>Audience</th><th>Subject</th><th>Account</th><th>Source</th><th></th></tr></thead><tbody>
      ${weekEntries.map(e => `<tr><td class="mono">${R.dayLabel(e.date)}</td><td>${esc(e.title || "")}</td><td class="mono">${e.minutes}</td>
        <td>${sel(R.AUDIENCES, e.audience, e.id, "audience")}${e.guessed && e.guessed.audience ? `<span class="guess" title="${esc(e.guessed.audience)}">guessed</span>` : ""}</td>
        <td>${sel(R.SUBJECTS, e.subject, e.id, "subject")}${e.guessed && e.guessed.subject ? `<span class="guess" title="${esc(e.guessed.subject)}">guessed</span>` : ""}</td>
        <td>${esc(e.account || "—")}${e.account ? starBtn(e.account) : ""}</td><td>${e.source === "interaction" ? esc(e.kind) + (e.origin === "notebook-log" ? " · log" : "") : e.source}${e.attended ? " · attended" : ""}</td>
        <td>${e.source === "calendar" ? `<button class="btn" data-ent="${esc(e.id)}">Adjust</button> ` : ""}<button class="btn" data-del="${esc(e.id)}" aria-label="Remove entry">Remove</button></td></tr>`).join("") || '<tr><td colspan="8" class="faint">No entries this week.</td></tr>'}
      </tbody></table></div>`;
  }

  // ---------- 00.05 Daily Focus (home) ----------
  // Sections, counts and the delta come from R.focusSections (pure). Done / Snooze / stars are "flag" events in this machine's
  // synced (encrypted) time file; To Do stays the source of truth and wins on the next snapshot (R.overlays).
  const reducedMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const ST = { today: ["Today", "i-today", "today"], overdue: ["Overdue", "i-over", "over"], week: ["This week", "i-week", "week"], later: ["Later", "i-later", "later"],
    waiting: ["Waiting", "i-wait", "wait"], cold: ["Cooling", "i-cold", "cold"], travel: ["Travel", "i-travel", "travel"] };
  const SEC = { dueToday: ["Due Today", "today"], overdue: ["Overdue", "over"], owed: ["Owed to outside", "week"], waiting: ["Waiting · past check-back", "wait"], cold: ["Going cold · key", "cold"], travel: ["Travel ≤ 7 days", "travel"] };
  const EMPTY = { dueToday: "Nothing due today.", overdue: "Nothing overdue.", owed: "Nothing owed to outside.", waiting: "No waiting items past their check-back date.", cold: "No key account going cold.", travel: "No travel in the next 7 days." };
  const icon = (id, cls) => `<svg class="ic${cls ? " " + cls : ""}" aria-hidden="true" focusable="false"><use href="#${id}"></use></svg>`;
  // ---------- 00.06.000 calendar feed + trips (calendar / travel assistants), Today strip and prep card ----------
  // Real feeds come only from the encrypted Data folder / hub (calendar-snapshot.json.enc, trips.json.enc) and are cached in
  // IndexedDB under SECRET keys (calendarSnap, trips). EXAMPLE DATA uses examples/example-calendar.js and never touches the cache.
  async function calForSnapshot(s) {
    if (s.example) {
      if (!S.calExample) { S.calFeed = null; S.tripsFeed = null; }
      if (await loadScript(CFG.exampleCalendarPath || "examples/example-calendar.js") && window.DASH_EXAMPLE_CALENDAR) {
        try { S.calFeed = R.readCalendar(window.DASH_EXAMPLE_CALENDAR.calendar); S.tripsFeed = R.readTrips(window.DASH_EXAMPLE_CALENDAR.trips); S.calExample = true; } catch (e) { S.calFeed = S.tripsFeed = null; }
      }
      S.projFeed = null; S.projStore = null; S.projStoreLoaded = false;   // 00.07.000: example projects; edits made here are kept only until reload
      if (await loadScript(CFG.exampleProjectsPath || "examples/example-projects.js") && window.DASH_EXAMPLE_PROJECTS) { try { S.projStore = R.readStore(window.DASH_EXAMPLE_PROJECTS); } catch (e) { S.projStore = null; } }
      S.projExample = !!S.projStore;
      // 00.09.000: two fictional example accounts and contacts, in memory only (never cached, never synced into Projects)
      S.accStore = null; S.contacts = null; S.accLoaded = false; S.accExample = false;
      if (await loadScript(CFG.exampleAccountsPath || "examples/example-accounts.js") && window.DASH_EXAMPLE_ACCOUNTS) {
        try { const ex = window.DASH_EXAMPLE_ACCOUNTS, r = A.importAccounts(ex.files, null, new Date().toISOString()); if (r.store) { S.accStore = Object.assign(r.store, { example: true }); S.contacts = A.parseContactsCSV(ex.contactsCSV, r.store.updated_at); S.accExample = true; } } catch (e) { S.accStore = S.contacts = null; }
      }
      return;
    }
    if (S.accExample) { S.accStore = null; S.contacts = null; S.accExample = false; }   // never carry example accounts into real data
    if (!S.accLoaded) { const st = await DB.get("accountsStore"), ct = await DB.get("contacts");
      try { if (st && st.schema_version && (!S.accStore || Date.parse(st.updated_at) > Date.parse(S.accStore.updated_at))) S.accStore = A.readAccStore(st); } catch (e) { /* ignore a bad cache */ }
      try { if (ct && ct.schema_version && (!S.contacts || Date.parse(ct.updated_at) > Date.parse(S.contacts.updated_at))) S.contacts = A.readContacts(ct); } catch (e) { /* ignore a bad cache */ }
      S.accLoaded = true; }
    if (S.projExample) { S.projFeed = null; S.projStore = null; S.projExample = false; }   // never carry example projects into real data
    if (!S.projFeed) { const pj = await DB.get("projectsFeed"); try { if (pj && pj.schema_version) S.projFeed = R.readProjects(pj); } catch (e) { /* ignore a bad cache */ } }
    if (!S.projStoreLoaded) { const st = await DB.get("projectsStore"); try { if (st && st.schema_version && (!S.projStore || Date.parse(st.updated_at) > Date.parse(S.projStore.updated_at))) S.projStore = R.readStore(st); } catch (e) { /* ignore a bad cache */ } S.projStoreLoaded = true; }
    if (S.calExample) { S.calFeed = null; S.tripsFeed = null; S.calExample = false; }   // never carry example events into real data
    if (!S.calFeed) { const c = await DB.get("calendarSnap"); try { if (c && c.schema_version) S.calFeed = R.readCalendar(c); } catch (e) { /* ignore a bad cache */ } }
    if (!S.tripsFeed) { const t = await DB.get("trips"); try { if (t && t.schema_version) S.tripsFeed = R.readTrips(t); } catch (e) { /* ignore */ } }
  }

  // ---------- 00.07.000 Projects: the dashboard is the source of truth; Planner-ready exports (CSV, xlsx, Graph JSON) ----------
  // Ruling (Oct 27 2026): "Projects is the source of truth and exports Planner-ready CSV, xlsx and Graph JSON". No network calls.
  // The store lives in IndexedDB (SECRET key projectsStore, encrypted with the Data folder key) and in the Data folder / hub as
  // projects-store.json.enc only (never plaintext; not written at all until the folder is encrypted). Newest updated_at wins.
  // EXAMPLE DATA: the fictional store from examples/example-projects.js; edits stay in memory until reload.
  // The rev 1 Planner export feed (projects.json.enc) is optional: File → Import Planner export copies it into the store.
  Object.assign(S, { projFeed: null, projStore: null, projStoreLoaded: false, projPlan: "", projOwner: "", projDone: false, projExample: false });
  const projUid = p => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  function projectsModel() {
    const feed = R.storeAsFeed(S.projStore);
    const rows = R.projectRows(feed, { today: S.today, planId: S.projPlan || null, owner: S.projOwner, showCompleted: S.projDone });
    return { rows, sum: R.projectSummary(rows), choices: R.projectOwnerChoices(feed, CFG.projectOwners, {}), feed };
  }
  const DUECLS = { Overdue: "over", Today: "today", "This week": "week", Later: "later", "No date": "pnd", Done: "done" };
  const canSaveToFolder = () => !!(S.dir && S.granted && S.vault && S.vault.kr && S.vault.key);
  async function saveStore() {
    if (!S.projStore) return;
    S.projStore.updated_at = new Date().toISOString();
    if (S.projExample) { render(); return; }
    const body = { schema_version: 1, updated_at: S.projStore.updated_at, plans: S.projStore.plans };
    track(DB.set("projectsStore", body));   // while locked the encrypted cache writes nothing
    S.projDirty = !canSaveToFolder() && !!(S.vault && S.vault.kr);
    if (canSaveToFolder()) {
      try { await track(writeVerified(STORE_NAME + ".enc", "projstore", JSON.stringify(body))); delete S.saveProblems[STORE_NAME]; }   // D1
      catch (e) { S.saveProblems[STORE_NAME] = `${STORE_NAME}.enc: not saved (${e.message || e}); the previous copy is kept`; S.projDirty = true; }
    }
    render();
  }
  function curPlan() { const ps = S.projStore ? S.projStore.plans : []; return ps.find(p => p.id === S.projPlan) || (ps.length === 1 ? ps[0] : null); }
  function findTask(id) { for (const p of (S.projStore ? S.projStore.plans : [])) { const t = p.tasks.find(x => x.id === id); if (t) return { p, t }; } return null; }
  const projOps = {
    addPlan(name) { const e = R.namedProblem(name, "plan"); if (e) return e; if (!S.projStore) S.projStore = { schema_version: 1, updated_at: new Date().toISOString(), plans: [], rejects: [] };
      const id = projUid("PLAN"); S.projStore.plans.push({ id, name: name.trim(), buckets: [{ id: projUid("B"), name: "To do" }], tasks: [] }); S.projPlan = id; saveStore(); return null; },
    renamePlan(id, name) { const e = R.namedProblem(name, "plan"); if (e) return e; const p = S.projStore.plans.find(x => x.id === id); p.name = name.trim(); saveStore(); return null; },
    deletePlan(id) { S.projStore.plans = S.projStore.plans.filter(x => x.id !== id); if (S.projPlan === id) S.projPlan = ""; saveStore(); return null; },
    addBucket(planId, name) { const e = R.namedProblem(name, "bucket"); if (e) return e; const p = S.projStore.plans.find(x => x.id === planId); if (!p) return "pick a plan first"; p.buckets.push({ id: projUid("B"), name: name.trim() }); saveStore(); return null; },
    renameBucket(planId, id, name) { const e = R.namedProblem(name, "bucket"); if (e) return e; const b = S.projStore.plans.find(x => x.id === planId).buckets.find(x => x.id === id); b.name = name.trim(); saveStore(); return null; },
    deleteBucket(planId, id) { const p = S.projStore.plans.find(x => x.id === planId); if (p.tasks.some(t => t.bucketId === id)) return "move or delete the bucket's tasks first"; p.buckets = p.buckets.filter(x => x.id !== id); saveStore(); return null; },
    saveTask(planId, t) { const p = S.projStore.plans.find(x => x.id === planId); if (!p) return "pick a plan first";
      if (t.status === "completed") { t.percent = 100; t.completedOn = t.completedOn || S.today; } else { t.completedOn = null; if (t.status === "notStarted" && t.percent === 100) t.percent = 0; }
      const e = R.taskProblem(t, new Set(p.buckets.map(b => b.id))); if (e) return e;
      const n = R.normTask(t), i = p.tasks.findIndex(x => x.id === t.id); if (i >= 0) p.tasks[i] = n; else p.tasks.push(n); saveStore(); return null; },
    setPinned(id, on) { const p = S.projStore.plans.find(x => x.id === id); if (!p) return "no such plan"; p.pinned = !!on; saveStore(); return null; },
    deleteTask(id) { const f = findTask(id); if (!f) return "no such task"; f.p.tasks = f.p.tasks.filter(x => x.id !== id); saveStore(); return null; },
  };
  function setOwner(id, name) {
    const f = findTask(id); if (!f) return false;
    const names = String(name == null ? "" : name).split(/[,;]/).map(x => x.trim()).filter(Boolean);
    const e = projOps.saveTask(f.p.id, Object.assign(JSON.parse(JSON.stringify(f.t)), { assignees: names }));
    if (e) { render(); toast("Owner: " + (/names/.test(e) || /email/.test(e) ? "must be a name (no email addresses)." : e)); return false; }
    return true;
  }
  function renderProjects() {
    const el = $("#view-projects"); if (!el) return;
    const st0 = S.projStore;
    const imp = S.projFeed ? `<button class="btn" data-act="importPlanner">Import Planner export</button>` : "";
    if (!st0 || !st0.plans.length) { el.innerHTML = `<div class="projempty"><h2>Projects</h2><p>No projects yet. Projects you make here are the source of truth and export as Planner-ready CSV, Excel (xlsx) and Graph JSON. Nothing is sent to Planner.</p><button class="btn" data-pact="addPlan">+ New plan</button> <button class="btn" data-act="importProjectJson">Import project JSON…</button> ${imp}</div>`; return; }
    const m = projectsModel(), plan = curPlan();
    const when = `${R.dayLabel(R.isoDay(st0.updated_at))} ${R.hm(st0.updated_at)} ${R.tzLabel(st0.updated_at)}`;
    const where = S.projExample ? "EXAMPLE DATA · changes are kept until reload" : S.vault && S.vault.kr && !S.vault.key ? "🔒 locked · changes are kept in memory only (browser only, not saved) until you unlock: File → Encryption…" : canSaveToFolder() ? "saved encrypted in the Data folder" : "saved in this browser only · encrypt the Data folder (File → Encryption…) to keep projects there";
    const planOpts = `<option value="">All plans</option>` + st0.plans.map(p => `<option value="${esc(p.id)}"${p.id === S.projPlan ? " selected" : ""}>${esc(p.name)}</option>`).join("");
    const dl = `<datalist id="proj-owners">${m.choices.map(c => `<option value="${esc(c)}"></option>`).join("")}</datalist>`;
    const groups = [];
    st0.plans.forEach(p => { if (S.projPlan && p.id !== S.projPlan) return; p.buckets.concat([{ id: null, name: "No bucket" }]).forEach(b => { const rows = m.rows.filter(r => r.planId === p.id && r.bucketId === b.id); if (b.id || rows.length) groups.push({ p, b, rows }); }); });
    const row = r => `<tr data-ptask="${esc(r.id)}" class="${r.status === "completed" ? "pdone" : ""}">
      <td class="ptitle"><button class="tlink" data-pedit="${esc(r.id)}" aria-label="Edit ${esc(r.title)}">${esc(r.title)}</button>${r.account ? ` <span class="pacct">${esc(r.account)}</span>` : ""}${r.labels.filter(l => l !== r.account).map(l => ` <span class="plabel">${esc(l)}</span>`).join("")}</td>
      <td class="pown"><input class="ownin" list="proj-owners" data-owner="${esc(r.id)}" value="${esc(r.owner)}" placeholder="unassigned" aria-label="Owner of ${esc(r.title)} (pick or type)" maxlength="80"></td>
      <td>${esc(R.PROJ_STATUS_WORD[r.status])}</td>
      <td class="ppct"><span class="pbar" aria-hidden="true"><i style="width:${r.percent}%"></i></span> <span class="mono">${r.percent}%</span></td>
      <td>${r.checklist ? `<span class="mono">${r.checklist.done}/${r.checklist.total}</span>` : ""}</td>
      <td class="pdue ${DUECLS[r.dueWord]}">${r.due ? `<span class="mono">${esc(R.dayLabel(r.due))}</span> ` : ""}<span class="dw">${esc(r.dueWord)}</span></td>
      <td>${r.priority === "urgent" ? '<span class="ppri urgent">Urgent</span>' : r.priority === "important" ? '<span class="ppri">Important</span>' : ""}</td></tr>`;
    el.innerHTML = pinnedHtml("projects") + `<div class="projhead"><div><h2>Projects <span class="faint" style="font-size:12px;font-weight:400">· source of truth · exports Planner-ready CSV, xlsx and Graph JSON</span></h2>
        <div class="projasof" role="status">Updated ${esc(when)} · ${esc(where)}</div></div>
      <div class="projtools"><label>Plan <select id="proj-plan">${planOpts}</select></label>
        <label>Owner <input id="proj-owner" list="proj-owners" value="${esc(S.projOwner)}" placeholder="anyone (or (unassigned))" aria-label="Filter by owner (pick or type)"></label>
        <label><input type="checkbox" id="proj-done"${S.projDone ? " checked" : ""}> Show completed</label></div></div>
      <div class="projtools projacts"><button class="btn" data-pact="addPlan">+ Plan</button>${plan ? `<button class="btn" data-pact="renamePlan">Rename plan</button><button class="btn" data-pact="deletePlan">Delete plan</button><button class="btn" data-pact="addBucket">+ Bucket</button><button class="btn" data-pact="addTask">+ Task</button><button class="btn" data-pact="togglePin" aria-pressed="${!!plan.pinned}">${plan.pinned ? "📌 Unpin from Front and center" : "📌 Pin to Front and center"}</button>` : '<span class="faint">Pick a plan to add buckets and tasks.</span>'}
        <span class="sep"></span><button class="btn" data-act="exportProjects">Export CSV</button><button class="btn" data-act="exportProjectsXlsx">Export xlsx</button><button class="btn" data-act="exportProjectsGraph">Export Graph JSON</button><button class="btn" data-act="printProjects">Print</button><button class="btn" data-act="importProjectJson">Import project JSON…</button>${imp}</div>
      ${dl}
      <div class="projsum" role="list">${[["Open", m.sum.total - m.sum.completed], ["Overdue", m.sum.overdue], ["Due today", m.sum.today], ["In progress", m.sum.inProgress], ["Unassigned", m.sum.unassigned]].map(([k, v]) => `<div class="psq" role="listitem"><b>${v}</b><span>${k}</span></div>`).join("")}</div>
      ${st0.rejects && st0.rejects.length ? `<details class="faint projrej"><summary>⚠ ${st0.rejects.length} item(s) skipped</summary>${st0.rejects.map(x => `<div>${esc(x)}</div>`).join("")}</details>` : ""}
      ${groups.map(g => `<section class="pgroup"><h3>${esc(g.p.name)} <span class="faint">›</span> ${esc(g.b.name)} <span class="faint">(${g.rows.length})</span>${g.b.id ? ` <button class="btn linkbtn" data-pact="addTask" data-plan="${esc(g.p.id)}" data-bucket="${esc(g.b.id)}">+ Task</button><button class="btn linkbtn" data-pact="renameBucket" data-plan="${esc(g.p.id)}" data-bucket="${esc(g.b.id)}">Rename</button><button class="btn linkbtn" data-pact="deleteBucket" data-plan="${esc(g.p.id)}" data-bucket="${esc(g.b.id)}">Delete</button>` : ""}</h3>
        ${g.rows.length ? `<table class="ptable"><thead><tr><th>Task</th><th>Owner</th><th>Status</th><th>Progress</th><th>Checklist</th><th>Due</th><th></th></tr></thead><tbody>${g.rows.map(row).join("")}</tbody></table>` : '<div class="faint" style="font-size:12px">No tasks.</div>'}</section>`).join("") || '<div class="faint" style="padding:10px">No tasks match.</div>'}
      <div class="faint projfoot">Exports are files only; nothing is sent to Planner or Microsoft Graph. No pricing or dollar figures in projects. Rev ${REV}</div>`;
  }
  // ---- task editor ----
  function taskEditor(planId, task) {
    closeTaskEditor();
    const p = S.projStore.plans.find(x => x.id === planId), t = task ? JSON.parse(JSON.stringify(task)) : { id: projUid("T"), title: "", bucketId: (p.buckets[0] || {}).id || null, assignees: [], status: "notStarted", percent: 0, start: null, due: null, priority: "medium", labels: [], notes: "", account: null, checklist: [] };
    const d = document.createElement("div"); d.id = "projdlg"; d.className = "overlay open";
    const ck = () => t.checklist.map((c, i) => `<li><label><input type="checkbox" data-ck="${i}"${c.done ? " checked" : ""}> ${esc(c.title)}</label> <button class="btn linkbtn" data-ckdel="${i}" aria-label="Remove ${esc(c.title)}">✕</button></li>`).join("");
    const draw = () => { d.innerHTML = `<div class="dlg projdlg" role="dialog" aria-modal="true" aria-labelledby="pd-h" tabindex="-1"><h3 id="pd-h">${task ? "Edit task" : "New task"} · ${esc(p.name)}</h3>
      <label>Title <input id="pd-title" value="${esc(t.title)}" maxlength="255"></label>
      <div class="pdrow"><label>Bucket <select id="pd-bucket">${p.buckets.map(b => `<option value="${esc(b.id)}"${b.id === t.bucketId ? " selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>
        <label>Owner <input id="pd-owner" list="proj-owners" value="${esc(t.assignees.join(", "))}" placeholder="pick or type"></label></div>
      <div class="pdrow"><label>Status <select id="pd-status">${R.PROJ_STATUS.map(s2 => `<option value="${s2}"${s2 === t.status ? " selected" : ""}>${R.PROJ_STATUS_WORD[s2]}</option>`).join("")}</select></label>
        <label>Progress % <input id="pd-pct" type="number" min="0" max="100" value="${t.percent}"></label>
        <label>Priority <select id="pd-pri">${["urgent", "important", "medium", "low"].map(x => `<option value="${x}"${x === t.priority ? " selected" : ""}>${x[0].toUpperCase() + x.slice(1)}</option>`).join("")}</select></label></div>
      <div class="pdrow"><label>Start <input id="pd-start" type="date" value="${t.start || ""}"></label><label>Due <input id="pd-due" type="date" value="${t.due || ""}"></label></div>
      <label>Labels (comma-separated) <input id="pd-labels" value="${esc(t.labels.join(", "))}"></label>
      <label>Account <input id="pd-acct" value="${esc(t.account || "")}"></label>
      <label>Notes <textarea id="pd-notes" rows="3" maxlength="2000">${esc(t.notes || "")}</textarea></label>
      <div><b>Checklist</b> <span class="faint">(${t.checklist.filter(c => c.done).length}/${t.checklist.length})</span><ul class="pdck">${ck()}</ul><input id="pd-cknew" placeholder="Add a checklist item, Enter" maxlength="100"></div>
      <div id="pd-err" class="danger" role="alert"></div>
      <div class="pdbtns"><button class="btn" id="pd-save">Save</button><button class="btn" id="pd-cancel">Cancel</button>${task ? '<button class="btn dangerbtn" id="pd-del">Delete task</button>' : ""}</div></div>`; };
    const read = () => { const v = id => d.querySelector(id).value;
      Object.assign(t, { title: v("#pd-title"), bucketId: v("#pd-bucket") || null, assignees: v("#pd-owner").split(/[,;]/).map(x => x.trim()).filter(Boolean), status: v("#pd-status"), percent: Number(v("#pd-pct")),
        priority: v("#pd-pri"), start: v("#pd-start") || null, due: v("#pd-due") || null, labels: v("#pd-labels").split(",").map(x => x.trim()).filter(Boolean), account: v("#pd-acct").trim() || null, notes: v("#pd-notes") }); };
    draw(); document.body.appendChild(d); d.querySelector("#pd-title").focus();
    d.addEventListener("change", e => { const i = e.target.dataset.ck; if (i != null) { read(); t.checklist[+i].done = e.target.checked; draw(); } });
    d.addEventListener("keydown", e => { if (e.target.id === "pd-cknew" && e.key === "Enter") { e.preventDefault(); const x = e.target.value.trim(); if (!x) return; read(); t.checklist.push({ id: projUid("C"), title: x, done: false }); draw(); d.querySelector("#pd-cknew").focus(); } });
    d.addEventListener("click", e => {
      if (e.target.dataset.ckdel != null) { read(); t.checklist.splice(+e.target.dataset.ckdel, 1); draw(); return; }
      if (e.target.id === "pd-cancel" || e.target === d) return closeTaskEditor();
      if (e.target.id === "pd-del") { if (!confirm("Delete this task?")) return; projOps.deleteTask(t.id); closeTaskEditor(); toast("Task deleted."); return; }
      if (e.target.id === "pd-save") { read(); const err = projOps.saveTask(planId, t); if (err) { d.querySelector("#pd-err").textContent = "⚠ " + err; return; } closeTaskEditor(); toast("Task saved."); }
    });
  }
  function closeTaskEditor() { const d = $("#projdlg"); if (d) d.remove(); }
  function projectsChange(e) {
    const t = e.target; if (!t.closest || !t.closest("#view-projects")) return false;
    if (t.id === "proj-plan") { S.projPlan = t.value; render(); return true; }
    if (t.id === "proj-owner") { S.projOwner = t.value.trim(); render(); return true; }
    if (t.id === "proj-done") { S.projDone = t.checked; render(); return true; }
    if (t.dataset.owner) { setOwner(t.dataset.owner, t.value); return true; }
    return false;
  }
  function projectsClick(e) {
    const ed2 = e.target.closest("[data-pedit]"); if (ed2) { const f = findTask(ed2.dataset.pedit); if (f) taskEditor(f.p.id, f.t); return true; }
    const b = e.target.closest("[data-pact]"); if (!b) return false;
    const a = b.dataset.pact, plan = b.dataset.plan ? S.projStore.plans.find(x => x.id === b.dataset.plan) : curPlan(), say = err => { if (err) toast("⚠ " + err); };
    if (a === "addPlan") { const n = prompt("New plan name"); if (n != null) say(projOps.addPlan(n)); }
    else if (a === "renamePlan" && plan) { const n = prompt("Rename plan", plan.name); if (n != null) say(projOps.renamePlan(plan.id, n)); }
    else if (a === "deletePlan" && plan) { if (confirm(`Delete the plan "${plan.name}" and its ${plan.tasks.length} task(s)?`)) say(projOps.deletePlan(plan.id)); }
    else if (a === "addBucket" && plan) { const n = prompt("New bucket name"); if (n != null) say(projOps.addBucket(plan.id, n)); }
    else if (a === "renameBucket") { const bk = plan.buckets.find(x => x.id === b.dataset.bucket), n = prompt("Rename bucket", bk.name); if (n != null) say(projOps.renameBucket(plan.id, bk.id, n)); }
    else if (a === "deleteBucket") { if (confirm("Delete this bucket?")) say(projOps.deleteBucket(plan.id, b.dataset.bucket)); }
    else if (a === "togglePin" && plan) say(projOps.setPinned(plan.id, !plan.pinned));
    else if (a === "addTask" && plan) { taskEditor(plan.id, null); if (b.dataset.bucket) { $("#pd-bucket").value = b.dataset.bucket; } }
    return true;
  }
  function exportProjects(kind) {
    if (!S.projStore || !S.projStore.plans.length) { toast("No projects to export yet."); return; }
    const word = kind === "xlsx" ? "Excel (xlsx)" : kind === "graph" ? "Graph JSON" : "CSV";
    if (S.vault && S.vault.kr && !confirm(`This saves your projects unencrypted (${word}) to Downloads. Continue?`)) return;
    const planId = S.projPlan || null, base = `dash-projects-${S.today}`;
    let blob, name;
    if (kind === "xlsx") { blob = new Blob([R.plannerXlsx(S.projStore, planId, S.today).bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); name = base + ".xlsx"; }
    else if (kind === "graph") { blob = new Blob([JSON.stringify(R.plannerGraph(S.projStore, planId), null, 1)], { type: "application/json" }); name = base + "-graph.json"; }
    else { blob = new Blob([R.plannerCSV(S.projStore, planId, S.today)], { type: "text/csv" }); name = base + ".csv"; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`Exported ${word}: ${name}`);
  }
  function importPlanner() {
    if (!S.projFeed) { toast("No Planner export (projects.json.enc) found."); return; }
    if (S.projExample) { toast("Load your real data first."); return; }
    const r = R.storeFromFeed(S.projFeed, S.projStore, new Date().toISOString()); S.projStore = R.readStore(r.store); S.projPlan = ""; saveStore(); toast(`Imported ${r.added} task(s) from the Planner export.`);
  }
  // ---- 00.08.000 Front and center strip (pinned plans) and File → Import project JSON… ----
  function pinnedHtml(where) {
    const st = R.pinnedStrip(S.projStore, S.today); if (!st.length) return "";
    const n = st.reduce((a, x) => a + x.open, 0);
    const row = t => `<div class="fcrow" role="listitem"><span class="pdue ${DUECLS[t.dueWord] || ""}"><span class="dw">${esc(t.dueWord)}</span>${t.due ? ` · ${esc(R.dayLabel(t.due))}` : ""}</span>
      <button class="tlink" data-pinedit="${esc(t.id)}" aria-label="Edit ${esc(t.title)}">${esc(t.title)}</button><span class="fcb faint">${esc(t.bucket)}${t.assignees.length ? " · " + esc(t.assignees.join(", ")) : ""}</span>
      <span class="mono faint">${esc(R.PROJ_STATUS_WORD[t.status])}${t.checklist.length ? ` · ${t.checklist.filter(c => c.done).length}/${t.checklist.length}` : ""}</span></div>`;
    return `<section class="fcstrip" id="fc-${where}" aria-labelledby="fch-${where}"><h2 class="fch" id="fch-${where}">📌 Front and center <span class="badge" aria-label="${n} open task${n === 1 ? "" : "s"}">${n}</span><span class="faint fcnote">pinned until every task is completed</span></h2>
      ${st.map(p => `<div class="fcplan"><div class="fcpn">${esc(p.name)} <span class="faint">· ${p.open} open of ${p.total}${p.overdue ? ` · <span class="fcover">${p.overdue} overdue</span>` : ""}</span></div><div role="list">${p.tasks.map(row).join("")}</div></div>`).join("")}</section>`;
  }
  function importProjectJson(name, text) {
    if (S.projExample || (S.snap && S.snap.example)) { toast("⚠ Load your real data first: a project file is never mixed with EXAMPLE DATA. Nothing was imported."); return; }   // X1
    if (!canSaveToFolder()) { toast("⚠ Import project JSON needs an encrypted, unlocked Data folder (File → Encryption…), so the projects are never kept unencrypted. Nothing was imported."); return; }
    if (text.length > R.IMPORT_MAX) { toast(`⚠ ${name} is too large to be a project file. Nothing was imported.`); return; }
    let raw; try { raw = JSON.parse(text); } catch (e) { toast(`⚠ ${name} is not valid JSON. Nothing was imported.`); return; }
    let r; try { r = R.importProjectFile(raw, S.projStore, new Date().toISOString()); } catch (e) { toast(`⚠ ${name}: ${e.message}. Nothing was imported.`); return; }
    S.importRejects = r.rejects;
    if (r.rejects.length) { toast(`⚠ ${name}: nothing imported, ${r.rejects.length} problem(s): ${r.rejects.slice(0, 3).join("; ")}${r.rejects.length > 3 ? "; …" : ""}`); return; }
    S.projStore = R.readStore(r.store); S.projPlan = r.planIds.length === 1 ? r.planIds[0] : ""; saveStore();
    toast(`Imported ${r.added} task(s) from ${name}${r.skipped ? `; ${r.skipped} already here, kept as they are` : ""}. Saved encrypted. ${name} itself is not encrypted: delete it now.`);
  }
  // ---------- 00.09.000 Accounts: strategic account plans (read-only), contacts, open loops into Projects ----------
  // Plan rev 3 decisions: account plans are read-only here (they change in the notebook, then are imported again); open loops go into
  // Projects automatically, never twice; contacts are imported encrypted and email and phone are never printed; one account first.
  // Stored only as accounts-store.json.enc and contacts.json.enc (and the SECRET IndexedDB keys accountsStore and contacts).
  Object.assign(S, { accStore: null, contacts: null, accLoaded: false, accExample: false, accSel: "", accTier: "", accQ: "", accRejects: [] });
  const TIERW = { key: "Key", prospect: "Prospect", watch: "Watch" };
  const tierChip = t => `<span class="tierchip t-${esc(t)}">${esc(TIERW[t] || t)}</span>`;
  const unv = on => on ? ` <span class="unv" title="unverified">unverified</span>` : "";
  const dd = d => d && d !== "unknown" ? esc(R.dayLabel(d)) : esc(d || "—");
  async function saveAccounts(which) {
    if (S.accExample) { render(); return; }
    const o = which === "contacts" ? S.contacts : S.accStore; if (!o) return;
    const key = which === "contacts" ? "contacts" : "accountsStore", name = which === "contacts" ? CONTACTS_NAME : ACC_NAME, purpose = which === "contacts" ? "contacts" : "accstore";
    const body = which === "contacts" ? { schema_version: 1, updated_at: o.updated_at, contacts: o.contacts } : { schema_version: 1, updated_at: o.updated_at, accounts: o.accounts };
    track(DB.set(key, body));
    if (canSaveToFolder()) await track(writeVerified(name + ".enc", purpose, JSON.stringify(body)));
    render();
  }
  function importRefused(what) {
    if (S.accExample || S.projExample || (S.snap && S.snap.example)) { toast(`⚠ Load your real data first: ${what} is never mixed with EXAMPLE DATA. Nothing was imported.`); return true; }
    if (!canSaveToFolder()) { toast(`⚠ ${what} needs an encrypted, unlocked Data folder (File → Encryption…), so it is never kept unencrypted. Nothing was imported.`); return true; }
    return false;
  }
  function importAccountFiles(files) {
    if (importRefused("Importing account plans")) return null;
    const now = new Date().toISOString(), r = A.importAccounts(files, S.accStore, now);
    S.accRejects = r.rejects;
    if (r.rejects.length) { toast(`⚠ Nothing imported, ${r.rejects.length} problem(s): ${r.rejects.slice(0, 3).join("; ")}${r.rejects.length > 3 ? "; …" : ""}`); render(); return r; }
    let ps = S.projStore, created = 0, linked = 0, updated = 0, asks = 0;
    // The previous import's loop links (plus prompts still waiting for a choice) tell which loops left in this import.
    // Decision: ask first before treating a reworded loop as the same task, and before treating a repeated loop with a later date
    // as the same (completed) task: both only come back as prompts (Possible rename, Repeated loop).
    r.slugs.forEach(sl => { const a = r.store.accounts.find(x => x.slug === sl), old = S.accStore && S.accStore.accounts.find(x => x.slug === sl);
      const prev = Object.assign({}, old && old.loopRefs); ((old && old.pendingRenames) || []).forEach(q => { prev[q.oldLoopId || "pending-" + q.taskId] = q.taskId; });
      const s = A.syncLoops(a, ps, now, prev, { rename: "confirm" }); ps = s.projStore; created += s.created; linked += s.linked; updated += s.updated; a.loopRefs = s.refs; a.pendingRenames = s.renames; asks += s.renames.length; });
    const chk = R.readStore(ps);
    if (chk.rejects.length) { toast(`⚠ Nothing imported: an open loop would not save in Projects (${chk.rejects[0]}).`); return r; }
    S.accStore = r.store; if (r.slugs.length === 1) S.accSel = r.slugs[0];
    saveAccounts("accounts");
    if (created || updated || linked || !S.projStore) { S.projStore = chk; saveStore(); }
    toast(`Imported ${r.slugs.length} account plan(s) (${r.added} new, ${r.changed} changed, ${r.same} unchanged). Open loops: ${created} added to Projects, ${linked} already there${asks ? `, ${asks} possible rename(s) or repeated loop(s): choose Same task or New task on the Accounts tab` : ""}. Saved encrypted. Delete the plain .md copies you picked if they aren't in your notebook.`);
    return r;
  }
  function importContactsFile(name, text) {
    if (importRefused("Importing contacts")) return null;
    let r; try { r = A.parseContactsCSV(text, new Date().toISOString()); } catch (e) { toast(`⚠ ${name}: ${e.message}. Nothing was imported.`); return null; }
    S.contacts = { schema_version: 1, updated_at: r.updated_at, contacts: r.contacts }; saveAccounts("contacts");
    toast(`Imported ${r.contacts.length} contact(s)${r.rejects.length ? `; ${r.rejects.length} row(s) skipped (pricing)` : ""}. Saved encrypted; email and phone show only on screen behind "contact" and are never printed. Delete the plain CSV you picked.`);
    return r;
  }
  function accountsModel() {
    const q = S.accQ.trim().toLowerCase();
    const list = A.listOrder(S.accStore, S.today, S.projStore).filter(x => (!S.accTier || x.a.tier === S.accTier) && (!q || x.a.account.toLowerCase().includes(q)));
    return { list, sel: list.find(x => x.a.slug === S.accSel) || list[0] || null };
  }
  function findTaskById(id) { return id && S.projStore ? S.projStore.plans.reduce((f, p) => f || p.tasks.find(q => q.id === id), null) : null; }
  function accPage(x, print) {
    const a = x.a, ts = x.ts, link = A.findNextMove(a, S.projStore);
    const top = x.moveOver ? `<b class="c-over">Next move overdue</b>` : ts.overdue ? `<b class="c-over">Touch overdue ${ts.days} d</b>` : ts.due ? `Next touch ${dd(ts.due)}` : "";
    const li = arr => arr.length ? `<ul>${arr.map(i => `<li${i.unverified ? ' class="unvli"' : ""}>${esc(i.text)}${unv(i.unverified)}</li>`).join("")}</ul>` : `<p class="faint">Nothing listed.</p>`;
    const sec = (n, body) => `<section class="accsec"><h3>${esc(A.SECTION_TITLES[n - 1].replace(/^(\d)\./, "$1."))}</h3>${body}</section>`;
    const people = a.stakeholders.map(s => { const m = A.matchContacts(s, S.contacts);
      const ci = m.map(c => c.contact ? `<div class="faint ctl">${esc(c.name)} · ${esc(c.contact.title || "")}${c.contact.last_touch ? ` · contacts last touch ${dd(c.contact.last_touch)}` : ""}${print ? "" : ` <details class="ctd noprint"><summary>contact</summary><span class="mono">${esc(c.contact.email || "no email")}</span>${c.contact.phone ? ` · <span class="mono">${esc(c.contact.phone)}</span>` : ""}</details>`}</div>` : c.candidates > 1 ? `<div class="faint">${esc(c.name)}: ${c.candidates} possible matches</div>` : "").join("");
      return `<tr${s.unverified ? ' class="unvrow"' : ""}><td><b>${esc(s.name)}</b>${unv(s.unverified)}${ci}</td><td>${esc(s.orgName)}</td><td>${esc(s.role)}</td><td class="inf-${esc(s.influence.toLowerCase())}">${esc(s.influence)}</td><td class="sen-${esc(s.sentiment.toLowerCase())}">${esc(s.sentiment)}</td><td>${dd(s.last_touch)}</td><td>${esc(s.notes)}</td></tr>`; }).join("");
    const opps = a.opportunities.map(o => `<tr${o.unverified ? ' class="unvrow"' : ""}><td>${esc(o.name)}${unv(o.unverified)}</td><td><span class="stage">${esc(o.stage)}</span></td><td>${esc(o.next_step)}</td><td>${dd(o.next_step_date)}</td></tr>`).join("");
    const tt = o => o ? `${dd(o.date)} · ${esc(o.type)} · ${esc(o.with)}` : "—";
    const nm = a.next_move, t = link && link.t;
    const nmHtml = nm ? `<div class="kv"><span>Action</span><b>${esc(nm.action)}${unv(nm.unverified)}</b><span>Owner</span><span>${esc(t ? t.assignees.join(", ") || nm.owner : nm.owner)}</span><span>Due</span><span class="${(t ? t.due : nm.due) < S.today && !(t && t.status === "completed") ? "c-over" : ""}">${dd(t ? t.due : nm.due)}</span>
      <span>Projects</span><span>${t ? `linked to task <span class="mono">${esc(t.id)}</span> · ${esc(R.PROJ_STATUS_WORD[t.status])}${t.due !== nm.due ? ` <span class="warnt">file says due ${esc(R.dayLabel(nm.due))}</span>` : ""}${print ? "" : ` <button class="linkbtn noprint" data-accgo-task="${esc(t.id)}">open in Projects</button>`}` : link && link.missing ? `<span class="warnt">task_id ${esc(link.missing)} is not in Projects</span>` : print ? "not in Projects yet" : `<button class="btn noprint" data-accmove="${esc(a.slug)}">Create Projects task</button>`}</span></div>` : "<p class='faint'>No next move.</p>";
    const loops = a.open_loops.map(l => { const tk = findTaskById((a.loopRefs || {})[l.id]), pq = (a.pendingRenames || []).find(q => q.loopId === l.id);
      return `<li>${esc(l.item)}${unv(l.unverified)} <span class="faint">· ${esc(l.bucket)} · ${dd(l.next_date)}</span> ${pq && pq.kind === "recur" ? `<span class="warnt">repeated loop: waiting for your choice</span>` : pq ? `<span class="warnt">possible rename: waiting for your choice</span>` : tk ? `<span class="faint">· Projects: ${esc(R.PROJ_STATUS_WORD[tk.status])}</span>` : `<span class="warnt">not in Projects</span>`}</li>`; }).join("");
    const live = new Set(a.open_loops.map(l => "loop:" + l.id)), plan = S.projStore && S.projStore.plans.find(p => p.id === A.accPlanId(a.slug)), refd = new Set(Object.values(a.loopRefs || {}));
    const gone = plan ? plan.tasks.filter(tk => tk.labels.some(lb => lb.startsWith("loop:")) && !tk.labels.some(lb => live.has(lb)) && !refd.has(tk.id)) : [];
    const goneHtml = gone.length ? `<p class="faint">Tasks whose loop is no longer in the file (kept in Projects): ${gone.map(tk => `<span class="mono">${esc(tk.title)}</span> (${esc(R.PROJ_STATUS_WORD[tk.status])})`).join(", ")}</p>` : "";
    return `<article class="accpage">
      <header class="acchead"><div><h2>${esc(a.account)} ${tierChip(a.tier)} <span class="badge">${esc(a.status)}</span></h2><div class="faint">${esc(a.segment)} · ${esc(a.region)} · updated ${dd(a.last_updated)} · ${esc(a.confidential)}${a.unverified_found ? ` · <span class="unv">${a.unverified_found} unverified</span>` : ""}</div></div><div class="acctop">${top}</div></header>
      ${sec(1, li(a.happening))}
      ${sec(2, `<table class="acctab"><thead><tr><th>Name</th><th>Org</th><th>Role</th><th>Influence</th><th>Sentiment</th><th>Last touch</th><th>Notes</th></tr></thead><tbody>${people}</tbody></table>`)}
      ${sec(3, li(a.goals))}
      ${sec(4, a.opportunities.length ? `<table class="acctab"><thead><tr><th>Opportunity</th><th>Stage</th><th>Next step</th><th>Next step date</th></tr></thead><tbody>${opps}</tbody></table>` : `<p class="faint">No opportunities listed.</p>`)}
      ${sec(5, `<div class="kv"><span>Last touch</span><span>${tt(a.last_touch)}</span><span>Next touch</span><span class="${ts.overdue ? "c-over" : ""}">${tt(a.next_touch)}${ts.overdue ? ` · ${ts.days} d overdue` : ""}</span><span>Cadence</span><span>${esc(a.touch_cadence)}${ts.byCadence ? ` · by cadence ${dd(ts.byCadence)}` : ""}</span></div>`)}
      ${sec(6, nmHtml)}
      <section class="accsec"><h3>Open loops <span class="faint">in Projects plan “Accounts – ${esc(a.account)}”</span></h3>${loops ? `<ul>${loops}</ul>` : `<p class="faint">No open loops.</p>`}${goneHtml}</section>
      <section class="accsec"><h3>Sources &amp; unverified items</h3>${a.sources.length ? `<ul>${a.sources.map(s => `<li class="mono">${esc(s)}</li>`).join("")}</ul>` : ""}${li(a.unverified_items)}</section>
      ${print ? `<footer class="accfoot"><b>Confidential: ${esc(a.confidential)}</b> · ${esc(a.account)} · account plan, read-only copy · Rev ${REV}</footer>` : ""}
    </article>`;
  }
  function renderAccounts() {
    const el = $("#view-accounts"); if (!el) return;
    const where = S.accExample ? "EXAMPLE DATA · fictional accounts" : S.vault && S.vault.kr && !S.vault.key ? "🔒 locked" : canSaveToFolder() ? "saved encrypted" : "import needs an encrypted, unlocked Data folder";
    const tools = `<button class="btn" data-act="importAccounts">Import account plans (.md)…</button> <button class="btn" data-act="importContacts">Import contacts (CSV)…</button> <button class="btn" data-act="printAccounts">Print</button>`;
    const asks = [].concat(...(S.accStore ? S.accStore.accounts : []).map(a => (a.pendingRenames || []).map(q => [a, q])));
    const btns = (a, q, same) => `<button class="btn" data-accren="${esc(a.slug)}" data-loop="${esc(q.loopId)}" data-ch="same">${same}</button> <button class="btn" data-accren="${esc(a.slug)}" data-loop="${esc(q.loopId)}" data-ch="new">New task</button>`;
    const askRow = ([a, q]) => q.kind === "recur"
      ? `<div class="askrow askrecur" data-askloop="${esc(q.loopId)}"><b>${esc(a.account)}</b> · ${esc(q.bucket)}<div>Completed task: <span class="mono">${esc(q.from)}</span> (${esc(q.taskDate || "no date")})</div><div>Loop again, dated <span class="mono">${esc(q.loopDate || "")}</span>: <span class="mono">${esc(q.to)}</span></div>${btns(a, q, "Same task (reopen)")}</div>`
      : `<div class="askrow" data-askloop="${esc(q.loopId)}"><b>${esc(a.account)}</b> · ${esc(q.bucket)}<div>Old task: <span class="mono">${esc(q.from)}</span></div><div>New loop: <span class="mono">${esc(q.to)}</span></div>${btns(a, q, "Same task")}</div>`;
    const asksR = asks.filter(x => x[1].kind !== "recur"), asksC = asks.filter(x => x[1].kind === "recur");
    const ask = asks.length && !S.accExample ? `${asksR.length ? `<section class="accask" role="region" aria-labelledby="accask-h"><h3 id="accask-h">Possible rename <span class="badge">${asksR.length}</span> <span class="faint">a loop was reworded or moved; nothing is merged until you choose</span></h3>${asksR.map(askRow).join("")}</section>` : ""}${asksC.length ? `<section class="accask accrecur" role="region" aria-labelledby="accrec-h"><h3 id="accrec-h">Repeated loop <span class="badge">${asksC.length}</span> <span class="faint">a loop matches a completed task but has a later date; nothing is linked until you choose</span></h3>${asksC.map(askRow).join("")}</section>` : ""}` : "";
    const rej = S.accRejects && S.accRejects.length ? `<div class="projrej" role="alert"><b>Last import refused:</b><ul>${S.accRejects.slice(0, 12).map(x => `<li class="mono">${esc(x)}</li>`).join("")}</ul></div>` : "";
    if (!S.accStore || !S.accStore.accounts.length) { el.innerHTML = `<div class="projempty"><h2>Accounts</h2><p>No account plans yet. Account plans are Markdown files kept in the notebook (one per account, schema v1). They are read-only here: change them in the notebook, then import again. Open loops go into Projects automatically.</p>${tools}<p class="faint">${esc(where)}</p>${rej}</div>`; return; }
    const m = accountsModel();
    const counts = { all: S.accStore.accounts.length }; A.TIERS.forEach(t => counts[t] = S.accStore.accounts.filter(a => a.tier === t).length);
    const list = m.list.map(x => `<button class="accli${m.sel && m.sel.a.slug === x.a.slug ? " sel" : ""}" data-accsel="${esc(x.a.slug)}" aria-pressed="${!!(m.sel && m.sel.a.slug === x.a.slug)}"><b>${esc(x.a.account)}</b> ${tierChip(x.a.tier)}${x.moveOver || x.ts.overdue ? ` <span class="c-over">● overdue</span>` : ""}${x.a.unverified_found ? ` <span class="unv">${x.a.unverified_found}</span>` : ""}</button>`).join("");
    const all = A.listOrder(S.accStore, S.today, S.projStore);
    el.innerHTML = `<div class="acctools projtools"><h2>Accounts</h2><label>Tier <select id="acc-tier"><option value="">All (${counts.all})</option>${A.TIERS.map(t => `<option value="${t}"${S.accTier === t ? " selected" : ""}>${TIERW[t]} (${counts[t]})</option>`).join("")}</select></label> <input id="acc-q" placeholder="Find account" value="${esc(S.accQ)}" aria-label="Find account"> ${tools} <span class="faint projasof">${esc(where)} · contacts: ${S.contacts ? S.contacts.contacts.length : 0}</span></div>${rej}
${ask}
      <div class="accwrap"><nav class="acclist" aria-label="Accounts">${list || `<p class="faint">No accounts match.</p>`}</nav><div class="accmain">${m.sel ? accPage(m.sel, false) : ""}</div></div>
      <div class="accprint" aria-hidden="true">${all.map(x => accPage(x, true)).join("")}</div>
      <div class="faint projfoot">Read-only: account plans change in the notebook, then File → Import account plans. No pricing or dollar figures. Rev ${REV}</div>`;
  }
  function accFocusHtml() {
    const rows = A.focusTouches(S.accStore, S.today, S.projStore), np = S.accExample ? 0 : A.pendingPrompts(S.accStore); if (!rows.length && !np) return "";
    const first = np ? (S.accStore.accounts.find(a => (a.pendingRenames || []).length) || {}).slug || "" : "";
    const pend = np ? `<div class="accpend"><button class="linkbtn" data-accgo="${esc(first)}">${np} import prompt${np === 1 ? "" : "s"} waiting for your choice</button> <span class="faint">on the Accounts tab</span></div>` : "";
    return `<section class="accfocus" aria-labelledby="accf-h"><h2 id="accf-h">🤝 Account touches <span class="badge">${rows.length}</span> <span class="faint fcnote">from account plans · cadence and next moves</span></h2>${pend}<div role="list">${rows.slice(0, 8).map(r => `<div role="listitem" class="accfrow"><button class="linkbtn" data-accgo="${esc(r.slug)}">${esc(r.account)}</button> ${tierChip(r.tier)} · ${esc(r.what)} · <span class="${r.due < S.today ? "c-over" : ""}">${r.due < S.today ? r.days + " d overdue" : "due today"}</span></div>`).join("")}${rows.length > 8 ? `<div class="faint">+${rows.length - 8} more on the Accounts tab</div>` : ""}</div></section>`;
  }
  function accountsClick(e) {
    const go = e.target.closest && e.target.closest("[data-accgo]"); if (go) { S.accSel = go.dataset.accgo; setView("accounts"); return true; }
    const s = e.target.closest && e.target.closest("[data-accsel]"); if (s) { S.accSel = s.dataset.accsel; render(); return true; }
    const gt = e.target.closest && e.target.closest("[data-accgo-task]"); if (gt) { const f = findTask(gt.dataset.accgoTask); if (f) { S.projPlan = f.p.id; setView("projects"); taskEditor(f.p.id, f.t); } return true; }
    const rn = e.target.closest && e.target.closest("[data-accren]"); if (rn) { renameChoice(rn.dataset.accren, rn.dataset.loop, rn.dataset.ch); return true; }
    const mv = e.target.closest && e.target.closest("[data-accmove]"); if (mv) { const a = S.accStore && S.accStore.accounts.find(x => x.slug === mv.dataset.accmove); if (!a) return true;
      const r = A.createNextMove(a, S.projStore, new Date().toISOString()); if (r.created) { const chk = R.readStore(r.projStore); if (chk.rejects.length) { toast("⚠ Could not create the task: " + chk.rejects[0]); return true; } S.projStore = chk; saveStore(); toast("Created the next move in Projects. Projects owns its owner, due date and status from now on."); } return true; }
    return false;
  }
  function renameChoice(slug, loopId, choice) {
    const a = S.accStore && S.accStore.accounts.find(x => x.slug === slug), q = a && (a.pendingRenames || []).find(x => x.loopId === loopId); if (!q) return false;
    let r; try { r = A.resolveRename(a, S.projStore, q, choice, new Date().toISOString()); } catch (e) { toast("⚠ " + e.message); return false; }
    const chk = R.readStore(r.projStore); if (chk.rejects.length) { toast("⚠ Could not save the task: " + chk.rejects[0]); return false; }
    S.projStore = chk; a.loopRefs = Object.assign({}, a.loopRefs, { [loopId]: r.taskId }); a.pendingRenames = a.pendingRenames.filter(x => x !== q);
    S.accStore.updated_at = new Date().toISOString(); saveStore(); saveAccounts("accounts");
    if (q.kind === "recur") toast(choice === "same" ? "Same task: the completed task was reopened with the loop's new date." : "New task made for the repeated loop; the completed task is left as it is.");
    else toast(choice === "same" ? "Same task: the title was updated; the old title is kept in the task's notes." : "New task made; the old task is left as it is.");
    return true;
  }
  function accountsChange(e) {
    const t = e.target; if (!t || t.id !== "acc-tier") return false;
    S.accTier = t.value; render(); return true;
  }
  function useFeeds(feeds) {
    if (S.projDirty && canSaveToFolder() && S.projStore && !S.projExample) { S.projDirty = false; saveStore(); }   // edits made while locked are saved once unlocked
    if (S.snap && S.snap.example) return;
    if (feeds.calendar && (!S.calFeed || S.calExample || Date.parse(feeds.calendar.generated_at) >= Date.parse(S.calFeed.generatedAt))) { S.calFeed = R.readCalendar(feeds.calendar); S.calExample = false; track(DB.set("calendarSnap", feeds.calendar)); }
    if (feeds.projects && (!S.projFeed || S.projExample || Date.parse(feeds.projects.generated_at) >= Date.parse(S.projFeed.generatedAt))) { S.projFeed = R.readProjects(feeds.projects); S.projExample = false; track(DB.set("projectsFeed", feeds.projects)); }
    if (feeds.projstore && (!S.projStore || S.projExample || Date.parse(feeds.projstore.updated_at) > Date.parse(S.projStore.updated_at))) { S.projStore = R.readStore(feeds.projstore); S.projExample = false; track(DB.set("projectsStore", feeds.projstore)); }
    if (feeds.accstore && (!S.accStore || S.accExample || Date.parse(feeds.accstore.updated_at) > Date.parse(S.accStore.updated_at))) { S.accStore = A.readAccStore(feeds.accstore); S.accExample = false; track(DB.set("accountsStore", feeds.accstore)); }
    if (feeds.contacts && (!S.contacts || S.accExample || Date.parse(feeds.contacts.updated_at) > Date.parse(S.contacts.updated_at))) { S.contacts = A.readContacts(feeds.contacts); track(DB.set("contacts", feeds.contacts)); }
    if (feeds.trips && (!S.tripsFeed || Date.parse(feeds.trips.generated_at) >= Date.parse(S.tripsFeed.generatedAt))) { S.tripsFeed = R.readTrips(feeds.trips); track(DB.set("trips", feeds.trips)); }
  }
  function stripModel(f) {
    const evs = R.mergeEvents(S.calFeed ? S.calFeed.events : [], R.eventsFromSnapshot(S.snap));
    return R.todayStrip(evs, S.tripsFeed ? S.tripsFeed.trips : [], S.snap.items.filter(it => !f.ov.hidden.has(it.id)), S.today, f.nowIso, { rules: S.rules });
  }
  function calChip(f) {
    if (!S.calFeed) return `<span class="calchip none" role="status" title="No calendar feed yet; meetings come from the Inbox snapshot">📅 No calendar feed · meetings from the snapshot</span>`;
    const st = R.staleness(S.calFeed.generatedAt, f.nowIso), when = `${R.dayLabel(R.isoDay(S.calFeed.generatedAt))} ${hhmm24(S.calFeed.generatedAt)} ${R.tzLabel(S.calFeed.generatedAt)}`;
    const word = st.level === "red" ? "⚠ Calendar stale · " : st.level === "amber" ? "Calendar · " : "📅 Calendar ";
    return `<span class="calchip ${st.level}" role="status" title="Calendar feed, as of ${esc(when)}${st.level !== "ok" ? `; ${Math.floor(st.hours)} h old (the calendar writer's Outlook session may have expired)` : ""}">${word}as of ${esc(when)}</span>`;
  }
  const fmtH = h => { const H = Math.floor(h + 1e-9), M = Math.round((h - H) * 60); return `${String(H).padStart(2, "0")}:${String(M).padStart(2, "0")}`; };
  function stripHtml(f) {
    const m = stripModel(f); S.stripModel = m;
    const span = m.to - m.from, X = h => ((Math.min(Math.max(h, m.from), m.to) - m.from) / span * 100).toFixed(3) + "%", W = (a, b) => ((Math.min(b, m.to) - Math.max(a, m.from)) / span * 100).toFixed(3) + "%";
    const leave = m.leaveBy ? `<span class="calchip trav" title="Leave by time = flight − drive − 90 min airport buffer">✈ Travel today · leave by ${esc(hhmm24(m.leaveBy))}</span>` : "";
    const hotel = m.hotels.length ? `<span class="calchip">🏨 Tonight: ${esc(m.hotels[0].place || "hotel")}${m.hotels[0].cancelBy ? ` · cancel by ${esc(hhmm24(m.hotels[0].cancelBy))}` : ""}</span>` : "";
    const head = `<div class="stripbar"><span class="cap" id="strip-h">Today</span>${calChip(f)}${leave}${hotel}${m.allDay.length ? `<span class="calchip">All day: ${m.allDay.map(e => esc(e.title)).join(", ")}</span>` : ""}</div>`;
    if (!m.events.length && !m.travel.length) return `<section class="strip empty" aria-labelledby="strip-h">${head}<div class="none">No meetings or travel today${S.calFeed ? "" : " in the snapshot. When the calendar feed is set up, today's schedule shows here"}.</div></section>`;
    const hrs = []; for (let h = Math.ceil(m.from); h <= m.to; h++) hrs.push(`<span style="left:${X(h)}">${String(h).padStart(2, "0")}</span>`);
    const grid = hrs.map((_, i) => `<i style="left:${X(Math.ceil(m.from) + i)}"></i>`).join("");
    const evs = m.events.map(e => { const h = 100 / e.cols, lbl = `${fmtH(Math.max(e.s, 0))}–${fmtH(Math.min(e.e, 24))} ${e.title}${e.accountLabel ? ", " + e.accountLabel : ""}${e.kind === "hold" ? ", private hold" : ""}${e.conflict ? ", overlaps another meeting" : ""}`;
      return `<button class="sev k-${e.kind}${e.conflict ? " cf" : ""}" data-cal="${esc(e.id)}" style="left:${X(e.s)};width:${W(e.s, e.e)};top:${(e.col * h).toFixed(2)}%;height:${h.toFixed(2)}%" aria-label="${esc(lbl)}. Open details" title="${esc(lbl)}"><b>${esc(e.title)}</b><small>${fmtH(e.s)}</small></button>`; }).join("");
    const trav = m.travel.map(t => { const lbl = t.kind === "flight" ? `✈ ${fmtH(t.s)} ${t.from || ""}→${t.to || ""}${t.airline ? " " + t.airline + (t.number || "") : ""}` : t.kind === "drive" ? `drive ${t.driveMin != null ? t.driveMin + " min" : ""}${t.to ? " → " + t.to : ""}` : t.place || t.kind;
      return `<span class="stv" style="left:${X(t.s)};width:${W(t.s, t.e)}" title="${esc(t.trip)}: ${esc(lbl)}">${esc(lbl)}</span>`; }).join("");
    const mk = [];
    if (m.overdue.length) mk.push(`<span class="smk over" style="left:${X(m.from)}" title="${m.overdue.length} overdue To Do item(s)">▼ ${m.overdue.length}</span>`);
    if (m.dueToday.length) mk.push(`<span class="smk today" style="left:${X(17)}" title="${m.dueToday.length} To Do item(s) due today (end of day)">▼ ${m.dueToday.length}</span>`);
    const now = m.now != null && m.now >= m.from && m.now <= m.to ? `<span class="snow" style="left:${X(m.now)}" aria-hidden="true"></span>` : "";
    const sr = `${m.events.length} meeting${m.events.length === 1 ? "" : "s"} today${m.events.some(e => e.conflict) ? ", with overlaps" : ""}${m.leaveBy ? ", leave by " + hhmm24(m.leaveBy) + " for travel" : ""}${m.overdue.length ? `, ${m.overdue.length} overdue` : ""}${m.dueToday.length ? `, ${m.dueToday.length} due today` : ""}`;
    return `<section class="strip" aria-labelledby="strip-h" aria-describedby="strip-sr">${head}<p id="strip-sr" class="sr">${esc(sr)}. ${esc(fmtH(m.from))} to ${esc(fmtH(m.to))}.</p>
      <div class="stl"><div class="shrs" aria-hidden="true">${hrs.join("")}</div><div class="sgrid" aria-hidden="true">${grid}</div>${now}${mk.join("")}
      <div class="sevs" role="list" aria-label="Meetings today">${evs.replace(/<button /g, '<button role="listitem" ')}</div><div class="strav" aria-label="Travel today">${trav}</div></div>
      <div class="slegend" aria-hidden="true"><span class="lg k-client">client</span><span class="lg k-internal">internal</span><span class="lg k-hold">private hold</span><span class="lg cf">overlap</span><span class="lg tv">travel</span><span>▼ red overdue · ▼ green due today</span></div></section>`;
  }
  function openPrep(id, from) {
    closePrep(); const m = S.stripModel, e = m && m.events.concat(m.allDay).find(x => x.id === id); if (!e) return;
    const todos = e.linkedTodoIds.map(t => S.snap.items.find(it => it.id === t)).filter(Boolean);
    const loops = e.accountLabel ? S.snap.items.filter(it => R.isOpen(it) && it.account === e.accountLabel && !e.linkedTodoIds.includes(it.id)).slice(0, 4) : [];
    const doms = e.attendeeDomains.length ? `${e.attendeeCount} · ${e.attendeeDomains.map(esc).join(", ")}` : (e.attendeeCount ? String(e.attendeeCount) : "just you");
    const itin = (m.travel || []).concat(m.hotels || []).sort((a, b) => a.start < b.start ? -1 : 1).map(t => `<li><span class="mono">${esc(hhmm24(t.start))}</span> <b>${esc(t.kind.toUpperCase())}</b> ${esc(t.kind === "flight" ? `${t.from || ""} → ${t.to || ""}${t.airline ? " · " + t.airline + (t.number || "") : ""} · lands ${hhmm24(t.end)}${t.leaveBy ? " · leave by " + hhmm24(t.leaveBy) : ""}` : t.kind === "drive" ? `${t.from || ""} → ${t.to || ""}${t.driveMin != null ? " · " + t.driveMin + " min" : ""}` : t.kind === "hotel" ? `${t.place || "hotel"}${t.cancelBy ? " · cancel by " + hhmm24(t.cancelBy) : ""}` : t.place || "")}${t.mapUrl ? ` <a href="${esc(t.mapUrl)}" target="_blank" rel="noopener noreferrer">map ↗</a>` : ""}</li>`).join("");
    const row = it => `<li>${esc(it.title)}${it.due ? ` <span class="${it.due < S.today ? "c-over" : "muted"}">(${it.due < S.today ? R.diffDays(S.today, it.due) + "d late" : esc(R.dayLabel(it.due))})</span>` : ""}</li>`;
    const d = document.createElement("div"); d.id = "prep"; d.className = "prep";
    d.innerHTML = `<div class="prepcard" role="dialog" aria-modal="false" aria-labelledby="prep-h" tabindex="-1">
      <div class="cap k-${e.kind}">${e.kind === "client" ? "Client meeting" : e.kind === "hold" ? "Private hold" : "Internal"} · ${e.allDay ? "all day" : `${fmtH(e.s)}–${fmtH(e.e)} ${esc(R.tzLabel(e.start))}`}${e.conflict ? ' · <span class="c-over">overlaps</span>' : ""}</div>
      <h2 id="prep-h">${esc(e.title)}</h2>
      <dl class="kv"><dt>Where</dt><dd>${esc(e.location || "—")}</dd>${e.teamsUrl ? `<dt>Join</dt><dd><a href="${esc(e.teamsUrl)}" target="_blank" rel="noopener noreferrer">Teams link ↗</a></dd>` : ""}
      <dt>Attendees</dt><dd class="mono">${doms}</dd>${e.organizerDomain ? `<dt>Organizer</dt><dd class="mono">${esc(e.organizerDomain)}</dd>` : ""}
      <dt>Account</dt><dd>${esc(e.accountLabel || "—")}</dd>${e.bodyExcerpt ? `<dt>Notes</dt><dd>${esc(e.bodyExcerpt)}</dd>` : ""}
      ${todos.length ? `<dt>Linked To Do</dt><dd><ul>${todos.map(row).join("")}</ul></dd>` : ""}${loops.length ? `<dt>Open loops</dt><dd><ul>${loops.map(row).join("")}</ul></dd>` : ""}</dl>
      ${itin ? `<div class="cap">Itinerary today</div><ul class="itin">${itin}</ul>` : ""}
      <div class="vbtns"><button class="btn" id="prep-x">Close</button></div></div>`;
    document.body.appendChild(d); S.prepFrom = from || null;
    const card = d.querySelector(".prepcard"); card.focus();
    d.querySelector("#prep-x").onclick = closePrep;
    d.addEventListener("keydown", ev => { if (ev.key === "Escape") { ev.stopPropagation(); closePrep(); } });
  }
  function closePrep() { const d = $("#prep"); if (!d) return; d.remove(); const id = S.prepFrom; S.prepFrom = null; if (id) { const b = document.querySelector(`[data-cal="${CSS.escape(id)}"]`); if (b) b.focus(); } }
  function focusModel() {
    const nowIso = nowDate().toISOString(), ov = R.overlays(S.flags, S.snap, nowIso);
    const f = R.focusSections(S.snap, { today: S.today, nowIso, timeEntries: S.entries }, ov, { cap: CFG.focusRowCap || 12, expanded: S.focusExp, history: S.history });
    return Object.assign(f, { ov, nowIso });
  }
  const md = d => { const [, m, dd] = d.split("-").map(Number); return `${m}/${dd}`; };
  const hhmm24 = iso => { const h = R.hourCT(iso), H = Math.floor(h + 1e-9), M = Math.round((h - H) * 60); return `${String(H).padStart(2, "0")}:${String(M).padStart(2, "0")}`; };
  const noDatePill = '<span class="nodate">⚠ no date</span>';
  function whenText(r) {
    const w = r.when || {};
    if (w.kind === "today") return "Today";
    if (w.kind === "late") return `${w.days}d late`;
    if (w.kind === "was") return `was ${md(w.day)}`;
    if (w.kind === "day") return esc(R.dayLabel(w.day));
    if (w.kind === "nodate") return `— ${noDatePill}`;
    if (w.kind === "notouch") return `<span class="muted">no touch set</span>${w.nodate ? " " + noDatePill : ""}`;
    return "";
  }
  function keyChip(name) { if (!name) return ""; const on = isStarred(name);
    return on ? `<button class="key" data-star="${esc(name)}" aria-pressed="true" aria-label="Key account ${esc(name)}: unstar" title="Key account (click to unstar)">★ Key</button>`
      : `<button class="star" data-star="${esc(name)}" aria-pressed="false" aria-label="Star ${esc(name)} as a key account" title="Star as a key account">☆</button>`; }
  function focusRow(r, i, anim) {
    const st = ST[r.status] || ST.week, task = r.it ? r.it.id : "";
    let act = esc(r.title);
    if (r.status === "cold") act += ` — ${r.coldDays === null ? "no touch on record" : r.coldDays + "d since last"}`;
    if (r.reopened) act += ' <span class="note">reopened in To Do</span>';
    if (r.it && r.it.withhold) act += ' <span class="wchip" title="Tagged Withhold in To Do: never on the Manager sheet">⊘ Withheld</span>';
    if (r.snoozedUntil) act += ` <span class="note">snoozed to ${esc(R.dayLabel(R.isoDay(r.snoozedUntil)))} ${hhmm24(r.snoozedUntil)}</span>`;
    const lbl = esc(r.title), dis = task ? "" : ` disabled title="Not a To Do task"`;
    return `<div class="frow${anim ? " anim" : ""}" role="listitem" tabindex="0" data-row="${esc(r.id)}" data-task="${esc(task)}" data-acct="${esc(r.account || "")}" data-person="${esc(r.person || "")}"${anim && !reducedMotion() ? ` style="animation-delay:${Math.min(i, 20) * 30}ms"` : ""} aria-label="${esc(st[0])}: ${lbl}${r.account ? ", " + esc(r.account) : ""}">
      <span class="st c-${st[2]}">${icon(st[1])} ${st[0]}</span>
      <span class="acct">${r.account ? `<span class="an">${esc(r.account)}</span> ${keyChip(r.account)}` : '<span class="muted">—</span>'}</span>
      <span class="per">${esc(r.person || "—")}</span>
      <span class="act">${act}</span>
      <span class="nx">${whenText(r)}</span>
      <span class="btns"><button data-fdone="${esc(task)}" aria-label="Done: ${lbl}"${dis}>✓ Done</button><button data-fsnooze="${esc(task)}" aria-haspopup="menu" aria-expanded="false" aria-label="Snooze: ${lbl}"${dis}>Snooze</button><button data-ftouch="${esc(r.id)}" aria-label="Log touch: ${lbl}">Log touch</button></span></div>`;
  }
  // 00.05.003 Today's Clear bar (Option A). Baseline = scope of the first snapshot seen today on this computer.
  function clearModel(f) {
    const base = S.clearBase && S.clearBase.day === S.today ? S.clearBase.ids : null;
    const c = R.todaysClear(S.snap, S.today, f.ov, base);
    // Never take the baseline from EXAMPLE DATA (B1): it would make every real item "added" after unlock.
    if (!base && !(S.snap && S.snap.example)) { S.clearBase = { day: S.today, ids: c.ids }; track(DB.set("clearBase", S.clearBase)); }
    return c;
  }
  function clearBar(f) {
    const c = clearModel(f); S.clearModel = c;
    if (!c.total) return `<div class="tclear empty" role="status"><span class="cap">Today's clear</span> <span class="muted">Nothing due today or overdue.</span></div>`;
    const seg = (cls, n) => n ? `<i class="seg ${cls}" style="flex:${n}"></i>` : "";
    const ticks = c.ticks.length <= 40 ? `<div class="ticks" aria-hidden="true">${c.ticks.map(t => `<i class="tk ${t.state}"></i>`).join("")}</div>` : "";
    const note = [c.snoozed ? `${c.snoozed} snoozed (not counted)` : "", c.added ? `+${c.added} added today` : "", c.overdueOpen ? `${c.overdueOpen} overdue open` : ""].filter(Boolean).join(" · ");
    return `<div class="tclear${c.done === c.total ? " all" : ""}"><div class="pbh"><span class="cap" id="tclear-l">Today's clear</span><b class="mono pct">${c.done} of ${c.total} · ${c.pct}%</b></div>
      <div class="track" role="progressbar" aria-labelledby="tclear-l" aria-valuemin="0" aria-valuemax="${c.total}" aria-valuenow="${c.done}" aria-valuetext="${esc(c.text)}" title="${esc(c.text)}. Counts what's due today and overdue (not Waiting on) since the first snapshot today; Done in To Do or here fills it, Snooze never does.">${seg("done", c.done)}${seg("snzd", c.snoozed)}${seg("left", c.total - c.done - c.snoozed)}</div>
      ${ticks}${note ? `<div class="pnote mono">${esc(note)}</div>` : ""}</div>`;
  }
  function renderFocus() {
    const el = $("#view-focus"); if (!el) return;
    const f = focusModel(), anim = !S.focusAnimated; S.focusModel = f;
    const c = f.counts, d = f.delta;
    // Delta tooltip / accessible name: counted against the last snapshot of the previous business day, using the Totals
    // definition of Due Today (includes Waiting on items due today; local Done marks don't change it).
    const deltaTip = d ? `${d.delta === 0 ? "Same number" : `${Math.abs(d.delta)} ${d.delta > 0 ? "more" : "fewer"}`} due today than in the last snapshot of the previous business day (${R.dayLabel(d.basisDay)}). Counted with the Totals definition of Due Today, which includes Waiting items due today.` : "";
    const sq = (key, cls, lab, ic, n, extra, aria) => `<div class="tw"><span class="sqlab l-${cls}" id="lab-${key}">${icon(ic)} ${lab}</span>
      <button class="sq t-${cls}" data-sq="${key}" aria-label="${aria}"><b>${n}</b>${extra || ""}</button></div>`;
    const doneNote = f.doneDueToday ? `; ${f.doneDueToday} marked done here` : "";
    const squares = sq("dueToday", "today", "Due Today", "i-today", c.dueToday, d ? `<em class="delta" role="img" title="${esc(deltaTip)}" aria-label="${d.delta > 0 ? "Up " + d.delta : d.delta < 0 ? "Down " + -d.delta : "No change"}: ${esc(deltaTip)}">${esc(d.text)}</em>` : "",
        `Due Today, ${c.dueToday} item${c.dueToday === 1 ? "" : "s"}${doneNote}${d ? ". " + deltaTip.replace(/\.$/, "") : ""}. Go to section`)
      + sq("overdue", "over", "Overdue", "i-over", c.overdue, "", `Overdue, ${c.overdue} item${c.overdue === 1 ? "" : "s"}. Go to section`)
      + sq("waiting", "wait", "Waiting past due", "i-wait", c.waiting, "", `Waiting past due, ${c.waiting} item${c.waiting === 1 ? "" : "s"}. Go to section`)
      + sq("cold", "cold", "Going cold", "i-cold", c.cold, "", `Going cold, ${c.cold} key account${c.cold === 1 ? "" : "s"}. Go to section`);
    const now = new Date(f.nowIso), evs = R.withConflicts(S.snap.calendar).filter(e => e.day === S.today && new Date(e.end) > now).sort((a, b) => a.start < b.start ? -1 : 1);
    const meet = evs.slice(0, 4).map(e => `<div class="mt${e.conflict ? " cf" : ""}"><span class="t">${hhmm24(e.start)}</span><span class="ma">${esc(e.account || "—")}</span><small>${esc(e.title)}${e.conflict ? " ⚠" : ""} · <button class="lnk" data-prep="${esc(e.id)}" aria-label="Prep for ${esc(e.title)}">prep ↗</button></small></div>`).join("")
      || '<div class="mt empty"><small>No more meetings today.</small></div>';
    const asof = `As of ${R.dayLabel(R.isoDay(S.snap.generatedAt))} · ${hhmm24(S.snap.generatedAt)} ${esc(R.tzLabel(S.snap.generatedAt))}`;
    const header = `<header class="fhead"><div class="fleft"><div class="tiles4" role="group" aria-label="Today at a glance">${squares}</div>${clearBar(f)}</div>
      <div class="side"><div class="ttl"><h1>Daily Focus</h1><div class="asof${isStale() ? " stale" : ""}" title="${isStale() ? esc(staleState().tip) : "Time the snapshot was made (Central Time)."}">${isStale() ? esc(staleState().txt) : ""}${esc(asof)}${S.snap.example ? ' · <span class="exd">EXAMPLE DATA</span>' : ""}</div></div>
        ${f.doneHere ? `<div class="donehere" role="status">${f.doneHere} done here, not yet in To Do <span class="muted">· mark ${f.doneHere === 1 ? "it" : "them"} done in To Do</span></div>` : ""}
        <div class="meet" aria-label="Meetings today">${meet}${evs.length > 4 ? `<button class="lnk mmore" data-meetmore>+${evs.length - 4} more</button>` : ""}</div></div></header>`;
    let i = 0;
    const sections = f.sections.map(x => {
      const [title, cls] = SEC[x.key], hero = x.key === "dueToday";
      const rows = x.rows.map(r => focusRow(r, i++, anim)).join("");
      return `<section class="blk b-${cls}${hero ? " hero" : ""}" id="fs-${x.key}" aria-labelledby="fh-${x.key}"><h2 class="sh" id="fh-${x.key}" tabindex="-1">${title} <span class="badge" aria-label="${x.total} item${x.total === 1 ? "" : "s"}">${x.total}</span>${hero && d ? ` <span class="delta" aria-hidden="true" title="${esc(deltaTip)}">${esc(d.text)}</span>` : ""}</h2>
        ${x.total ? `<div role="list">${rows}</div>` : `<div class="none">${EMPTY[x.key]}</div>`}
        ${x.more > 0 ? `<button class="lnk more" data-fmore="${x.key}" aria-label="Show ${x.more} more in ${title}">+${x.more} more</button>` : ""}${S.focusExp.has(x.key) && x.total > 1 ? `<button class="lnk more" data-fless="${x.key}">show fewer</button>` : ""}</section>`;
    }).join("");
    const later = `<div class="later"><button class="lnk" data-later aria-expanded="${S.laterOpen}" aria-controls="later-list">${S.laterOpen ? "▾" : "▸"} Later this week · ${f.later.length} item${f.later.length === 1 ? "" : "s"}</button>
      ${S.laterOpen ? `<div id="later-list" role="list">${f.later.map(r => focusRow(r, 0, false)).join("") || '<div class="none">Nothing else this week.</div>'}</div>` : ""}</div>`;
    const nd = f.noDate.length ? `<div class="later"><button class="lnk" data-nodate aria-expanded="${S.noDateOpen}">${f.noDate.length} open item${f.noDate.length === 1 ? " has" : "s have"} no date → ${S.noDateOpen ? "hide" : "show"}</button>
      ${S.noDateOpen ? `<div role="list">${f.noDate.map(it => focusRow({ it, id: it.id, status: it.list === "Waiting on" ? "waiting" : "week", account: it.account, person: it.person, title: it.title, when: { kind: "nodate" } }, 0, false)).join("")}</div>` : ""}</div>` : "";
    const t1 = S.snap.accounts.filter(a => a.tier === "T1"), offer = !(S.flags["setting:t1offer"] && S.flags["setting:t1offer"].on) && t1.length && !S.snap.accounts.some(a => isStarred(a.name));
    const offerHtml = offer ? `<div class="t1offer" role="dialog" aria-labelledby="t1o-h" aria-describedby="t1o-p"><h2 id="t1o-h" class="sh">Star your T1 accounts as key accounts?</h2>
      <p id="t1o-p" class="muted">Key accounts drive <b>Going cold · key</b>. Untick any you don't want; you can change this any time with ☆/★ or File → Key accounts &amp; internal people….</p>
      <div class="t1list">${t1.map(a => `<label><input type="checkbox" data-t1="${esc(a.name)}" checked> ${esc(a.name)}</label>`).join("")}</div>
      <div class="vbtns"><button class="btn" id="t1o-no">Not now</button><button class="btn primary" id="t1o-yes">Star selected</button></div></div>` : "";
    const foc = document.activeElement && document.activeElement.closest && document.activeElement.closest(".frow"), keep = foc ? foc.dataset.row : null;
    el.innerHTML = header + pinnedHtml("focus") + accFocusHtml() + stripHtml(f) + offerHtml + sections + later + nd + `<div class="ffoot muted">Rows: ${f.sections.reduce((a, x) => a + x.rows.length, 0)} of ${f.sections.reduce((a, x) => a + x.total, 0)} (cap ${f.cap}) · keys: j/k move · d Done · s Snooze · t Log touch · Rev ${REV}</div>`;
    if (S.snap) S.focusAnimated = true;
    if (keep) { const r = el.querySelector(`.frow[data-row="${CSS.escape(keep)}"]`); if (r) r.focus(); }
  }
  function undoToast(msg, undo) {
    const t = $("#undo"); t.innerHTML = `<span>${esc(msg)}</span> <button class="btn" id="undo-btn">Undo</button>`; t.classList.remove("hidden");
    clearTimeout(undoToast.h); undoToast.h = setTimeout(() => t.classList.add("hidden"), 8000);
    $("#undo-btn").onclick = () => { clearTimeout(undoToast.h); t.classList.add("hidden"); undo(); };
  }
  function focusDone(id) {
    const it = S.snap.items.find(x => x.id === id); if (!it) return;
    const fid = "done:" + id, prev = S.flags[fid];
    setFlag(fid, { on: true, at: nowDate().toISOString(), snapAt: S.snap.generatedAt }); render();
    undoToast(`Marked done here: "${it.title}". Remember to tick it off in To Do.`, () => { setFlag(fid, Object.assign({}, S.flags[fid] || prev || {}, { on: false })); render(); });
  }
  function focusSnooze(id, choice, picked) {
    const it = S.snap.items.find(x => x.id === id); if (!it) return;
    const until = R.snoozeUntil(choice, nowDate().toISOString(), picked); if (!until) { toast("Pick a valid date."); return; }
    const fid = "snooze:" + id; setFlag(fid, { on: true, until, due: it.due || null }); render();
    undoToast(`Snoozed "${it.title}" until ${R.dayLabel(R.isoDay(until))} ${hhmm24(until)} ${R.tzLabel(until)}.`, () => { setFlag(fid, Object.assign({}, S.flags[fid], { on: false })); render(); });
  }
  function closeSnooze(refocus) { const m = $("#snz"); if (!m) return; const b = document.querySelector(`[data-fsnooze="${CSS.escape(m.dataset.task)}"]`); m.remove(); if (b) { b.setAttribute("aria-expanded", "false"); if (refocus) b.focus(); } }
  function openSnooze(btn) {
    closeSnooze(); closePop();
    const id = btn.dataset.fsnooze, m = document.createElement("div"); m.id = "snz"; m.className = "snz"; m.setAttribute("role", "menu"); m.setAttribute("aria-label", "Snooze until"); m.dataset.task = id;
    m.innerHTML = `<button role="menuitem" data-snz="later">Later today (+3 h)</button><button role="menuitem" data-snz="tomorrow">Tomorrow 8:00</button><button role="menuitem" data-snz="monday">Next Monday 8:00</button><button role="menuitem" data-snz="date">Pick date…</button>
      <div class="snzdate hidden"><input type="date" id="snz-date" aria-label="Snooze until date" min="${R.addDays(S.today, 1)}"><button class="btn primary" id="snz-ok">Snooze</button></div>`;
    document.body.appendChild(m); btn.setAttribute("aria-expanded", "true");
    const rc = btn.getBoundingClientRect(); m.style.left = Math.min(rc.left, innerWidth - 220) + "px"; m.style.top = (rc.bottom + 4 + 170 > innerHeight ? Math.max(8, rc.top - 174) : rc.bottom + 4) + "px";
    const items = [...m.querySelectorAll("[role=menuitem]")]; items[0].focus();
    m.addEventListener("keydown", e => {
      const k = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(k + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus(); }
      if (e.key === "Home") { e.preventDefault(); items[0].focus(); } if (e.key === "End") { e.preventDefault(); items[items.length - 1].focus(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeSnooze(true); }
      if (e.key === "Tab") closeSnooze();
    });
    m.addEventListener("click", e => { e.stopPropagation(); const b = e.target.closest("[data-snz]");
      if (b && b.dataset.snz === "date") { m.querySelector(".snzdate").classList.remove("hidden"); $("#snz-date").focus(); return; }
      if (b) { closeSnooze(); focusSnooze(id, b.dataset.snz); return; }
      if (e.target.id === "snz-ok") { const v = $("#snz-date").value; closeSnooze(); focusSnooze(id, "date", v); } });
  }
  function focusTouch(btn) {
    const row = btn.closest(".frow"), acct = row.dataset.acct || null, person = row.dataset.person || "";
    const acc = acct && S.snap.accounts.find(a => a.name === acct), aud = acc && acc.domains.length ? R.guessAudience(acc.domains, S.rules).value : "Owner/operator";
    logCall(btn, { title: "Log touch", sub: `${acct || "No account"}${person ? " · " + person : ""} · counts as a touch for Going cold`, account: acct, note: person, audience: aud, ok: "Log touch" });
  }
  function goSection(key) {
    const h = document.getElementById("fh-" + key); if (!h) return;
    h.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" }); h.focus({ preventScroll: true });
  }
  function focusClick(e) {
    const t = e.target;
    if (!t.closest("#snz") && $("#snz") && !t.closest("[data-fsnooze]")) closeSnooze();
    const st = t.closest("[data-star]"); if (st) { const n = st.dataset.star; setFlag("star:" + n, { on: !isStarred(n) }); render(); toast(`${isStarred(n) ? "★ Key account: " : "Unstarred: "}${n}`); return true; }
    if (!t.closest("#view-focus")) return false;
    const sq = t.closest("[data-sq]"); if (sq) { goSection(sq.dataset.sq); return true; }
    const dn = t.closest("[data-fdone]"); if (dn) { focusDone(dn.dataset.fdone); return true; }
    const sz = t.closest("[data-fsnooze]"); if (sz) { if ($("#snz") && $("#snz").dataset.task === sz.dataset.fsnooze) closeSnooze(); else openSnooze(sz); return true; }
    const tc = t.closest("[data-ftouch]"); if (tc) { focusTouch(tc); return true; }
    const mo = t.closest("[data-fmore]"); if (mo) { S.focusExp.add(mo.dataset.fmore); render(); return true; }
    const le = t.closest("[data-fless]"); if (le) { S.focusExp.delete(le.dataset.fless); render(); return true; }
    if (t.closest("[data-later]")) { S.laterOpen = !S.laterOpen; render(); return true; }
    if (t.closest("[data-nodate]")) { S.noDateOpen = !S.noDateOpen; render(); return true; }
    if (t.closest("[data-meetmore]")) { setView("workload"); return true; }
    const cv = t.closest("[data-cal]"); if (cv) { openPrep(cv.dataset.cal, cv.dataset.cal); return true; }
    const pr = t.closest("[data-prep]"); if (pr) { const ent = S.entries.find(x => x.eventId === pr.dataset.prep);
      if (ent) editCalendarEntry(pr, ent); else { setView("dashboard"); const c = $("#cal"); if (c) c.scrollIntoView({ block: "start" }); } return true; }
    if (t.id === "t1o-yes" || t.id === "t1o-no") { const pick = t.id === "t1o-yes" ? [...document.querySelectorAll("[data-t1]")].filter(x => x.checked).map(x => x.dataset.t1) : [];
      const nf = Object.assign({}, S.flags, { "setting:t1offer": { on: true } }); pick.forEach(n => nf["star:" + n] = { on: true }); S.flags = nf; commit(); render();
      toast(pick.length ? `Starred ${pick.length} key account${pick.length === 1 ? "" : "s"}.` : "No accounts starred. Use ☆ on any account to star it."); return true; }
    return false;
  }
  // Keyboard (Q14): j/k move between rows, d/s/t = Done / Snooze / Log touch on the focused row. Off while typing or in a dialog.
  function focusKeys(e) {
    if (S.view !== "focus" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    const a = document.activeElement; if (a && (a.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName))) return;
    if ($("#pop") || $("#snz") || document.querySelector(".overlay.open")) return;
    const k = e.key; if (!["j", "k", "d", "s", "t"].includes(k)) return;
    const rows = [...document.querySelectorAll("#view-focus .frow")]; if (!rows.length) return;
    const cur = a && a.closest ? a.closest(".frow") : null;
    if (k === "j" || k === "k") { e.preventDefault(); const i = rows.indexOf(cur); const n = cur ? Math.max(0, Math.min(rows.length - 1, i + (k === "j" ? 1 : -1))) : (k === "j" ? 0 : rows.length - 1); rows[n].focus(); rows[n].scrollIntoView({ block: "nearest" }); return; }
    if (!cur) return; e.preventDefault();
    const b = cur.querySelector(k === "d" ? "[data-fdone]" : k === "s" ? "[data-fsnooze]" : "[data-ftouch]"); if (b && !b.disabled) b.click();
    if (k === "d") { const r2 = [...document.querySelectorAll("#view-focus .frow")]; const n = r2[Math.min(rows.indexOf(cur), r2.length - 1)]; if (n) n.focus(); }
  }
  function keyAccountsDialog() {
    if (!S.snap) return;
    const people = [...new Set(S.snap.items.map(i => i.person).filter(p => p && p.toLowerCase() !== "me"))].sort();
    const isInt = p => !!(S.flags["internal:" + p.toLowerCase()] && S.flags["internal:" + p.toLowerCase()].on);
    dialog("keydlg", `<b class="vt">Key accounts &amp; internal people</b>
      <p class="faint">★ Key accounts feed <b>Going cold · key</b>. People ticked as internal (your colleagues) don't count as <b>Owed to outside</b> unless the task has an account. Both are saved encrypted and synced like your time.</p>
      <div class="kcols"><fieldset><legend>Key accounts</legend>${S.snap.accounts.map(a => `<label><input type="checkbox" data-ka="${esc(a.name)}"${isStarred(a.name) ? " checked" : ""}> ${esc(a.name)}${a.tier === "T1" ? ' <span class="faint">T1</span>' : ""}</label>`).join("")}</fieldset>
      <fieldset><legend>Internal people</legend>${people.map(p => `<label><input type="checkbox" data-ip="${esc(p)}"${isInt(p) ? " checked" : ""}> ${esc(p)}</label>`).join("") || '<span class="faint">No people in this snapshot.</span>'}</fieldset></div>
      <div class="vbtns"><button class="btn" id="ka-cancel">Cancel</button><button class="btn primary" id="ka-ok">Save</button></div>`,
    (d, done) => {
      d.querySelector("#ka-cancel").onclick = () => done(null);
      d.querySelector("#ka-ok").onclick = () => { const nf = Object.assign({}, S.flags);
        d.querySelectorAll("[data-ka]").forEach(x => { const id = "star:" + x.dataset.ka; if (x.checked !== isStarred(x.dataset.ka)) nf[id] = { on: x.checked }; });
        d.querySelectorAll("[data-ip]").forEach(x => { const id = "internal:" + x.dataset.ip.toLowerCase(); if (x.checked !== isInt(x.dataset.ip)) nf[id] = { on: x.checked }; });
        nf["setting:t1offer"] = { on: true }; S.flags = nf; commit(); done(true); render(); toast("Key accounts and internal people saved."); };
      d.addEventListener("keydown", e => { if (e.key === "Escape") done(null); });
    });
  }

  // ---------- print sheets ----------
  function sheet(manager) {
    const c = ctx(); let items = S.snap.items.filter(R.isOpen); if (manager) items = R.managerItems(items);
    const t = R.totals(items, c), ser = manager ? [] : series(), sun = R.sundayOf(S.today);
    const line = it => esc(R.formatLine(it, 64));
    const st = it => { const w = R.statusWord(it, S.today); return `<span class="st${w === "Overdue" ? " ov" : ""}">${w}</span>`; };
    const wmark = it => !manager && it.withhold ? ' <span class="wh">[WITHHELD]</span>' : "";
    const rows = (arr, box) => arr.sort(R.sortItems).map(it => `<tr>${box ? '<td style="width:14px"><span class="box"></span></td>' : ""}<td>${line(it)}${wmark(it)}</td><td>${esc(it.account || "")}</td><td>${st(it)}</td></tr>`).join("");
    const cap = (arr, n) => arr.length > n ? arr.slice(0, n) : arr, more = (arr, n) => arr.length > n ? `<div class="more">+${arr.length - n} more on screen</div>` : "";
    const iOwe = items.filter(it => R.inTotal(it, "iOwe", c) && it.due && it.due <= sun);
    const owed = items.filter(it => it.list === "Waiting on"), touch = items.filter(it => it.list === "Account touches" && !(it.due && it.due <= sun)), trav = items.filter(it => it.list === "Travel");
    const keys = manager ? R.TOTAL_KEYS.filter(k => k !== "goingCold") : R.TOTAL_KEYS;
    const tl = k => { const w = R.wow(ser, k), tone = R.wowTone(k, w.delta); return `<div class="tl${tone === "bad" ? " bad" : ""}"><div class="k">${LABEL[k]}</div><div class="n">${t[k]}</div><div class="d">${manager ? "" : esc(w.text)}</div></div>`; };
    const evs = R.withConflicts(S.snap.calendar).filter(e => e.day === S.today || e.day === R.addDays(S.today, 1));
    const wl = R.workload(S.entries, R.addDays(R.mondayOf(S.today), -7));
    const wlLine = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, m]) => `${esc(k)} ${(m / 60).toFixed(2)}`).join(" · ");
    return `<div class="page"><div class="hd"><div><div style="font-size:15pt;font-weight:800">Activity Dashboard — ${manager ? "Shared with Manager" : "Weekly Sheet — Mine"} — Week of ${R.dayLabel(R.mondayOf(S.today))}</div>
      ${manager ? '<div class="sanit">SANITIZED FOR MANAGER — no pricing, bid details or confidential details</div>' : ""}</div>
      <div style="text-align:right;font-size:8.5pt">${esc(asOfText())}${isStale() ? " · ⚠ STALE" : ""}<br>Week ending ${R.dayLabel(sun)} · Rev ${REV}${S.snap.example ? " · EXAMPLE DATA" : ""}</div></div>
      <div style="padding:8px 22px;display:flex;flex-direction:column;gap:7px;flex:1;min-height:0">
      <div style="display:grid;grid-template-columns:repeat(${keys.length},1fr);gap:4px">${keys.map(tl).join("")}</div>
      ${manager ? "" : `<div><h2>Calendar · today &amp; tomorrow</h2><div style="columns:2;font-size:8pt">${evs.map(e => `<div>${R.dayLabel(e.day)} <span class="mono">${R.hm(e.start)}–${R.hm(e.end)}</span> ${esc(e.title)} ${e.conflict ? '<span class="cf">CONFLICT</span>' : ""}</div>`).join("") || "Nothing scheduled."}</div></div>`}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;flex:1;min-height:0">
        <div><h2>I Owe · due through ${R.dayLabel(sun)}</h2><table><tr><th></th><th>Item</th><th>Account</th><th>Status</th></tr>${rows(cap(iOwe, 12), true)}</table>${more(iOwe, 12)}
          <div style="margin-top:6px"><h2>Travel</h2><table>${rows(cap(trav, 3), true)}</table></div></div>
        <div><h2>Owed to Me</h2><table><tr><th></th><th>Item</th><th>Account</th><th>Status</th></tr>${rows(cap(owed, 7), true)}</table>${more(owed, 7)}
          <div style="margin-top:6px"><h2>Account touches · later</h2><table>${rows(cap(touch, 5), true)}</table>${more(touch, 5)}</div></div></div>
      <div style="display:grid;grid-template-columns:${manager ? "1fr" : "2fr 1fr"};gap:16px">
        <div><h2>New today</h2><div class="rule"></div><div class="rule"></div><div class="rule"></div></div>
        ${manager ? "" : `<div class="sbox"><h2 style="border:0;margin:0">Hours last week · ${(wl.totalMin / 60).toFixed(2)} h</h2><div style="font-size:7.5pt">${wlLine(wl.byAudience) || "No confirmed time."}</div></div>`}</div>
      </div></div>`;
  }
  function doPrint(which) { S.view = which; render(); document.querySelectorAll(".view").forEach(v => v.classList.toggle("printing", v.id === "view-" + which)); setTimeout(() => window.print(), 50); }
  const printTarget = () => S.view === "manager" ? "manager" : S.view === "focus" ? "focus" : S.view === "projects" ? "projects" : S.view === "accounts" ? "accounts" : "print";   // 00.05: Ctrl+P on Daily Focus prints Daily Focus

  // ---------- help ----------
  function openHelp(sec) {
    $("#help").classList.add("open"); const el = document.getElementById("help-" + sec);
    const hb = document.querySelector(".helpbody"); $("#help-close").focus(); if (el) hb.scrollTop = el.offsetTop - 8;
  }
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add("hidden"), 3500); }

  // ---------- files ----------
  function pickFile(accept, cb) { const i = document.createElement("input"); i.type = "file"; i.accept = accept; i.onchange = () => { const f = i.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => cb(f.name, String(r.result)); r.readAsText(f); }; i.click(); }
  function parseSnapshotText(name, text) {
    if (/\.csv$/i.test(name)) return R.snapshotFromCSV(text);
    const m = text.match(/window\.[A-Z][A-Z0-9_]*SNAPSHOT\s*=\s*([\s\S]*?);?\s*$/); return JSON.parse(m ? m[1] : text);   // 00.03: older snapshot.js variable names too
  }
  function download(name, obj, text) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text != null ? text : JSON.stringify(obj, null, 1)], { type: "application/json" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  const ACTIONS = {
    open: () => pickFile(".js,.json,.csv", async (n, t) => { let raw; try { raw = parseSnapshotText(n, t); } catch (e) { banner("Could not read " + n + ": " + e.message, true); return; }
      if (await useSnapshot(raw, "opened file")) { await DB.set("openedSnapshot", raw); toast("Opened " + n); } }),
    export: async () => { if (S.vault.kr && !confirm("This saves your local data unencrypted (plain JSON) to Downloads. Continue?")) return; download(`dash-local-data-${S.today}.json`, await DB.exportAll()); },
    import: () => pickFile(".json", async (n, t) => { try { const r = await DB.importAll(JSON.parse(t)); toast(`Imported local data${r && r.dropped ? ` (${r.dropped} event(s) from other machines ignored)` : ""}. Reloading…`); setTimeout(reloadSafely, 600); } catch (e) { banner("Import failed: " + e.message, true); } }),
    clear: () => clearDialog(),
    exportCSV: () => { if (S.vault.kr && !confirm("This saves your time entries unencrypted (CSV) to Downloads. Continue?")) return; const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([R.timeEntriesCSV(S.entries)], { type: "text/csv" })); a.download = `dash-time-entries-${S.today}.csv`; a.click(); toast(`Exported ${S.entries.length} time entries (CSV).`); },
    repairClock: () => repairClock(), encryption: () => encryptionDialog(), install: () => installApp(),
    connect: () => connectFolder(), syncNow: () => syncNow(true), hub: () => hubDialog(),
    saveTimeFile: () => { if (S.vault.kr && !confirm("This saves your time file unencrypted (plain JSON) to Downloads. Continue?")) return;  download(R2.fileName(S.machine), null, R2.serialize(S.machine, S.own, new Date().toISOString())); toast(`Saved ${R2.fileName(S.machine)}. Put it in the Data folder.`); },
    openTimeFiles: () => pickFiles(".json", files => { files.forEach(([n, t]) => { const r = R2.parseTimeFile(t, n); S.fileEvents["picked:" + n] = r.events; if (r.bad) S.problems.push(r.bad); }); recompute(); render(); toast(`Merged ${files.length} time file(s).`); }),
    importLog: () => pickFile(".md,.txt", (n, t) => importLog(n, t)), logCall: () => logCall($("#asof")),
    print: () => doPrint("print"), printManager: () => doPrint("manager"), printFocus: () => doPrint("focus"), reload: () => reloadSafely(),
    keyAccounts: () => keyAccountsDialog(), vFocus: () => setView("focus"), vDash: () => setView("dashboard"), vWork: () => setView("workload"), vPrint: () => setView("print"), vManager: () => setView("manager"), vProjects: () => setView("projects"), vAccounts: () => setView("accounts"),
    importAccounts: () => pickFiles(".md,text/markdown", files => importAccountFiles(files)), importContacts: () => pickFile(".csv,text/csv", (n, t) => importContactsFile(n, t)), printAccounts: () => doPrint("accounts"),
    printProjects: () => doPrint("projects"), exportProjects: () => exportProjects("csv"), exportProjectsXlsx: () => exportProjects("xlsx"), exportProjectsGraph: () => exportProjects("graph"), importPlanner: () => importPlanner(), importProjectJson: () => pickFile(".json,application/json", (n, t) => importProjectJson(n, t)),
    hHelp: () => openHelp("help"), hHow: () => openHelp("howdoi"), hFaq: () => openHelp("faq"), hQuick: () => openHelp("quick"), hRev: () => openHelp("rev"), hKeys: () => openHelp("keys"),
  };
  function setView(v) { S.view = v; closePop(); render(); }

  function wireMenus() {
    document.querySelectorAll(".mtop").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); const open = b.getAttribute("aria-expanded") === "true"; closeMenus(); if (!open) { b.setAttribute("aria-expanded", "true"); b.nextElementSibling.classList.remove("hidden"); const f = b.nextElementSibling.querySelector("button"); if (f) f.focus(); } }));
    document.addEventListener("click", e => {
      const a = e.target.closest("[data-act]"); if (a) { closeMenus(); ACTIONS[a.dataset.act](); return; }
      if (!e.target.closest(".mitem")) closeMenus();
      const tab = e.target.closest(".tab"); if (tab) return setView(tab.dataset.view);
      const pe = e.target.closest && e.target.closest("[data-pinedit]"); if (pe) { const f = findTask(pe.dataset.pinedit); if (f) taskEditor(f.p.id, f.t); return; }
      if (focusClick(e)) return;
      if (projectsClick(e)) return;
      if (accountsClick(e)) return;
      const tl = e.target.closest("[data-filter]"); if (tl) { S.filter = S.filter === tl.dataset.filter ? null : tl.dataset.filter; render(); return; }
      if (e.target.id === "clearf") { S.filter = null; render(); return; }
      if (e.target.id === "trends-toggle") { S.trends = !S.trends; render(); return; }
      const g = e.target.closest("[data-grp]"); if (g) { S.collapsed[g.dataset.grp] = !S.collapsed[g.dataset.grp]; render(); return; }
      const tg = e.target.closest("[data-toggle]"); if (tg) { S.open[tg.dataset.toggle] = !S.open[tg.dataset.toggle]; render(); return; }
      const ad = e.target.closest("[data-add]"); if (ad) { addEntry(S.snap.items.find(i => i.id === ad.dataset.id), +ad.dataset.add); return; }
      const cu = e.target.closest("[data-custom]"); if (cu) { const it = S.snap.items.find(i => i.id === cu.dataset.custom), g2 = itemGuess(it);
        popover(cu, { title: "Log time", sub: R.formatLine(it), minutes: 45, audience: g2.a.value, subject: g2.s.value, account: it.account, ga: g2.a.why, gs: g2.s.why, ok: "Log time",
          save: v => { addEntry(it, v.minutes, v); if (v.audience !== g2.a.value) teach({ account: v.account }, v.audience); } }); return; }
      const at = e.target.closest("[data-attend]"); if (at) { markAttended(at.dataset.attend); return; }
      if (e.target.closest("[data-logcall]")) { logCall(e.target.closest("[data-logcall]")); return; }
      if (e.target.closest("[data-exportcsv]")) { ACTIONS.exportCSV(); return; }
      const en = e.target.closest("[data-ent]"); if (en) { editCalendarEntry(en, S.entries.find(x => x.id === en.dataset.ent)); return; }
      const dl = e.target.closest("[data-del]"); if (dl) { removeEntry(dl.dataset.del); return; }
      if (e.target.id === "wk-prev") { S.wkOffset++; render(); } if (e.target.id === "wk-next" && S.wkOffset > 0) { S.wkOffset--; render(); }
      if (e.target.id === "help-close" || e.target.id === "help") $("#help").classList.remove("open");
    });
    document.addEventListener("input", e => { if (e.target && e.target.id === "acc-q") { S.accQ = e.target.value; const pos = e.target.selectionStart; renderAccounts(); const q = $("#acc-q"); if (q) { q.focus(); q.setSelectionRange(pos, pos); } } });
    document.addEventListener("change", e => { if (projectsChange(e)) return; if (accountsChange(e)) return; const s = e.target.closest("[data-ed]"); if (!s) return; const ent = S.entries.find(x => x.id === s.dataset.ed); updateEntry(ent, { [s.dataset.k]: s.value }); saveEntries(); render(); });
    document.addEventListener("keydown", focusKeys);
    document.addEventListener("keydown", e => { if (e.key === "Escape") { closeTaskEditor(); closeSnooze(); closeMenus(); closePop(); const c = $("#cleardlg"); if (c) c.remove(); $("#help").classList.remove("open"); } });
    $("#howdoi-input").addEventListener("input", e => { const q = e.target.value.toLowerCase(); document.querySelectorAll("#help-howdoi details").forEach(d => d.classList.toggle("hidden", q && !d.textContent.toLowerCase().includes(q))); });
    window.addEventListener("beforeprint", () => { const w = printTarget(); document.querySelectorAll(".view").forEach(v => v.classList.toggle("printing", v.id === "view-" + w)); });
    window.addEventListener("afterprint", () => document.querySelectorAll(".view").forEach(v => v.classList.remove("printing")));
    $("#rev").textContent = "Rev " + REV;
    const img = $("#avatar"); img.addEventListener("error", () => { img.style.display = "none"; $("#avatar-fb").style.display = "flex"; });
    if (img.complete && !img.naturalWidth) img.dispatchEvent(new Event("error"));
  }
  function closeMenus() { document.querySelectorAll(".mtop").forEach(b => { b.setAttribute("aria-expanded", "false"); b.nextElementSibling.classList.add("hidden"); }); }

  window.DASH.app = { state: S, useSnapshot, render, REV, flush, syncNow, recompute, commit, innerName, writeOwn, hubConnect, hubForget, setFlag, focusModel, checkTz, setOwner, projectsModel, saveStore, projOps, accountsModel, importAccountFiles, importContactsFile, renameChoice };
  window.addEventListener("beforeunload", e => { if (pending.size) { e.preventDefault(); e.returnValue = ""; } });
  boot();
})();
