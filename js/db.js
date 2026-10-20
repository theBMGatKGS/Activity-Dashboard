/* Local storage for Activity Dashboard: IndexedDB "activity-dashboard", one key-value store.
   Keys: ownEvents (this machine's time events, also written to Data/time-<machine>.json), timeEntries (cache of merged entries;
   in 00.01 the only copy), calTombstones/audienceRules (00.01, migrated once), history, openedSnapshot, prefs, machine, dataDir (folder handle), migratedV2. Nothing ever leaves this browser except via File > Export local data. */
(function (g) {
  "use strict";
  const NAME = "activity-dashboard", STORE = "kv", KEYS = ["ownEvents", "migratedV2", "timeEntries", "calTombstones", "history", "audienceRules", "openedSnapshot", "prefs"];
  let dbp = null, mem = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(res => {
      try {
        const r = indexedDB.open(NAME, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => res(r.result);
        r.onerror = () => { mem = {}; res(null); };
      } catch (e) { mem = {}; res(null); }
    });
    return dbp;
  }
  async function get(k) {
    const db = await open(); if (!db) return mem[k];
    return new Promise(res => { const q = db.transaction(STORE).objectStore(STORE).get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); });
  }
  async function set(k, v) {
    const db = await open(); if (!db) { mem[k] = v; return; }
    return new Promise((res, rej) => { const t = db.transaction(STORE, "readwrite"); t.objectStore(STORE).put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); });
  }
  async function exportAll() { const o = { app: "activity-dashboard", exportVersion: 1, exportedAt: new Date().toISOString() }; for (const k of KEYS) o[k] = await get(k); return o; }
  async function importAll(o) {
    if (!o || o.app !== "activity-dashboard" || o.exportVersion !== 1) throw new Error("Not an Activity Dashboard local-data export.");
    if (o.timeEntries && !Array.isArray(o.timeEntries)) throw new Error("timeEntries must be a list.");
    for (const k of KEYS) if (o[k] !== undefined && k !== "ownEvents") await set(k, o[k]);
    // D6: only this machine's own events are taken from an export; anything else is dropped and counted.
    let dropped = 0;
    if (Array.isArray(o.ownEvents)) { const me = await get("machine"), cur = (await get("ownEvents")) || [];
      const mine = o.ownEvents.filter(e => e && me && e.machine === me && g.DASH.sync.validEvent(e)); dropped = o.ownEvents.length - mine.length;
      await set("ownEvents", g.DASH.sync.dedupe(cur.concat(mine))); }
    return { dropped };
  }
  // Never clears the machine name, folder grant or time events: deleting time is done by the app as "remove" events,
  // so it reaches the other machine too (Clear → Also delete, typed DELETE).
  const KEEP = ["ownEvents", "migratedV2", "timeEntries", "calTombstones", "audienceRules"];
  async function clearAll() { for (const k of KEYS) if (!KEEP.includes(k)) await set(k, undefined); }
  g.DASH = g.DASH || {}; g.DASH.db = { get, set, exportAll, importAll, clearAll, usingMemory: () => !!mem };
})(window);
