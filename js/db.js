/* Local storage for Activity Dashboard: IndexedDB "activity-dashboard", one key-value store.
   Keys: ownEvents (this machine's time events, also written to Data/time-<machine>.json), timeEntries (cache of merged entries;
   in 00.01 the only copy), calTombstones/audienceRules (00.01, migrated once), history, openedSnapshot, prefs, machine, dataDir (folder handle), migratedV2,
   vaultKey (00.03: only if "Remember on this computer": {keyId, key} with key a NON-extractable AES-GCM CryptoKey), legacyImported. Nothing ever leaves this browser except via File > Export local data. */
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
  // 00.03: one-time copy of an older build's browser cache (same "kv" store, different database name, set in config.local.js
  // legacyDbNames). Runs only on a browser that has never used this build (no machine name yet). The old database is left as is.
  function readAll(name) {
    return new Promise(res => {
      let r; try { r = indexedDB.open(name); } catch (e) { res(null); return; }
      r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) { /* ignore */ } };   // didn't exist: don't create it
      r.onerror = () => res(null);
      r.onsuccess = () => {
        const db = r.result; if (!db.objectStoreNames.contains(STORE)) { db.close(); res(null); return; }
        const out = {}, t = db.transaction(STORE), st = t.objectStore(STORE), c = st.openCursor();
        c.onsuccess = () => { const cur = c.result; if (cur) { out[cur.key] = cur.value; cur.continue(); } };
        t.oncomplete = () => { db.close(); res(out); }; t.onerror = () => { db.close(); res(null); };
      };
    });
  }
  async function migrateLegacy(names) {
    if (!Array.isArray(names) || !names.length || typeof indexedDB === "undefined" || !(await open())) return null;
    if ((await get("legacyImported")) || (await get("machine"))) return null;
    let present = null; try { if (indexedDB.databases) present = (await indexedDB.databases()).map(d => d.name); } catch (e) { present = null; }
    for (const n of names) {
      if (!n || n === NAME || (present && !present.includes(n))) continue;
      const data = await readAll(n); if (!data || !Object.keys(data).length) continue;
      for (const [k, v] of Object.entries(data)) if (v !== undefined) await set(k, v);
      const info = { from: n, at: new Date().toISOString(), keys: Object.keys(data).length }; await set("legacyImported", info); return info;
    }
    return null;
  }
  g.DASH = g.DASH || {}; g.DASH.db = { get, set, exportAll, importAll, clearAll, migrateLegacy, usingMemory: () => !!mem };
})(window);
