"""T37 (00.11.001): automatic saves, durable pending queue, retry with backoff, reload/update never drops pending saves.  Built on the T36 setup.
T36 (00.11.000): time tracking, Log Touch, Agenda, Quick Launch and Copy for manager.  Fictional data only.
Real encrypted folder: the snapshot's time block merges by id on unlock (unknown account -> review, never dropped; the same id from a
newer snapshot is a correction; a repeat adds nothing); time-store.json.enc only, never plaintext; the IndexedDB cache is an encrypted
envelope; a running timer survives a reload; Stop and Add past log entries; Export local data holds no time store and no opened
snapshot.  EXAMPLE DATA: timer idle / running / red no-account, Add past, time report week and month with group filters, Agenda week,
day and month (today pinned on its real weekday, CT times, red flags, flight and hotel blocks, no empty band), Quick Launch (seven equal
buttons), Copy for manager (ticks, plain-text preview with two spaces kept and no Restricted line, .md and Word labelled), Log Touch
(four types, Also add to time log), iPad width.  argv[1]: shots dir.  The manager name is the fictional placeholder "Sam Lee" (never from the environment)."""
import pathlib, shutil, tempfile, json, os, sys, time, zipfile, io
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True; errors = []
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(tempfile.mkdtemp(prefix="dash-t36-")); SHOTS.mkdir(parents=True, exist_ok=True)
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
PASS = "correct horse battery 10000"; MGR = "Sam Lee"   # QA M5: a fictional placeholder only; never read from the environment
FS_JS = (SRC / "tests/t21_vault.py").read_text().split('FS_JS = """', 1)[1].split('"""', 1)[0]
tmp = pathlib.Path(tempfile.mkdtemp()); app = tmp / "Dashboard"; shutil.copytree(SRC, app, ignore=shutil.ignore_patterns("tests", ".git"))
(app / "config.local.js").write_text("Object.assign(window.DASH_CONFIG, " + json.dumps({"managerName": MGR, "internalAccountLabel": "Internal (Example Co)"}) + ");\n")
snap = json.loads((app / "examples/example-snapshot.json").read_text()); snap.pop("example"); snap["generated_at"] = "2026-11-02T07:30:00-06:00"
E1 = {"id": "T-20261102-0a1b2c3d", "date": "2026-11-02", "start": "06:30", "minutes": 90, "group": "travel", "type": "driving", "account": "Acme Fab", "project": None, "notes": "secretnote drive to site", "x_text": "90m drive, Travel, Acme"}
E2 = {"id": "T-20261102-0a1b2c3e", "date": "2026-11-02", "start": None, "minutes": 45, "group": "relationship", "type": "meal", "account": "Mystery Example Co", "project": None, "notes": "", "x_text": "45m lunch"}
snap["time"] = {"schema_version": 1, "generated_at": "2026-11-02T07:00:00-06:00", "source": "assistant-texts", "entries": [E1, E2]}
data = tmp / "Data"; data.mkdir(); (data / "inbox-snapshot.json").write_text(json.dumps(snap))
def fs(op, name, text):
    if op == "list": return sorted(x for x in os.listdir(data) if not x.endswith(".crswap"))
    pth = data / name
    if op == "read":
        if not pth.exists(): return None
        s2 = pth.stat(); return {"m": int(s2.st_mtime_ns // 1_000_000), "size": s2.st_size, "text": pth.read_text()}
    if op == "write" and FAIL["on"] and name.startswith("time-"): raise Exception("NoModificationAllowedError: file locked (test)")
    if op == "write": t3 = data / f"{name}.{os.getpid()}-{time.time_ns()}.crswap"; t3.write_text(text); os.replace(t3, pth); return True
    if op == "remove": pth.unlink(missing_ok=True); return True
FAIL = {"on": False}
def folder_text(): return "".join((data / n).read_text(errors="ignore") for n in os.listdir(data) if (data / n).is_file())
def sync(pg): pg.evaluate("DASH.app.syncNow()"); pg.evaluate("DASH.app.flush()")
def until(pg, pred, what, limit=60):
    t0 = time.time()
    while True:
        sync(pg)
        try:
            if pred(): return True
        except Exception: pass
        if time.time() - t0 > limit: print("WAIT TIMEOUT " + what); return False
        pg.wait_for_timeout(100)
live = lambda pg: pg.evaluate("DASH.app.timeOps.tEntries()")
def unlock(pg):   # a fresh browser asks for the passphrase; a remembered key doesn't
    pg.wait_for_function("() => document.querySelector('#vaultunlock') || (DASH.app && DASH.app.state.vault && DASH.app.state.vault.key)", timeout=60000)
    if pg.query_selector("#vaultunlock"): pg.fill("#vault-pass", PASS); pg.click("#vault-ok")
    pg.wait_for_function("() => DASH.app.state.vault.key", timeout=60000)
Q = lambda t: f"?now=2026-11-02T{t}:00-06:00&machine=desk1&view=dashboard"
with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------- A. real encrypted folder ----------
    c = b.new_context(viewport={"width": 1440, "height": 900}); c.expose_function("__fs", fs); c.add_init_script(FS_JS)
    pg = c.new_page(); pg.on("pageerror", lambda e: errors.append(str(e))); pg.on("dialog", lambda d: d.accept()); pg.goto((app / "index.html").as_uri() + Q("08:00"))
    pg.wait_for_selector("#timereport .trcard", timeout=60000); sync(pg)
    check(live(pg) == [] and not (data / "time-store.json.enc").exists() and not (data / "time-store.json").exists(), "plain folder: the snapshot's time entries are not saved anywhere until the folder is encrypted")
    check("Not saved until the Data folder is encrypted" in pg.inner_text("#timerbar"), "the timer bar says time isn't saved until the folder is encrypted")
    pg.click('.mtop:has-text("File")'); pg.click('[data-act="encryption"]'); pg.wait_for_selector("#vaultsetup"); pg.fill("#vp1", PASS); pg.fill("#vp2", PASS); pg.click("#vs-ok")
    pg.wait_for_selector("#rk-value", timeout=60000); pg.check("#rk-done"); pg.click("#rk-ok"); pg.wait_for_function("() => document.querySelector('#toast').textContent.startsWith('Data folder encrypted')", timeout=60000)
    c.close(); c = b.new_context(viewport={"width": 1440, "height": 900}); c.expose_function("__fs", fs); c.add_init_script(FS_JS)   # a second browser on the same folder: unlock
    def open_pg(t):
        pg = c.new_page(); pg.on("pageerror", lambda e: errors.append(str(e))); pg.on("dialog", lambda d: d.accept()); pg.goto((app / "index.html").as_uri() + Q(t)); unlock(pg); sync(pg); pg.wait_for_timeout(800); sync(pg); return pg
    pg = open_pg("08:05")
    FOLDER = "(async()=>{try{const f=await (await window.DASH_TEST_FS.getFileHandle('time-store.json.enc')).getFile(); const o=JSON.parse(await DASH.vault.decrypt(DASH.app.state.vault.key, DASH.app.state.vault.kr, await f.text(),'timestore')); return Object.values(o.entries).filter(e=>!e.deleted).length}catch(e){return -1}})()"
    base = pg.evaluate(FOLDER)
    STOPPED = "(async()=>{await DASH.app.timeOps.timerStart({group:'work',type:'research',account:'Internal',project:null,started_at:'2026-11-02T13:00:00Z'}); await DASH.app.timeOps.timerStop();})()"
    # 1. automatic save: no sync step
    pg.evaluate(STOPPED); pg.wait_for_timeout(1500)
    check(pg.evaluate(FOLDER) == base + 1, "a time entry reaches time-store.json.enc on its own (no manual sync)")
    # 2. failed save: queued durably (encrypted), counted once, chip is status only
    FAIL["on"] = True; pg.evaluate(STOPPED); pg.wait_for_timeout(1500)
    q = pg.evaluate("localStorage.getItem('dash-pending-v1')")
    check(bool(q) and '"kind":"dash-encrypted"' in q and "Internal" not in q, "a failed save is parked in the pending queue, encrypted only")
    check("retrying save" in pg.inner_text("#sync"), "the sync chip shows the retry as a status")
    # 3. reload while the folder is still failing: not refused, nothing lost
    pg.click('.mtop:has-text("File")'); pg.click('[data-act="reload"]'); pg.wait_for_timeout(1500)
    check("saves failed" not in pg.inner_text("#banner"), "Reload parks pending saves and reloads instead of refusing")
    pg.close(); pg = open_pg("08:10")
    check(len(live(pg)) == base + 2, "the unsaved entry survives the reload (restored from the encrypted pending queue)")
    # 4. retries on its own with backoff once the folder works again
    FAIL["on"] = False   # backoff 5, 15, 30 s...: wait up to 90 s for the automatic retry (no sync call here)
    t0 = time.time()
    while time.time() - t0 < 90 and not (pg.evaluate(FOLDER) == base + 2 and pg.evaluate("localStorage.getItem('dash-pending-v1')") is None): pg.wait_for_timeout(1000)
    check(pg.evaluate(FOLDER) == base + 2, "the queued save retries on its own and reaches the folder")
    check(pg.evaluate("localStorage.getItem('dash-pending-v1')") is None and "retrying save" not in pg.inner_text("#sync"), "the queue clears and the chip returns to normal after the retry")
    # 5. Log Touch saves automatically
    pg.evaluate("DASH.app.timeOps.logTouch(null, {type:'call', account:'Internal', minutes: 15})"); pg.wait_for_selector("#touchdlg")
    btn = pg.query_selector('#touchdlg button.primary'); btn.click(); pg.wait_for_timeout(1500)
    check(pg.evaluate(FOLDER) == base + 3, "Log Touch (Also add to time log) saves to the folder on its own")
    # 6. IndexedDB connection closed under the app: reopened on its own, the save goes through, nothing counted as failed
    pg.evaluate("""(() => { const t = IDBDatabase.prototype.transaction; let once = true;
      IDBDatabase.prototype.transaction = function (...a) { if (once && a[1] === 'readwrite') { once = false; this.close(); } return t.apply(this, a); }; })()""")
    n0 = pg.evaluate("DASH.db.reopenCount()"); pg.evaluate(STOPPED); pg.wait_for_timeout(2000)
    check(pg.evaluate("DASH.db.reopenCount()") > n0, "a closed IndexedDB connection is reopened automatically")
    check(pg.evaluate("DASH.db.get('timeStore').then(s => Object.values(s.entries).filter(e => !e.deleted).length)") == base + 4 and pg.evaluate(FOLDER) == base + 4, "after the reopen the entry is in the cache and the folder")
    check("retrying save" not in pg.inner_text("#sync") and not pg.evaluate("DASH.app.state.saveProblems.write"), "no save problem is left after the reopen")
    # 7. connection closed while saves are queued: the reopen triggers the retry at once
    FAIL["on"] = True; pg.evaluate(STOPPED); pg.wait_for_timeout(1500); FAIL["on"] = False
    pg.evaluate("""(() => { const t = IDBDatabase.prototype.transaction; let once = true;
      IDBDatabase.prototype.transaction = function (...a) { if (once && a[1] === 'readwrite') { once = false; this.close(); } return t.apply(this, a); }; })()""")
    pg.evaluate("DASH.db.set('prefs', {t37: 1})")
    t0 = time.time()
    while time.time() - t0 < 4 and pg.evaluate(FOLDER) != base + 5: pg.wait_for_timeout(200)   # well before the 5 s backoff
    check(pg.evaluate(FOLDER) == base + 5 and pg.evaluate("localStorage.getItem('dash-pending-v1')") is None, "a reopen retries the queued save right away (before the backoff timer)")
    c.close(); b.close()
check(not errors, "no page errors " + "; ".join(errors[:3]))
print("T37 " + ("PASSED" if ok else "FAILED")); sys.exit(0 if ok else 1)
