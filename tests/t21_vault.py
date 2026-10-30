"""T21 (00.03): encrypted Data folder, end to end in Chromium. Synthetic/fictional example data only.
Two simulated machines share one temp Data folder through a test-only stand-in for the granted folder handle
(window.DASH_TEST_FS, as in T20, plus removeEntry). Checks: turn on encryption from the menu, recovery key shown once,
plaintext encrypted + verified + deleted, no readable data left in the folder, same totals, unlock / wrong passphrase /
remember, second machine unlocks with the recovery key and sets a new passphrase, edits sync encrypted both ways,
a plaintext snapshot dropped later is encrypted, a tampered file is reported (not applied), Lock stops all writes,
and the one-time copy of an older build's browser cache + older time-log kind."""
import pathlib, shutil, tempfile, json, os, subprocess, sys
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
FS_JS = """(() => { const nf = () => { const e = new Error('not found'); e.name = 'NotFoundError'; return e; };
  const fh = n => ({ kind: 'file', name: n, async getFile() { const r = await window.__fs('read', n, ''); if (!r) throw nf(); return { lastModified: r.m, size: r.size, text: async () => r.text }; },
    async createWritable() { let buf = ''; return { write: async t => { buf += t; }, close: async () => { await window.__fs('write', n, buf); } }; } });
  window.DASH_TEST_FS = { kind: 'directory', name: 'Data', queryPermission: async () => 'granted',
    async *entries() { for (const f of await window.__fs('list', '', '')) yield [f, fh(f)]; },
    async getFileHandle(n, o) { const l = await window.__fs('list', '', ''); if (!l.includes(n) && !(o && o.create)) throw nf(); return fh(n); },
    async removeEntry(n) { await window.__fs('remove', n, ''); } }; })();"""
tmp = pathlib.Path(tempfile.mkdtemp()); app = tmp / "Dashboard"; shutil.copytree(SRC, app, ignore=shutil.ignore_patterns("tests", ".git"))
snap = json.loads((app / "examples/example-snapshot.json").read_text()); snap.pop("example")
data = tmp / "Data"; data.mkdir(); (data / "inbox-snapshot.json").write_text(json.dumps(snap))
subprocess.run([sys.executable, str(SRC / "tools/make_log_js.py"), str(SRC / "tests/fixtures/example-notebook-log.md"), str(data / "notebook-log.js")], check=True, capture_output=True)
SECRETS = sorted({i.get(k) for lst in ("tasks", "calendar", "accounts") for i in snap.get(lst, []) for k in ("person", "title", "account", "name") if isinstance(i.get(k), str) and len(i.get(k)) > 4} | {"Account A", "Account B"})
def fs_for(d):
    def fs(op, name, text):
        if op == "list": return sorted(x for x in os.listdir(d) if not x.endswith(".crswap"))
        p = d / name
        if op == "read":
            if not p.exists(): return None
            st = p.stat(); return {"m": int(st.st_mtime_ns // 1_000_000), "size": st.st_size, "text": p.read_text()}
        if op == "write": t = d / (name + ".crswap"); t.write_text(text); os.replace(t, p); return True
        if op == "remove": p.unlink(); return True
    return fs
Q = "?now=2026-10-19T08:00:00-05:00&view=dashboard&machine="
TOT = "JSON.stringify(DASH.app.state.entries.map(e => [e.id, e.minutes]).sort())"
RAW = """new Promise(res => { const r = indexedDB.open('activity-dashboard'); r.onsuccess = () => { const out = {}, t = r.result.transaction('kv'), c = t.objectStore('kv').openCursor();
  c.onsuccess = () => { const x = c.result; if (x) { out[x.key] = x.value; x.continue(); } };
  t.oncomplete = () => res(JSON.stringify(out, (k, v) => (v && typeof v === 'object' && (v.constructor.name === 'CryptoKey' || v.kind === 'directory')) ? '[obj]' : v)); }; })"""
SECRET_KEYS = ["ownEvents", "timeEntries", "calTombstones", "history", "audienceRules", "openedSnapshot"]
def cache_clean(pg, extra=()):
    raw = pg.evaluate(RAW); o = json.loads(raw)
    leaks = [s for s in list(SECRETS) + ["Owner/operator", "i-pc-enc", "i-locked"] + list(extra) if s in raw]
    plain = [k for k in SECRET_KEYS if k in o and o[k] is not None and not (isinstance(o[k], dict) and o[k].get("dashCache") == 1)]
    return leaks, plain, o
PASS1, PASS2 = "synthetic test passphrase one", "second passphrase from recovery"
errors = []; dialogs = []; DLG = {"accept": True}
def on_dialog(dlg):
    dialogs.append(dlg.message); (dlg.accept() if DLG["accept"] else dlg.dismiss())
DBS = "indexedDB.databases().then(d => d.map(x => x.name))"
with sync_playwright() as p:
    b = p.chromium.launch()
    def page(m, d=data, appdir=app, init=None, q=None):
        ctx = b.new_context(viewport={"width": 1440, "height": 900}); ctx.expose_function("__fs", fs_for(d)); ctx.add_init_script(FS_JS)
        pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(f"{m}: {e}")); pg.on("dialog", on_dialog); pg.on("console", lambda msg: errors.append(f"{m} CSP: {msg.text}") if "Content Security Policy" in msg.text else None)
        if init:   # seed the older database from a blank same-origin page first, so the app never races the seeding
            (appdir / "seed.html").write_text("<!doctype html><title>seed</title>"); pg.goto((appdir / "seed.html").as_uri()); pg.evaluate(init)
        pg.goto((appdir / "index.html").as_uri() + (q if q is not None else Q + m)); return pg
    def ready(pg): pg.wait_for_selector(".tile"); pg.evaluate("DASH.app.syncNow()"); pg.evaluate("DASH.app.flush()")
    def menu(pg, act): pg.click('.mtop:has-text("File")'); pg.click(f'[data-act="{act}"]')
    mac = page("mac"); ready(mac); before = mac.evaluate(TOT)
    check((data / "time-mac.json").exists(), "start: unencrypted folder works as in 00.02 (time-mac.json written)")
    # --- turn on encryption from the menu
    menu(mac, "encryption"); mac.wait_for_selector("#vaultsetup")
    check(mac.is_checked("#vs-remember"), "setup: 'Remember on this computer' is ticked by default"); mac.uncheck("#vs-remember")
    mac.fill("#vp1", "short"); mac.fill("#vp2", "short"); mac.click("#vs-ok")
    check("12 characters" in mac.inner_text("#vs-err"), "setup: a short passphrase is refused")
    mac.fill("#vp1", PASS1); mac.fill("#vp2", PASS1 + "x"); mac.click("#vs-ok"); check("don't match" in mac.inner_text("#vs-err"), "setup: mismatched passphrases refused")
    mac.fill("#vp2", PASS1); mac.click("#vs-ok"); mac.wait_for_selector("#rk-value", timeout=20000)
    rk = mac.inner_text("#rk-value").strip()
    check(not (data / "keyring.json").exists(), "setup: keyring is written only after the recovery key is acknowledged")
    check(mac.is_disabled("#rk-ok"), "setup: Continue stays disabled until 'I've stored it' is ticked")
    mac.check("#rk-done"); mac.click("#rk-ok"); mac.wait_for_function("() => !document.querySelector('#vaultrk')"); mac.evaluate("DASH.app.flush()")
    mac.wait_for_function("() => document.querySelector('#toast').textContent.startsWith('Data folder encrypted')", timeout=20000); mac.evaluate("DASH.app.flush()")
    names = sorted(os.listdir(data))
    check(names == ["inbox-snapshot.json.enc", "keyring.json", "notebook-log.js.enc", "time-mac.json.enc"], f"migration: only encrypted files + keyring remain ({names})")
    blob = "".join((data / n).read_text() for n in names)
    check(not any(s in blob for s in SECRETS) and "Owner/operator" not in blob and '"events"' not in blob, f"migration: no readable data in the folder (checked {len(SECRETS)} synthetic names, audience labels, event JSON)")
    check(mac.evaluate(TOT) == before, "migration: same time entries as before encryption")
    leaks, plain, o = cache_clean(mac)
    check(not leaks and not plain and o.get("cacheEncrypted") is True and "ownEvents" in o, f"cache: existing plaintext browser cache encrypted on unlock, no synthetic names readable (leaks={leaks[:3]}, plain keys={plain})")
    check("🔐" in mac.inner_text("#sync"), "sync chip shows the folder is encrypted")
    # --- reload: unlock dialog, wrong passphrase, remember
    mac.reload(); mac.wait_for_selector("#vaultunlock")
    check(mac.is_checked("#vault-remember"), "unlock: 'Remember on this computer' is ticked by default"); mac.uncheck("#vault-remember")
    mac.fill("#vault-pass", "not the passphrase"); mac.click("#vault-ok"); mac.wait_for_function("() => document.querySelector('#vault-err').textContent.includes('Wrong')", timeout=20000)
    check(True, "unlock: wrong passphrase shows 'Wrong passphrase.'")
    mac.fill("#vault-pass", PASS1); mac.check("#vault-remember"); mac.click("#vault-ok"); ready(mac)
    check(mac.evaluate(TOT) == before, "unlock: data reads back after reload")
    mac.reload(); mac.wait_for_selector(".tile"); check(mac.query_selector("#vaultunlock") is None, "remember: no passphrase asked on the next launch")
    ready(mac)
    # --- second machine: recovery key, new passphrase
    pc = page("workpc"); pc.wait_for_selector("#vaultunlock"); pc.click("#vault-userk")
    pc.fill("#vault-rk", rk.lower()); pc.fill("#vp1", PASS2); pc.fill("#vp2", PASS2); pc.click("#vault-ok"); ready(pc)
    check((data / "time-workpc.json.enc").exists() and not (data / "time-workpc.json").exists(), "workpc: unlocked with the recovery key; writes only time-workpc.json.enc")
    kr = json.loads((data / "keyring.json").read_text())
    check(kr.get("changed") is not None, "workpc: new passphrase saved in keyring.json")
    check(pc.evaluate(TOT) == mac.evaluate(TOT), "workpc and mac show identical entries")
    leaks, plain, _ = cache_clean(pc); check(not leaks and not plain, "cache: second machine's browser cache is encrypted from the first write")
    pc.evaluate("""(() => { const S = DASH.app.state; S.entries.push({ id: 'i-pc-enc', taskId: 'EX-2', eventId: null, date: '2026-10-19', minutes: 25, audience: 'Integrator/partner', subject: 'Training/education', account: 'Account D', source: 'manual', confirmed: true }); return DASH.app.commit(); })()""")
    pc.evaluate("DASH.app.flush()"); mac.evaluate("DASH.app.syncNow()")
    check(mac.evaluate("DASH.app.state.entries.some(e => e.id === 'i-pc-enc' && e.minutes === 25)"), "sync: an edit on workpc reaches mac through the encrypted file")
    mac.evaluate("(() => { const S = DASH.app.state; S.entries = S.entries.filter(e => e.id !== 'i-pc-enc'); return DASH.app.commit(); })()"); mac.evaluate("DASH.app.flush()")
    pc.evaluate("DASH.app.syncNow()")
    check(pc.evaluate("!DASH.app.state.entries.some(e => e.id === 'i-pc-enc')"), "sync: removal on mac wins on workpc (rules unchanged)")
    check("Account D" not in (data / "time-workpc.json.enc").read_text() + (data / "time-mac.json.enc").read_text(), "sync: time files stay unreadable on disk")
    # old passphrase no longer works for a fresh machine
    third = page("laptop2"); third.wait_for_selector("#vaultunlock"); third.fill("#vault-pass", PASS1); third.click("#vault-ok")
    third.wait_for_function("() => document.querySelector('#vault-err').textContent.includes('Wrong')", timeout=20000); check(True, "after the change: the old passphrase is refused")
    third.fill("#vault-pass", PASS2); third.click("#vault-ok"); ready(third); check(third.evaluate(TOT) == pc.evaluate(TOT), "after the change: the new passphrase opens it on a third machine")
    # --- plaintext snapshot dropped in later (e.g. by an exporter) is encrypted and removed
    snap2 = dict(snap, generated_at="2026-10-19T07:45:00-05:00"); (data / "inbox-snapshot.json").write_text(json.dumps(snap2))   # 00.09.001: before the 08:00 test clock (F1 refuses future-dated snapshots)
    mac.evaluate("DASH.app.syncNow()"); mac.evaluate("DASH.app.flush()")
    check(not (data / "inbox-snapshot.json").exists() and mac.evaluate("DASH.app.state.snap.raw_generated_at") == snap2["generated_at"], "new plaintext snapshot: encrypted, used, original deleted")
    # --- tamper
    f = data / "time-workpc.json.enc"; good = f.read_text(); o = json.loads(good); c = list(o["ct"]); c[10] = "A" if c[10] != "A" else "B"; o["ct"] = "".join(c); f.write_text(json.dumps(o))
    mac.evaluate("DASH.app.syncNow()")
    probs = mac.evaluate("DASH.app.state.problems.join(' | ')")
    check("can't be decrypted" in probs, f"tamper: damaged file reported ({probs[:90]})")
    f.write_text(good); mac.evaluate("DASH.app.syncNow()"); check(mac.evaluate("DASH.app.state.problems.length") == 0, "tamper: restored file reads again")
    # --- lock stops everything
    menu(mac, "encryption"); mac.wait_for_selector("#vaultmenu"); mac.click('[data-v="lock"]'); mac.wait_for_function("() => document.querySelector('#sync').textContent.includes('locked')")
    snapm = {n: (data / n).stat().st_mtime_ns for n in os.listdir(data)}
    mac.evaluate("(() => { const S = DASH.app.state; S.entries.push({ id: 'i-locked', date: '2026-10-19', minutes: 5, audience: 'Owner/operator', subject: 'Account strategy', source: 'manual', confirmed: true }); return DASH.app.commit(); })()")
    mac.evaluate("DASH.app.flush()"); mac.evaluate("DASH.app.syncNow()")
    check({n: (data / n).stat().st_mtime_ns for n in os.listdir(data)} == snapm and "locked" in mac.inner_text("#sync").lower(), "lock: nothing written while locked; chip says Data locked")
    leaks, plain, _ = cache_clean(mac); check(not leaks and not plain, "cache: an edit made while locked is not cached in plaintext")
    mac.reload(); mac.wait_for_selector("#vaultunlock"); check(True, "lock: also forgets the remembered key (passphrase asked again)")
    mac.click("#vault-later"); mac.wait_for_selector(".tile"); mac.evaluate("DASH.app.flush()")
    check(mac.evaluate("DASH.app.state.entries.filter(e => e.source === 'manual').length") == 0, "locked (Not now): nothing is read from the encrypted cache")
    leaks, plain, _ = cache_clean(mac); check(not leaks and not plain, "locked (Not now): nothing readable written to the cache")
    mac.reload(); mac.wait_for_selector("#vaultunlock"); mac.fill("#vault-pass", PASS2); mac.click("#vault-ok"); ready(mac)
    pc.evaluate("DASH.app.syncNow()")
    check(mac.evaluate("DASH.app.state.own.length") > 0 and mac.evaluate(TOT) == pc.evaluate(TOT), "unlock again: the encrypted cache and folder read back")
    check(not mac.evaluate("DASH.app.state.entries.some(e => e.id === 'i-locked')"), "an edit made while locked and then abandoned (reload) is not saved anywhere")
    # --- legacy browser cache + legacy time-log kind (synthetic names)
    app2 = tmp / "Dashboard2"; shutil.copytree(app, app2)
    (app2 / "config.local.js").write_text('Object.assign(window.DASH_CONFIG, { legacyDbNames: ["legacy-test-db"], legacyTimeKinds: ["legacy-time-log"], snapshotNames: ["legacy-snapshot.js"] });\n')
    d2 = tmp / "Data2"; d2.mkdir()
    (d2 / "legacy-snapshot.js").write_text("window.LEGACY_SNAPSHOT = " + json.dumps(snap) + ";\n")
    ev = json.loads(json.dumps(json.loads(subprocess.run(["node", "-e", """require('./js/sync.js'); const Y = globalThis.DASH.sync;
      const evs = Y.diff({entries:[],removedCal:[],domainMap:{}}, {entries:[{id:'i-old1',date:'2026-10-16',minutes:35,audience:'Owner/operator',subject:'Account strategy',source:'manual',confirmed:true}],removedCal:[],domainMap:{}}, 'oldpc', Y.clock());
      const evs2 = Y.diff({entries:[],removedCal:[],domainMap:{}}, {entries:[{id:'i-other1',date:'2026-10-16',minutes:20,audience:'Owner/operator',subject:'Account strategy',source:'manual',confirmed:true}],removedCal:[],domainMap:{}}, 'otherpc', Y.clock());
      console.log(JSON.stringify([evs, evs2]));"""], cwd=SRC, capture_output=True, text=True, check=True).stdout)))
    (d2 / "time-otherpc.json").write_text(json.dumps({"app": "x", "kind": "legacy-time-log", "version": 1, "machine": "otherpc", "updated_at": "2026-10-16T12:00:00Z", "events": ev[1]}))
    init = """() => new Promise(done => {
      const r = indexedDB.open('legacy-test-db', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { const t = r.result.transaction('kv', 'readwrite'), s = t.objectStore('kv'); s.put('oldpc', 'machine'); s.put(""" + json.dumps(ev[0]) + """, 'ownEvents'); s.put({ at: 'x', events: 0 }, 'migratedV2');
        t.oncomplete = () => { r.result.close(); done(true); }; }; })"""
    n0 = len(dialogs); lg = page("legacy", d=d2, appdir=app2, init=init, q="?now=2026-10-19T08:00:00-05:00&view=dashboard"); ready(lg)
    asked = [m for m in dialogs[n0:] if "older version" in m]
    check(lg.evaluate("DASH.app.state.machine") == "oldpc" and lg.query_selector("#machinedlg") is None, "legacy cache: machine name copied from the older browser database (no name prompt)")
    check(lg.evaluate("DASH.app.state.entries.some(e => e.id === 'i-old1' && e.minutes === 35)"), "legacy cache: older build's time events copied")
    check(lg.evaluate("DASH.app.state.entries.some(e => e.id === 'i-other1')"), "legacy time-log kind accepted from another machine's file")
    check(lg.evaluate("DASH.app.state.snap && !DASH.app.state.snap.example"), "legacy snapshot file name + older variable name read")
    leaks, plain, o = cache_clean(lg); check(isinstance(o.get("ownEvents"), list), "unencrypted folder: cache stays as in 00.02 (no key exists)")
    check((d2 / "time-oldpc.json").exists() and json.loads((d2 / "time-oldpc.json").read_text())["kind"] == "dash-time-log", "legacy: this machine writes the current format")
    lg.wait_for_function("() => DASH.db.get('legacyImported').then(x => !!(x && x.deleted))", timeout=15000)
    check(len(asked) == 1 and "all match" in asked[0] and "legacy-test-db" not in lg.evaluate(DBS), "legacy delete: verified copy → one confirm → OK deletes the old database")
    check(lg.evaluate("DASH.db.get('legacyImported').then(x => !!x.deleted)") and lg.evaluate("DASH.app.state.entries.some(e => e.id === 'i-old1')"), "legacy delete: data still there after the old copy is gone")
    # decline: kept, not asked again; then a failed verification gives no offer
    DLG["accept"] = False; n0 = len(dialogs)
    dc = page("decline", d=d2, appdir=app2, init=init, q="?now=2026-10-19T08:00:00-05:00&view=dashboard"); ready(dc)
    dc.wait_for_function("() => DASH.db.get('legacyImported').then(x => !!(x && x.declined))", timeout=15000)
    check(len([m for m in dialogs[n0:] if "older version" in m]) == 1 and "legacy-test-db" in dc.evaluate(DBS), "legacy decline: Cancel keeps the old database")
    dc.wait_for_function("() => DASH.db.get('legacyImported').then(x => !!(x && x.declined))", timeout=15000)
    n1 = len(dialogs); dc.reload(); ready(dc); check(len(dialogs) == n1, "legacy decline: not asked again")
    dc.evaluate("(async () => { const i = await DASH.db.get('legacyImported'); delete i.declined; await DASH.db.set('legacyImported', i); await DASH.db.set('audienceRules', { domainMap: { 'tampered.example': 'Owner/operator' } }); })()")
    check(dc.evaluate("DASH.db.verifyLegacy('legacy-test-db').then(v => v.ok)") is False, "legacy verify: a value that differs fails the check")
    n2 = len(dialogs); dc.reload(); ready(dc)
    check(len(dialogs) == n2 and "legacy-test-db" in dc.evaluate(DBS) and "doesn't match" in dc.inner_text("#banner"), "legacy verify failed: no delete offer, old database kept, banner shown")
    DLG["accept"] = True
    # encrypted folder: copied cache is encrypted on unlock, verified through decryption, then offered for deletion
    d3 = tmp / "Data3"; shutil.copytree(data, d3); n0 = len(dialogs)
    le = page("legacyenc", d=d3, appdir=app2, init=init, q="?now=2026-10-19T08:00:00-05:00&view=dashboard"); 
    le.wait_for_selector("#vaultunlock"); le.fill("#vault-pass", PASS2); le.click("#vault-ok"); ready(le)
    le.wait_for_function("() => DASH.db.get('legacyImported').then(x => !!(x && x.deleted))", timeout=15000)
    asked = [m for m in dialogs[n0:] if "older version" in m]
    check(len(asked) == 1 and "now stored encrypted" in asked[0] and "legacy-test-db" not in le.evaluate(DBS), "legacy + encrypted folder: verified after encryption, OK deletes the old database")
    leaks, plain, _ = cache_clean(le); check(not leaks and not plain and le.evaluate("DASH.app.state.entries.some(e => e.id === 'i-old1')"), "legacy + encrypted folder: copied data kept, cache has no plaintext")
    b.close()
check(not errors, "no page errors" + (f": {errors[:3]}" if errors else ""))
print("T21 PASS" if ok else "T21 FAIL"); sys.exit(0 if ok else 1)
