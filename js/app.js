/* Activity Dashboard — UI. Local-file app: open index.html directly. */
(function () {
  "use strict";
  const R = DASH.rules, DB = DASH.db, CFG = window.DASH_CONFIG || {};
  const REV = "00.03.000_261021";
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const qp = new URLSearchParams(location.search);
  const NOW = qp.get("now") ? new Date(qp.get("now")) : new Date();
  const TIPS = {
    overdue: "The next date is before today.", dueToday: "The next date is today.", thisWeek: "Due from tomorrow through Sunday.",
    iOwe: "Follow-ups and Account touches where the user owes the next move.", owedToMe: "Everything in Waiting on.",
    goingCold: "Any open item with no activity in 14+ days. Activity = a To Do edit, time logged on that item, or a meeting with its account.",
    followUps: "Everything open in the Follow-ups list.", waitingOn: "Everything open in the Waiting on list.",
    accountTouches: "Everything open in the Account touches list.", travel: "Everything open in the Travel list.",
  };
  const LABEL = { overdue: "Overdue", dueToday: "Due Today", thisWeek: "This Week", iOwe: "I Owe", owedToMe: "Owed to Me", goingCold: "Going Cold",
    followUps: "Follow-ups", waitingOn: "Waiting on", accountTouches: "Account touches", travel: "Travel" };
  const S = { snap: null, today: R.ymd(NOW), filter: null, open: {}, collapsed: {}, entries: [], removedCal: [], history: [], rules: R.DEFAULT_RULES, view: "dashboard", wkOffset: 0, trends: false };

  // ---------- loading ----------
  function loadScript(src) {
    return new Promise(res => { const s = document.createElement("script"); s.src = src + "?t=" + Date.now(); s.onload = () => res(true); s.onerror = () => res(false); document.head.appendChild(s); });
  }
  async function boot() {
    wireMenus(); registerPWA();
    try { const lg = await DB.migrateLegacy(CFG.legacyDbNames || []); if (lg) S.legacyImported = lg; } catch (e) { banner("⚠ The older browser cache couldn't be copied: " + (e.message || e), true); }
    S.history = (await DB.get("history")) || [];
    S.own = (await DB.get("ownEvents")) || [];
    await setupMachine();
    await connectStored();
    if (S.dir) { await loadKeyring(); await ensureUnlocked(); }
    recompute();
    let raw = null, from = "";
    if (S.dir) { const r = await readDirSnapshot(); if (r) { raw = r; from = "Inbox Exporter snapshot"; } }
    if (!raw && !S.vault.kr && await loadScript(CFG.snapshotPath || "Data/inbox-snapshot.js") && window.DASH_SNAPSHOT) { raw = window.DASH_SNAPSHOT; from = "Inbox Exporter snapshot"; }
    const opened = await DB.get("openedSnapshot");
    if (opened && (!raw || new Date(opened.generated_at) > new Date(raw.generated_at))) { raw = opened; from = "opened file"; }
    if (!raw && await loadScript(CFG.examplePath || "examples/example-snapshot.js") && window.DASH_EXAMPLE_SNAPSHOT) { raw = window.DASH_EXAMPLE_SNAPSHOT; from = "example snapshot"; }
    if (!raw) { await migrateV01(null); banner("No snapshot found. Put inbox-snapshot.js in the data folder, or use File → Open snapshot….", true); render(); return; }
    await migrateV01(raw && !raw.example ? raw : null);
    if (await useSnapshot(raw, from)) await autoloadLog();
    startPolling();
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
    s.from = from; s.raw_generated_at = raw.generated_at; S.snap = s;
    const cur = { generated_at: s.generatedAt, totals: R.totals(s.items, ctx()) };
    S.history = R.mergeHistory(R.mergeHistory(S.history, s.history), [cur]);
    if (!s.example) await DB.set("history", S.history);
    seedCalendarEntries();
    if (s.rejects.length) banner(`⚠ Incomplete: ${s.rejects.length} row(s) skipped — ${s.rejects.slice(0, 3).join("; ")}${s.rejects.length > 3 ? "; …" : ""}`);
    render(); return true;
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
  function track(p) { if (p && p.then) { pending.add(p); p.finally(() => pending.delete(p)); } return p; }
  function flush() { return Promise.all([...pending]); }
  async function reloadSafely() { await flush(); location.reload(); }
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
  Object.assign(S, { clock: R2.clock(), future: [], fileProblems: {}, machine: null, own: [], fileEvents: {}, seen: {}, problems: [], dir: null, dirStored: null, granted: false, lastSync: null, machines: [], view0: { entries: [], removedCal: [], domainMap: {} } });
  const isExample = () => S.snap && S.snap.example && !S.allowExampleWrites;
  function learned(rules) { const d = (rules && rules.domainMap) || {}, b = R.DEFAULT_RULES.domainMap, o = {}; Object.keys(d).forEach(k => { if (b[k] !== d[k]) o[k] = d[k]; }); return o; }
  function recompute() {
    // D5: stamps more than holdHours ahead are held: not applied and not seen by the clock until real time catches up.
    const q = R2.quarantine(S.own.filter(e => e.machine === S.machine).concat(...Object.values(S.fileEvents)), Date.now(), CFG.holdHours || 24);
    const all = q.live, st = R2.fold(all), m = R2.materialize(st);
    S.clock.observe(all); S.held = R2.dedupe(q.held); S.future = R2.futureStamps(all, Date.now(), S.machine); S.removedIds = new Set(m.removedIds);
    const rep = {}; S.future.concat(S.held).forEach(e => { if (e.machine === S.machine) return; const a = Math.round((Date.parse(e.ts) - Date.now()) / 60000); rep[e.machine] = Math.max(rep[e.machine] || 0, a); });
    const reports = Object.keys(rep).sort().map(k => ({ about: k, ahead_min: rep[k] }));
    if (JSON.stringify(reports) !== JSON.stringify(S.myReports || [])) { S.myReports = reports; if (S.machine) setTimeout(() => scheduleWrite(), 0); }
    S.aboutMe = [].concat(...Object.entries(S.fileReports || {}).map(([n, rs]) => (rs || []).filter(r => r.about === S.machine && R2.fileMachine(n) !== S.machine).map(r => Object.assign({ by: R2.fileMachine(n) }, r))));
    // Unattended time for a meeting that now overlaps another doesn't count (and isn't deleted): it returns if the overlap goes away.
    const conflicted = S.snap ? new Set(R.withConflicts(S.snap.calendar).filter(e => e.conflict).map(e => e.id)) : new Set();
    m.entries = m.entries.filter(e => !(e.source === "calendar" && !e.attended && conflicted.has(e.eventId)));
    S.entries = m.entries; S.removedCal = m.removedCal; S.machines = st.machines;
    S.rules = Object.assign({}, R.DEFAULT_RULES, { domainMap: Object.assign({}, R.DEFAULT_RULES.domainMap, m.domainMap) });
    S.view0 = JSON.parse(JSON.stringify({ entries: m.entries, removedCal: m.removedCal, domainMap: m.domainMap }));
    if (S.snap && !isExample()) track(DB.set("timeEntries", S.entries));   // cache only
  }
  // Automatic entries get a fixed, old timestamp so they can never override a real edit or removal made on the other machine.
  function tsFor(e) {
    if (e.source === "calendar" && !e.attended) { const ev = S.snap && S.snap.calendar.find(x => x.id === e.eventId); if (ev) return new Date(ev.start).toISOString(); }
    if (e.origin === "notebook-log" && e.date) { const d = new Date(`${e.date}T${e.time || "00:00"}:00`); if (!isNaN(d)) return d.toISOString(); }
    return null;
  }
  function commit() {
    const next = { entries: S.entries, removedCal: S.removedCal, domainMap: learned(S.rules) };
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
    if (window.DASH_TEST_FS) { S.dir = S.dirStored = window.DASH_TEST_FS; S.granted = true; return; }   // test harness only
    let h = null; try { h = await DB.get("dataDir"); } catch (e) { h = null; }
    if (!h || !h.queryPermission) return;
    S.dirStored = h; if (await permOK(h)) { S.dir = h; S.granted = true; }
  }
  async function connectFolder() {
    try {
      if (S.dirStored && !S.granted && S.dirStored.requestPermission) {   // reconnect: one click, same folder
        if ((await S.dirStored.requestPermission({ mode: "readwrite" })) === "granted") { S.dir = S.dirStored; S.granted = true; await afterConnect(); return; }
      }
      if (!window.showDirectoryPicker) { banner("This browser can't connect a folder. Open the dashboard in Edge or Chrome, or use File → Save my time file… / Open time files….", true); return; }
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
  S.vault = { kr: null, key: null, locked: false, plainLeft: [], plainDone: {} };
  const locked = () => !!(S.vault.kr && !S.vault.key);
  // "time-mac.json.enc" → "time-mac.json"; a OneDrive conflict copy "time-mac.json-WORKPC.enc" → "time-mac-WORKPC.json"
  function innerName(n) { if (!/\.enc$/i.test(n)) return n; const b = n.slice(0, -4); return /\.(json|js)$/i.test(b) ? b : b.replace(/\.(json|js)([^.]*)$/i, "$2.$1"); }
  const isSnapName = n => SNAP_NAMES.includes(n) || /^inbox-snapshot(?:[^a-z0-9][^/]*)?\.jso?n?$/i.test(n);
  const isLogName = n => LOG_NAMES.includes(n) || /^notebook-log(?:[^a-z0-9][^/]*)?\.js$/i.test(n);
  const purposeOf = n => R2.isTimeFile(n) ? "time" : isSnapName(n) ? "snapshot" : isLogName(n) ? "log" : null;
  async function writeText(name, text) {
    const fh = await S.dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();            // Chromium writes to a temporary swap file; close() swaps it in (atomic)
    await w.write(text); await w.close(); return fh.getFile();
  }
  async function readName(name) { const h = await S.dir.getFileHandle(name); return readText(h); }
  async function loadKeyring() {
    try { const r = await readName(KEYRING); S.seen[KEYRING] = r.sig; const kr = V.parseKeyring(r.text);
      if (S.vault.kr && S.vault.kr.keyId !== kr.keyId) { S.vault.key = null; }   // a different keyring replaced this one
      S.vault.kr = kr; return kr; }
    catch (e) { if (e && e.name !== "NotFoundError") S.problems.push(`${KEYRING}: ${e.message || e}`); return null; }
  }
  async function ensureUnlocked() {
    if (!S.vault.kr || S.vault.key) return true;
    try { const rem = await DB.get("vaultKey"); if (rem && rem.keyId === S.vault.kr.keyId && rem.key) { S.vault.key = rem.key; S.vault.remembered = true; return true; } } catch (e) { /* not remembered */ }
    const key = await unlockDialog();
    if (!key) { S.vault.locked = true; banner("🔒 The Data folder is encrypted and locked. Nothing is read from or written to it until you unlock (File → Encryption…).", true); return false; }
    S.vault.key = key; S.vault.locked = false; return true;
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
      <label class="vchk"><input type="checkbox" id="vault-remember"> Remember on this computer (stays unlocked until you choose Lock or Forget)</label>
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
      <p>Write this recovery key down or save it somewhere off this computer, such as a password manager. It's the <b>only</b> way back in if the passphrase is forgotten. It's shown once.</p>
      <div class="rkbox mono" id="rk-value">${esc(rk)}</div>
      <div class="vbtns" style="justify-content:flex-start"><button class="btn" id="rk-copy">Copy</button><button class="btn" id="rk-save">Save as .txt…</button></div>
      <label class="vchk"><input type="checkbox" id="rk-done"> I've stored the recovery key somewhere safe, not in the Data folder</label>
      <div class="vbtns"><button class="btn primary" id="rk-ok" disabled>Continue</button></div>`,
    (d, done) => {
      d.querySelector("#rk-done").onchange = e => { d.querySelector("#rk-ok").disabled = !e.target.checked; };
      d.querySelector("#rk-copy").onclick = () => { try { navigator.clipboard.writeText(rk); toast("Recovery key copied. Paste it into your password manager, then clear the clipboard."); } catch (e) { toast("Copy failed; write it down instead."); } };
      d.querySelector("#rk-save").onclick = () => download("activity-dashboard-recovery-key.txt", null, `Activity Dashboard recovery key\nKeyring id: ${S.vault.kr ? S.vault.kr.keyId : ""}\n\n${rk}\n\nKeep this off the synced Data folder.\n`);
      d.querySelector("#rk-ok").onclick = () => done(true);
    });
  }
  async function turnOnEncryption() {
    if (!S.dir || !S.granted) { banner("Connect the Data folder first (File → Connect Data folder…), then turn on encryption.", true); return; }
    if (await loadKeyring()) { toast("This Data folder is already encrypted (another computer turned it on)."); await ensureUnlocked(); S.seen = {}; await syncNow(true); return; }
    const setup = await dialog("vaultsetup", `<b class="vt">🔐 Encrypt the Data folder</b>
      <p>Every data file in the connected Data folder is encrypted on this computer before it's saved (AES-256-GCM). Other computers need the same passphrase. The app can't recover a lost passphrase. Only the recovery key can.</p>
      ${passFields("Passphrase (12+ characters; a few unrelated words works well)", "Passphrase again")}
      <label class="vchk"><input type="checkbox" id="vs-remember"> Remember on this computer</label>
      <label class="vchk"><input type="checkbox" id="vs-delete" checked> After the encrypted copies are checked, delete the plaintext originals from the Data folder</label>
      <div id="vs-err" class="verr" role="alert"></div>
      <div class="vbtns"><button class="btn" id="vs-cancel">Cancel</button><button class="btn primary" id="vs-ok">Encrypt</button></div>`,
    (d, done) => {
      d.querySelector("#vs-cancel").onclick = () => done(null);
      d.querySelector("#vs-ok").onclick = async () => {
        const p = checkNew(d); if (p) { d.querySelector("#vs-err").textContent = p; return; }
        d.querySelector("#vs-ok").disabled = true; d.querySelector("#vs-err").textContent = "Creating the key…";
        try { const r = await V.createKeyring(d.querySelector("#vp1").value, CFG.kdfIterations ? { iter: CFG.kdfIterations } : undefined);
          done(Object.assign(r, { remember: d.querySelector("#vs-remember").checked, del: d.querySelector("#vs-delete").checked })); }
        catch (e) { d.querySelector("#vs-err").textContent = e.message || String(e); d.querySelector("#vs-ok").disabled = false; }
      };
    });
    if (!setup) return;
    S.vault.kr = setup.keyring; S.vault.key = setup.key;
    await recoveryDialog(setup.recoveryKey, "Save your recovery key");
    if (await loadKeyring() && S.vault.kr.keyId !== setup.keyring.keyId) { banner("Another computer encrypted this folder at the same moment. Its keyring is kept; unlock with its passphrase.", true); S.vault.key = null; await ensureUnlocked(); return; }
    S.vault.kr = setup.keyring; S.vault.key = setup.key;
    await writeText(KEYRING, JSON.stringify(setup.keyring, null, 1) + "\n");
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
          target = "inbox-snapshot.json" + ENC; const raw = parseSnapshotText(name, text); body = JSON.stringify(raw);
          try { const old = JSON.parse(await V.decrypt(S.vault.key, S.vault.kr, (await readName(target)).text, "snapshot")); if (new Date(old.generated_at) > new Date(raw.generated_at)) body = null; } catch (e) { /* none yet */ }
        } else { target = "notebook-log.js" + ENC; parseLogJs(text); body = text; }
        if (body != null) {
          const ct = await V.encrypt(S.vault.key, S.vault.kr, purpose, body); await writeText(target, ct);
          if (await V.decrypt(S.vault.key, S.vault.kr, (await readName(target)).text, purpose) !== body) throw new Error("read-back check failed");
        }
        n++;
        if (prefs.deletePlain && S.dir.removeEntry) await S.dir.removeEntry(name); else { S.vault.plainDone[name] = sig; left.push(name); }
      } catch (e) { S.fileProblems[name] = `${name}: plaintext file not encrypted (${e.message || e})`; left.push(name); }
    }
    return { n, left };
  }
  async function deletePlainNow() {
    const left = S.vault.plainLeft.slice(); if (!left.length) { toast("No plaintext data files are left in the Data folder."); return; }
    if (!confirm(`Delete ${left.length} plaintext file(s) from the Data folder? Their encrypted copies were checked.\n\n${left.join("\n")}`)) return;
    const prefs = (await DB.get("prefs")) || {}; prefs.deletePlain = true; await DB.set("prefs", prefs);
    S.vault.plainDone = {}; S.seen = {}; await syncNow(true); toast("Plaintext originals deleted.");
  }
  async function encryptionDialog() {
    if (!S.vault.kr) { await turnOnEncryption(); return; }
    if (!S.vault.key) { if (await ensureUnlocked()) { S.seen = {}; await syncNow(true); } return; }
    const act = await dialog("vaultmenu", `<b class="vt">🔐 Encryption</b>
      <p>This Data folder is encrypted (keyring <span class="mono">${esc(S.vault.kr.keyId)}</span>, created ${esc(new Date(S.vault.kr.created).toLocaleDateString())}). It's unlocked on this computer${S.vault.remembered ? " and remembered" : " for this session only"}.</p>
      ${S.vault.plainLeft.length ? `<p class="verr">⚠ ${S.vault.plainLeft.length} plaintext file(s) are still in the Data folder: ${esc(S.vault.plainLeft.join(", "))}</p>` : ""}
      <div class="vcol">
        <button class="btn" data-v="pass">Change passphrase…</button>
        <button class="btn" data-v="rk">New recovery key…</button>
        <button class="btn" data-v="rem">${S.vault.remembered ? "Forget on this computer" : "Remember on this computer"}</button>
        ${S.vault.plainLeft.length ? `<button class="btn" data-v="del">Delete plaintext originals…</button>` : ""}
        <button class="btn" data-v="lock">Lock now</button>
      </div><div class="vbtns"><button class="btn primary" data-v="">Close</button></div>`,
    (d, done) => d.querySelectorAll("[data-v]").forEach(b => b.onclick = () => done(b.dataset.v)));
    if (act === "rem") { await rememberKey(!S.vault.remembered); toast(S.vault.remembered ? "Remembered on this computer." : "Forgotten: you'll be asked for the passphrase next time."); }
    if (act === "lock") { await rememberKey(false); S.vault.key = null; S.vault.locked = true; banner("🔒 Locked. File → Encryption… to unlock.", true); renderSync(); }
    if (act === "del") await deletePlainNow();
    if (act === "pass") {
      const r = await dialog("vaultpass", `<b class="vt">Change passphrase</b><label class="vlab">Current passphrase<input type="password" id="vc-old"></label>${passFields("New passphrase", "New passphrase again")}
        <div id="vc-err" class="verr" role="alert"></div><div class="vbtns"><button class="btn" id="vc-cancel">Cancel</button><button class="btn primary" id="vc-ok">Change</button></div>`,
      (d, done) => { d.querySelector("#vc-cancel").onclick = () => done(null);
        d.querySelector("#vc-ok").onclick = async () => { const p = checkNew(d); if (p) { d.querySelector("#vc-err").textContent = p; return; }
          try { done(await V.changePassphrase(S.vault.kr, d.querySelector("#vc-old").value, false, d.querySelector("#vp1").value, CFG.kdfIterations ? { iter: CFG.kdfIterations } : undefined)); } catch (e) { d.querySelector("#vc-err").textContent = e.message; } }; });
      if (r) { await writeText(KEYRING, JSON.stringify(r, null, 1) + "\n"); S.vault.kr = r; toast("Passphrase changed. Your other computers ask for the new one next time they're locked."); }
    }
    if (act === "rk") {
      const pass = await dialog("vaultnewrk", `<b class="vt">New recovery key</b><p>The old recovery key stops working.</p><label class="vlab">Passphrase<input type="password" id="vr-pass"></label>
        <div id="vr-err" class="verr" role="alert"></div><div class="vbtns"><button class="btn" id="vr-cancel">Cancel</button><button class="btn primary" id="vr-ok">Make new key</button></div>`,
      (d, done) => { d.querySelector("#vr-cancel").onclick = () => done(null);
        d.querySelector("#vr-ok").onclick = async () => { try { done(await V.replaceRecovery(S.vault.kr, d.querySelector("#vr-pass").value, CFG.kdfIterations ? { iter: CFG.kdfIterations } : undefined)); } catch (e) { d.querySelector("#vr-err").textContent = e.message; } }; });
      if (pass) { await recoveryDialog(pass.recoveryKey, "Your new recovery key"); await writeText(KEYRING, JSON.stringify(pass.keyring, null, 1) + "\n"); S.vault.kr = pass.keyring; toast("New recovery key saved in the keyring. The old one no longer works."); }
    }
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
  async function readDirSnapshot() {
    if (S.vault.kr) {
      if (!S.vault.key) return null; const n = "inbox-snapshot.json" + ENC;
      try { const r = await readName(n); S.seen[n] = r.sig; return JSON.parse(await V.decrypt(S.vault.key, S.vault.kr, r.text, "snapshot")); }
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
    if (!window.DASH_TEST_FS && !(await permOK(S.dir))) { S.granted = false; renderSync(); return; }
    S.granted = true; let changed = false; const names = new Set(); let snapRaw = null, logObj = null, plain = [], kept = [], keyringSeen = false;
    if (S.vault.kr && !S.vault.key) { S.lastSync = new Date(); renderSync(); return; }   // encrypted and locked: touch nothing
    try {
      for await (const [name, h] of S.dir.entries()) {
        if (h.kind !== "file") continue; names.add(name);
        if (name === KEYRING) { keyringSeen = true; continue; }
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
        try {
          if (isEnc) r.text = await V.decrypt(S.vault.key, S.vault.kr, r.text, purpose);
          if (purpose === "time") { const p = R2.parseTimeFile(r.text, inner); if (p.bad) S.fileProblems[name] = p.bad; S.fileEvents[inner] = p.events; (S.fileReports = S.fileReports || {})[inner] = p.reports || []; (S.fileUpdated = S.fileUpdated || {})[inner] = p.updated_at; changed = true; }
          else if (purpose === "log") logObj = parseLogJs(r.text);
          else if (!snapRaw || inner.endsWith(".json")) snapRaw = parseSnapshotText(inner, r.text);
        } catch (e) { S.fileProblems[name] = `${name}: unreadable (${e.message || e})`; if (purpose === "time") { delete S.fileEvents[inner]; changed = true; } }
      }
    } catch (e) { S.problems.push("Data folder: " + (e.message || e)); }
    if (keyringSeen && !S.vault.kr && !again) {   // another computer turned on encryption: unlock, then read the encrypted files
      if (await loadKeyring()) { await ensureUnlocked(); S.seen = {}; return doSync(manual, true); }
    }
    if (S.vault.kr) {
      const r = plain.length && !again ? await encryptPlain(plain) : { n: 0, left: plain.map(x => x[0]) };
      S.vault.plainLeft = kept.concat(r.left);
      if (r.n) { S.seen = {}; return doSync(manual, true); }
    }
    if (S.vault.plainLeft.length) S.problems.push(`${S.vault.plainLeft.length} plaintext file(s) still in the Data folder (File → Encryption… → Delete plaintext originals)`);
    Object.keys(S.fileEvents).forEach(n => { if (!n.startsWith("picked:") && !names.has(n)) { delete S.fileEvents[n]; changed = true; } });
    Object.keys(S.fileProblems).forEach(n => { if (!names.has(n)) delete S.fileProblems[n]; });
    S.problems.push(...Object.values(S.fileProblems));
    // absorb this machine's own events found in any file (e.g. a OneDrive conflict copy of my own file)
    const mine = new Set(S.own.map(e => e.eid)), extra = [].concat(...Object.values(S.fileEvents)).filter(e => e.machine === S.machine && !mine.has(e.eid));
    if (extra.length) { S.own = R2.dedupe(S.own.concat(extra)); track(DB.set("ownEvents", S.own)); }
    const ownFile = S.fileEvents[R2.fileName(S.machine)] || [], inFile = new Set(ownFile.map(e => e.eid));
    if (S.own.some(e => !inFile.has(e.eid))) { await writeOwn(); }
    if (S.fileReports) Object.keys(S.fileReports).forEach(n => { if (!names.has(n)) delete S.fileReports[n]; });
    if (changed || extra.length || (S.held && S.held.length)) recompute();
    if (snapRaw && S.snap && (S.snap.example || snapRaw.generated_at !== S.snap.raw_generated_at)) await useSnapshot(snapRaw, "Inbox Exporter snapshot");
    if (logObj) importLog("notebook-log.js", logObj.lines.join("\n"), true);
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
  function startPolling() {
    setInterval(() => syncNow(), POLL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) syncNow(); });
    if (S.dir) syncNow(); else renderSync();
  }
  function hhmm(d) { return d ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"; }
  function renderSync() {
    const c = $("#sync"); if (!c) return;
    const ms = [...new Set(S.machines.concat(S.machine ? [S.machine] : []))].sort().join(", ");
    let txt, warn = false, act = "syncNow", tip;
    if (!S.dir && !window.showDirectoryPicker && !window.DASH_TEST_FS) { warn = true; act = "saveTimeFile"; txt = "⚠ No folder sync in this browser"; tip = "Open the dashboard in Edge or Chrome to sync time between machines. Until then: File → Save my time file… and File → Open time files…."; }
    else if (!S.dirStored) { warn = true; act = "connect"; txt = "⚠ Connect Data folder"; tip = "Click and pick the Dashboard/Data folder so time syncs between your machines."; }
    else if (S.vault && S.vault.kr && !S.vault.key && S.granted) { warn = true; act = "encryption"; txt = "🔒 Data locked"; tip = "The Data folder is encrypted. Click to unlock with your passphrase."; }
    else if (!S.granted) { warn = true; act = "connect"; txt = "⚠ Reconnect Data folder"; tip = "The browser needs your OK again to use the Data folder. Click, then Allow."; }
    else if (S.aboutMe && S.aboutMe.length) { warn = true; const mx = Math.max(...S.aboutMe.map(r => r.ahead_min)), by = [...new Set(S.aboutMe.map(r => r.by))].join(", ");
      txt = "⚠ This computer's clock is ahead"; tip = `${by} sees time stamps from this computer up to ${mx} min in the future. Set this computer's clock to automatic, then Help → FAQ → "Repair clock stamps".`; }
    else if (S.held && S.held.length) { warn = true; const who = [...new Set(S.held.map(e => e.machine))].join(", ");
      txt = `⚠ Clock ahead · ${who} · ${S.held.length} held`; tip = `${S.held.length} change(s) from ${who} are stamped more than ${CFG.holdHours || 24} h in the future (latest ${S.held.map(e => e.ts).sort().pop()}). They are held — not applied — until real time reaches them. Fix: on ${who}, set the clock to automatic and use File → Repair clock stamps…. See Help → FAQ.`; }
    else if (S.future.length) { warn = true; const mx = S.future.reduce((a, e) => Math.max(a, Date.parse(e.ts)), 0), mins = Math.round((mx - Date.now()) / 60000), who = [...new Set(S.future.map(e => e.machine))].join(", ");
      txt = `⚠ Clock ahead · ${who}`; tip = `${S.future.length} time stamp(s) from ${who} are up to ${mins} min in the future. Check that clock is set automatically. Edits here still count after them (the dashboard's clock moves past the newest stamp it has seen).` + (S.problems.length ? "\n\n" + S.problems.join("\n") : ""); }
    else { warn = S.problems.length > 0; txt = `${warn ? "⚠" : S.vault && S.vault.kr ? "🔐" : "⟳"} Synced ${hhmm(S.lastSync)} · ${ms}${warn ? ` · ${S.problems.length} problem${S.problems.length > 1 ? "s" : ""}` : ""}`; tip = (warn ? S.problems.join("\n") + "\n\n" : "") + `Machines seen: ${ms}. Checks the Data folder every ${POLL_MS / 1000} s. Click to sync now.`; }
    c.textContent = txt; c.title = tip; c.dataset.act = act; c.classList.toggle("stale", warn);
  }
  function pickFiles(accept, cb) { const i = document.createElement("input"); i.type = "file"; i.accept = accept; i.multiple = true; i.onchange = async () => { const out = []; for (const f of i.files) out.push([f.name, await f.text()]); cb(out); }; i.click(); }

  // ---------- render ----------
  function render() {
    renderHeader();
    document.querySelectorAll(".view").forEach(v => v.classList.toggle("hidden", v.id !== "view-" + S.view));
    document.querySelectorAll(".tab").forEach(t => t.setAttribute("aria-selected", String(t.dataset.view === S.view)));
    if (!S.snap) return;
    if (S.view === "dashboard") renderDashboard();
    if (S.view === "workload") renderWorkload();
    // Both sheets are always rendered so Ctrl+P from any tab prints a real sheet (F11).
    $("#sheet-print").innerHTML = sheet(false); $("#sheet-manager").innerHTML = sheet(true);
  }
  function asOfText() {
    if (!S.snap) return "No data";
    const d = new Date(S.snap.generatedAt);
    const day = R.dayLabel(R.isoDay(S.snap.generatedAt)).replace(" ", " ");
    return `As of ${day}, ${R.hm(S.snap.generatedAt)} CT · ${S.snap.from === "opened file" ? "opened snapshot" : "Inbox Exporter snapshot"}`;
  }
  function isStale() { return S.snap && (NOW - new Date(S.snap.generatedAt)) / 3.6e6 > (CFG.staleHours || 24); }
  function renderHeader() {
    const a = $("#asof"); a.textContent = (isStale() ? "⚠ Stale · " : "") + asOfText(); a.classList.toggle("stale", !!isStale());
    a.title = isStale() ? "This snapshot is more than 24 hours old. Ask Inbox Exporter for a fresh one." : "Time the snapshot was made (Central Time).";
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
    $("#cal").innerHTML = `<div class="rowhead"><span class="cap">Calendar · Today &amp; Tomorrow · CT</span><span class="faint" style="font-size:11px">from the snapshot · overlaps marked ⚠ Conflict · ✓ = counted (Adjust to change) · overlaps fill nothing until you mark one Attended</span></div><div class="axis">${ax}</div>${lanes}`;
  }
  function fmtMin(m) { return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? " " + (m % 60) + "m" : ""}` : m + "m"; }
  function pill(w) { return `<span class="chip p-${w.replace(" ", "-")}">${w}</span>`; }
  function acctTag(name) { if (!name) return ""; const a = S.snap.accounts.find(x => x.name === name); return `<span class="chip">${esc(name)}${a && a.tier === "T1" ? '<span class="t1">★</span>' : ""}</span>`; }
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
  function logCall(anchor) {
    popover(anchor, { title: "Log call", sub: "Unscheduled interaction · counted at once", kind: "Phone", minutes: 15, audience: "Owner/operator", subject: "Account strategy", account: null, ok: "Log call",
      save: v => {
        const acc = S.snap.accounts.find(a => a.name === v.account);
        S.entries.push({ id: "i" + Date.now() + Math.random().toString(36).slice(2, 6), taskId: null, eventId: null, date: S.today, minutes: v.minutes, kind: v.kind, note: v.note || "",
          audience: v.audience, subject: v.subject, account: v.account, source: "interaction", origin: "quick-add", confirmed: true, guessed: {}, title: `${v.kind}${v.note ? ": " + v.note : ""}` });
        if (acc && acc.domains.length && v.audience !== R.guessAudience(acc.domains, S.rules).value) teach({ account: v.account }, v.audience);
        saveEntries(); toast(`Logged ${fmtMin(v.minutes)} ${v.kind}.`); render(); } });
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
        <td>${esc(e.account || "—")}</td><td>${e.source === "interaction" ? esc(e.kind) + (e.origin === "notebook-log" ? " · log" : "") : e.source}${e.attended ? " · attended" : ""}</td>
        <td>${e.source === "calendar" ? `<button class="btn" data-ent="${esc(e.id)}">Adjust</button> ` : ""}<button class="btn" data-del="${esc(e.id)}" aria-label="Remove entry">Remove</button></td></tr>`).join("") || '<tr><td colspan="8" class="faint">No entries this week.</td></tr>'}
      </tbody></table></div>`;
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
    export: async () => download(`dash-local-data-${S.today}.json`, await DB.exportAll()),
    import: () => pickFile(".json", async (n, t) => { try { const r = await DB.importAll(JSON.parse(t)); toast(`Imported local data${r && r.dropped ? ` (${r.dropped} event(s) from other machines ignored)` : ""}. Reloading…`); setTimeout(reloadSafely, 600); } catch (e) { banner("Import failed: " + e.message, true); } }),
    clear: () => clearDialog(),
    exportCSV: () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([R.timeEntriesCSV(S.entries)], { type: "text/csv" })); a.download = `dash-time-entries-${S.today}.csv`; a.click(); toast(`Exported ${S.entries.length} time entries (CSV).`); },
    repairClock: () => repairClock(), encryption: () => encryptionDialog(), install: () => installApp(),
    connect: () => connectFolder(), syncNow: () => syncNow(true),
    saveTimeFile: () => { if (S.vault.kr && !confirm("This saves your time file unencrypted (plain JSON) to Downloads. Continue?")) return;  download(R2.fileName(S.machine), null, R2.serialize(S.machine, S.own, new Date().toISOString())); toast(`Saved ${R2.fileName(S.machine)}. Put it in the Data folder.`); },
    openTimeFiles: () => pickFiles(".json", files => { files.forEach(([n, t]) => { const r = R2.parseTimeFile(t, n); S.fileEvents["picked:" + n] = r.events; if (r.bad) S.problems.push(r.bad); }); recompute(); render(); toast(`Merged ${files.length} time file(s).`); }),
    importLog: () => pickFile(".md,.txt", (n, t) => importLog(n, t)), logCall: () => logCall($("#asof")),
    print: () => doPrint("print"), printManager: () => doPrint("manager"), reload: () => reloadSafely(),
    vDash: () => setView("dashboard"), vWork: () => setView("workload"), vPrint: () => setView("print"), vManager: () => setView("manager"),
    hHelp: () => openHelp("help"), hHow: () => openHelp("howdoi"), hFaq: () => openHelp("faq"), hQuick: () => openHelp("quick"), hRev: () => openHelp("rev"),
  };
  function setView(v) { S.view = v; closePop(); render(); }

  function wireMenus() {
    document.querySelectorAll(".mtop").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); const open = b.getAttribute("aria-expanded") === "true"; closeMenus(); if (!open) { b.setAttribute("aria-expanded", "true"); b.nextElementSibling.classList.remove("hidden"); const f = b.nextElementSibling.querySelector("button"); if (f) f.focus(); } }));
    document.addEventListener("click", e => {
      const a = e.target.closest("[data-act]"); if (a) { closeMenus(); ACTIONS[a.dataset.act](); return; }
      if (!e.target.closest(".mitem")) closeMenus();
      const tab = e.target.closest(".tab"); if (tab) return setView(tab.dataset.view);
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
    document.addEventListener("change", e => { const s = e.target.closest("[data-ed]"); if (!s) return; const ent = S.entries.find(x => x.id === s.dataset.ed); updateEntry(ent, { [s.dataset.k]: s.value }); saveEntries(); render(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape") { closeMenus(); closePop(); const c = $("#cleardlg"); if (c) c.remove(); $("#help").classList.remove("open"); } });
    $("#howdoi-input").addEventListener("input", e => { const q = e.target.value.toLowerCase(); document.querySelectorAll("#help-howdoi details").forEach(d => d.classList.toggle("hidden", q && !d.textContent.toLowerCase().includes(q))); });
    window.addEventListener("beforeprint", () => { const w = S.view === "manager" ? "manager" : "print"; document.querySelectorAll(".view").forEach(v => v.classList.toggle("printing", v.id === "view-" + w)); });
    window.addEventListener("afterprint", () => document.querySelectorAll(".view").forEach(v => v.classList.remove("printing")));
    $("#rev").textContent = "Rev " + REV;
    const img = $("#avatar"); img.addEventListener("error", () => { img.style.display = "none"; $("#avatar-fb").style.display = "flex"; });
    if (img.complete && !img.naturalWidth) img.dispatchEvent(new Event("error"));
  }
  function closeMenus() { document.querySelectorAll(".mtop").forEach(b => { b.setAttribute("aria-expanded", "false"); b.nextElementSibling.classList.add("hidden"); }); }

  window.DASH.app = { state: S, useSnapshot, render, REV, flush, syncNow, recompute, commit, innerName, writeOwn };
  window.addEventListener("beforeunload", e => { if (pending.size) { e.preventDefault(); e.returnValue = ""; } });
  boot();
})();
