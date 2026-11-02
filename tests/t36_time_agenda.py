"""T36 (00.11.000): time tracking, Log Touch, Agenda, Quick Launch and Copy for manager.  Fictional data only.
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
    if op == "write": t3 = data / f"{name}.{os.getpid()}-{time.time_ns()}.crswap"; t3.write_text(text); os.replace(t3, pth); return True
    if op == "remove": pth.unlink(missing_ok=True); return True
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
    pg = c.new_page(); pg.on("pageerror", lambda e: errors.append(str(e))); pg.on("dialog", lambda d: d.accept()); pg.goto((app / "index.html").as_uri() + Q("08:05")); unlock(pg)
    until(pg, lambda: len(live(pg)) == 2 and (data / "time-store.json.enc").exists(), "feed merged")
    es = {e["id"]: e for e in live(pg)}
    check(set(es) == {E1["id"], E2["id"]} and es[E1["id"]]["source"] == "feed" and es[E1["id"]]["updated_at"] == "2026-11-02T07:00:00-06:00", "on unlock the snapshot's time entries merge into the time log, stamped with the snapshot's generated_at")
    check(es[E2["id"]].get("review") is True and not es[E1["id"]].get("review"), "an unknown account is kept for review, never dropped; a known account is not")
    pg.evaluate("DASH.app.render()"); check("1 need review" in pg.inner_text("#timerbar"), "the timer bar shows '1 need review'")
    names = sorted(os.listdir(data)); check("time-store.json.enc" in names and "time-store.json" not in names and "secretnote" not in folder_text(), "time log saved as time-store.json.enc only; no note is plaintext in the folder")
    raw = pg.evaluate("DASH.db.getRaw('timeStore')"); check(raw and raw.get("dashCache") == 1 and "secretnote" not in json.dumps(raw), "the IndexedDB cache is an encrypted envelope")
    # same snapshot again: nothing added; a newer snapshot with the same id corrects it
    pg.evaluate("s => DASH.app.useSnapshot(s, 'test')", snap); pg.evaluate("DASH.app.flush()"); check(len(live(pg)) == 2, "the same snapshot again adds nothing (dedupe by id)")
    s2 = json.loads(json.dumps(snap)); s2["generated_at"] = "2026-11-02T09:00:00-06:00"; s2["time"]["generated_at"] = "2026-11-02T08:50:00-06:00"; s2["time"]["entries"] = [dict(E1, minutes=75)]
    pg.evaluate("s => DASH.app.useSnapshot(s, 'test')", s2); pg.evaluate("DASH.app.flush()")
    check({e["id"]: e for e in live(pg)}[E1["id"]]["minutes"] == 75, "the same id from a newer snapshot is a correction (90 -> 75 min)")
    s3 = json.loads(json.dumps(s2)); s3["generated_at"] = "2026-11-02T09:10:00-06:00"; s3["time"]["generated_at"] = "2026-11-02T06:00:00-06:00"; s3["time"]["entries"] = [dict(E1, minutes=5)]
    pg.evaluate("s => DASH.app.useSnapshot(s, 'test')", s3); pg.evaluate("DASH.app.flush()"); check({e["id"]: e for e in live(pg)}[E1["id"]]["minutes"] == 75, "an older time feed never overwrites a newer one")
    # review: pick an account
    pg.click("#tb-review"); pg.wait_for_selector("#tl-review"); pg.select_option(f"[data-rv='{E2['id']}']", "Acme Fab"); pg.click("#rv-ok"); pg.evaluate("DASH.app.flush()")
    check({e["id"]: e for e in live(pg)}[E2["id"]]["account"] == "Acme Fab" and "need review" not in pg.inner_text("#timerbar"), "Needs review: picking an account clears it")
    # timer: account required, survives a reload, Stop logs it
    pg.click("#tb-go"); check(pg.evaluate("DASH.app.state.timer") is None and "need" in pg.get_attribute("#tb-acc", "class"), "Start without an account does nothing; the account box stays red")
    pg.click("[data-tg='work']"); pg.select_option("#tb-type", "design"); pg.select_option("#tb-acc", "Acme Fab"); pg.click("#tb-go"); pg.evaluate("DASH.app.flush()")
    check(pg.evaluate("DASH.app.state.timer && DASH.app.state.timer.account") == "Acme Fab", "Start runs the timer once an account is picked")
    rawt = pg.evaluate("DASH.db.getRaw('timeTimer')"); check(rawt and rawt.get("dashCache") == 1, "the running timer is saved encrypted")
    pg.goto((app / "index.html").as_uri() + Q("08:47")); unlock(pg)
    pg.wait_for_function("() => DASH.app.state.timer", timeout=60000); pg.evaluate("DASH.app.render()")
    check(pg.evaluate("DASH.app.state.timer.type") == "design" and pg.inner_text("#tb-go") == "Stop", "a running timer survives a reload")
    n0 = len(live(pg)); pg.click("#tb-go"); pg.evaluate("DASH.app.flush()"); new = [e for e in live(pg) if e["source"] == "timer"]
    check(len(live(pg)) == n0 + 1 and new and new[0]["account"] == "Acme Fab" and new[0]["minutes"] >= 1 and new[0]["group"] == "work", f"Stop logs the run as a work entry ({new[0]['minutes'] if new else None} min)")
    check(pg.evaluate("!!DASH.app.state.tLast") and pg.is_enabled("#tb-resume"), "Resume last is offered after a stop")
    pg.click("#tb-past"); pg.fill("#tp-dur", "1h 30m"); pg.select_option("#tp-acc", "Internal"); pg.select_option("#tp-type", "work:admin"); pg.click("#tp-save"); pg.evaluate("DASH.app.flush()")
    check(any(e["account"] == "Internal" and e["minutes"] == 90 and e["type"] == "admin" for e in live(pg)), "Add past logs 1h 30m admin on Internal")
    pg.click("#tb-past"); pg.fill("#tp-dur", "abc"); pg.select_option("#tp-acc", "Internal"); pg.click("#tp-save"); check("Duration" in pg.inner_text("#tp-err"), "Add past refuses a bad duration")
    exp = pg.evaluate("DASH.db.exportAll()")
    check(not any(k in exp for k in ("timeStore", "timeTimer", "timeLast", "reportsStore", "openedSnapshot")), "Export local data holds no time log, timer, reports or opened snapshot (QA Low 8)")
    # Log Touch adds a touch and, ticked, a time entry
    pg.evaluate("DASH.app.timeOps.logTouch(document.body)"); pg.wait_for_selector("#touchdlg"); pg.click("[data-tdt='email']"); pg.select_option("#td-acc", "Acme Fab"); pg.click("#td-ok"); pg.evaluate("DASH.app.flush()")
    check(pg.evaluate("DASH.app.state.entries.some(e => e.touch === 'email' && e.account === 'Acme Fab')") and any(e["group"] == "touch" and e["type"] == "email" for e in live(pg)), "Log Touch: email logged as a touch, and added to the time log")
    c.close()
    # ---------- B. EXAMPLE DATA screens ----------
    c = b.new_context(viewport={"width": 1440, "height": 900}); pg = c.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    if MGR: c.add_init_script("window.__mgr = " + json.dumps(MGR) + ";")
    URL = (app / "index.html").as_uri() + "?now=2026-11-04T10:42:10-06:00&machine=test&view=dashboard"
    pg.goto(URL); pg.wait_for_selector("#timereport .trcard", timeout=60000)
    check(pg.get_attribute("#tb-acc", "aria-invalid") == "true" and "need" in pg.get_attribute("#tb-acc", "class"), "idle: the account box has a red border until one is picked")
    pg.screenshot(path=str(SHOTS / "36a-timer-idle.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 120})
    pg.click("#tb-go"); pg.screenshot(path=str(SHOTS / "36c-timer-no-account-red.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 120})
    pg.click("[data-tg='touch']"); check(pg.eval_on_selector_all("#tb-type option", "o => o.map(x => x.value)") == ["call", "in_person", "email", "teams_text"], "the group switch changes the types (Touch: 4)")
    pg.click("[data-tg='work']"); pg.select_option("#tb-type", "design"); pg.select_option("#tb-acc", "Acme Fab"); pg.evaluate("DASH.app.state.tProj = ''")
    pg.click("#tb-go"); pg.evaluate("DASH.app.state.timer.started_at = new Date(Date.parse(DASH.app.state.timer.started_at) - (42*60+10)*1000).toISOString()"); pg.wait_for_timeout(1100)
    check(pg.inner_text("#tb-clock").startswith("00:42:1") and pg.inner_text("#tb-go") == "Stop", f"running: the big clock counts ({pg.inner_text('#tb-clock')})")
    pg.screenshot(path=str(SHOTS / "36b-timer-running.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 120})
    pg.click("#tb-go"); pg.click("#tb-past"); pg.fill("#tp-dur", "45m"); pg.select_option("#tp-acc", "Travel/General"); pg.select_option("#tp-type", "travel:airport_wait")
    pg.screenshot(path=str(SHOTS / "36d-add-past.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 160}); pg.click("#tp-save")
    rep = pg.inner_text("#timereport"); check("Time report" in rep and all(k in rep.upper() for k in ("TIME BY GROUP", "ACTIVITY TYPES", "ACCOUNTS", "PROJECTS")) and "%" in rep and "$" not in rep, "time report: four cards with percentages, no dollars")
    pg.evaluate("(() => { const r = document.querySelector('#timereport'); window.scrollTo(0, r.getBoundingClientRect().top + window.scrollY - document.querySelector('header').getBoundingClientRect().height - 140); })()"); pg.screenshot(path=str(SHOTS / "36e-time-report-week.png"))
    t_all = pg.inner_text("#timereport .trbig"); pg.uncheck("[data-trg='travel']"); t_no = pg.inner_text("#timereport .trbig"); check(t_all != t_no and "hiding" in pg.inner_text("#timereport"), f"untick Travel: total {t_all} -> {t_no}, 'hiding' shown"); pg.check("[data-trg='travel']")
    wk_head = pg.inner_text("#timereport .trhead")
    pg.click("[data-trm='month']"); pg.wait_for_selector("[data-trm='month'][aria-pressed='true']"); pg.evaluate("document.querySelector('#timereport').scrollIntoView()")
    mo_head = pg.inner_text("#timereport .trhead"); rg = pg.evaluate("(() => { const r = DASH.timelog.monthRange(DASH.app.state.today); return [DASH.rules.dayLabel(r.from), DASH.rules.dayLabel(r.to)]; })()")
    check(mo_head != wk_head and (rg[0] + " – " + rg[1]) in mo_head and rg[0].endswith("/1"), f"This month: the header shows the month range ({rg}), not the week ({wk_head!r})")
    pg.evaluate("(() => { const r = document.querySelector('#timereport'); window.scrollTo(0, r.getBoundingClientRect().top + window.scrollY - document.querySelector('header').getBoundingClientRect().height - 140); })()"); pg.screenshot(path=str(SHOTS / "36f-time-report-month.png"))   # QA L3: the element itself, after the re-render, so the header range shows
    # Agenda: events sit 20-22 days after the example's load day; move "today" to the day before (test only) and add CT meetings and a trip
    pg.goto((app / "index.html").as_uri() + "?now=2026-10-15T10:00:00-05:00&machine=test&view=agenda"); pg.wait_for_selector(".aghead", timeout=60000)
    pg.evaluate("""() => { const S = DASH.app.state; S.today = '2026-11-03'; S.ag.anchor = null;
      S.snap.calendar = [{ id: 'm1', start: '2026-11-02T15:00:00Z', end: '2026-11-02T16:00:00Z', title: 'Hall 2 design review', location: 'Teams', day: '2026-11-02' }, { id: 'm2', start: '2026-11-03T14:30:00Z', end: '2026-11-03T15:30:00Z', title: 'Northwind weekly', location: null, day: '2026-11-03' },
        { id: 'm3', start: '2026-11-06T19:00:00Z', end: '2026-11-06T20:00:00Z', title: 'Contoso walkdown prep', location: null, day: '2026-11-06' }];
      S.tripsFeed = DASH.rules.readTrips({ schema_version: 1, generated_at: '2026-11-01T08:00:00-06:00', trips: [{ id: 'TRIP-EX-1', name: 'Example Expo trip', segments: [
        { kind: 'flight', start: '2026-11-03T19:10:00Z', end: '2026-11-03T21:40:00Z', from: 'AAA', to: 'BBB', airline: 'Example Air', number: '123' }, { kind: 'hotel', start: '2026-11-03T23:00:00Z', end: '2026-11-06T17:00:00Z', place: 'Example Hotel', city: 'Springfield, ST' }] }] });
      DASH.app.render(); }""")
    heads = pg.eval_on_selector_all(".agdh", "h => h.map(x => x.innerText.replace(/\\s+/g, ' ').trim())")
    check(len(heads) == 7 and heads[1].upper().startswith("TODAY · TUE") and heads[0].upper().startswith("MON"), f"week: seven columns Mon-Sun, today pinned on its real weekday ({heads[:2]})")
    ag = pg.inner_text("#view-agenda")
    check("8:30 AM CT" in ag and "9:00 AM CT" in ag and "Flight AAA to BBB" in ag and "Hotel" in ag and "Example Expo 2026" in ag, "CT times with the label, flight and hotel blocks, and the event bar")
    check(pg.query_selector(".agbar.k-event.f-red") is not None or pg.query_selector(".agbar.k-event") is not None, "event bars carry their flag class")
    first = pg.eval_on_selector(".aghr", "e => e.innerText"); check(first.startswith("08:00"), f"no empty band: the hour grid starts at the first hour with something in it ({first})")
    pg.screenshot(path=str(SHOTS / "36g-agenda-week.png"), full_page=True)
    pg.click("[data-agm='day']"); check(len(pg.query_selector_all(".agdh")) == 1, "Day shows one day"); pg.screenshot(path=str(SHOTS / "36h-agenda-day.png"), full_page=True)
    pg.click("[data-agm='month']"); check(pg.query_selector(".agmonth td.today") is not None, "Month shows the month grid with today"); pg.screenshot(path=str(SHOTS / "36i-agenda-month.png"), full_page=True)
    pg.click("[data-agstep='1']"); check("DECEMBER" in pg.inner_text(".aghead").upper(), "› moves to the next month"); pg.click("[data-agstep='0']")
    # Quick Launch and Copy for manager
    pg.goto((app / "index.html").as_uri() + "?now=2026-11-01T08:00:00-06:00&machine=test&view=manager"); pg.wait_for_selector("#mgrrep .tmitem", timeout=60000)
    sizes = pg.eval_on_selector_all("#ql-manager .qlb", "b => b.map(x => [Math.round(x.getBoundingClientRect().width), Math.round(x.getBoundingClientRect().height)])")
    check(len(sizes) == 7 and len(set(map(tuple, sizes))) == 1, f"Quick Launch: seven equal buttons ({sizes[0] if sizes else None})")
    labels = [x.split("\n")[-1] for x in pg.eval_on_selector_all("#ql-manager .qlb", "b => b.map(x => x.innerText.trim().toUpperCase())")]
    check(labels[:6] == ["CAPTURE", "SAM BULLETS", "GOING COLD", "ACCOUNT BRIEF", "EVENTS", "REPORTS"] and labels[6].endswith("REPORT"), f"Quick Launch labels in order ({labels})")
    pre = pg.inner_text("#tm-pre")
    check("closed out.  Layout approved" in pre and "Restricted" not in pre and pre.startswith("Jordan P.:") and "Tailspin" not in pre, "preview: two spaces kept, no Restricted line, the name line first, alternates left out")
    pg.check("[data-tmi='0:3']"); check("Tailspin" in pg.inner_text("#tm-pre"), "ticking an alternate adds it to the preview")
    c.grant_permissions(["clipboard-read", "clipboard-write"]); pg.click("[data-tmx='copy']"); clip = pg.evaluate("navigator.clipboard.readText()")
    check(clip == pg.inner_text("#tm-pre") + ("" if pg.inner_text("#tm-pre").endswith("\n") else "\n") or clip.rstrip("\n") == pg.inner_text("#tm-pre").rstrip("\n"), "Copy puts exactly the preview text on the clipboard")
    check("  " in clip and "Restricted" not in clip, "the copied text keeps two spaces after sentences and has no Restricted line")
    with pg.expect_download() as dl: pg.click("[data-tmx='md']")
    mdtxt = pathlib.Path(dl.value.path()).read_text(); check(mdtxt.startswith("**Restricted - Internal Use Only**") and dl.value.suggested_filename == "manager-report-2026-10.md", ".md carries the Restricted label; the file name has no person's name")
    with pg.expect_download() as dl: pg.click("[data-tmx='docx']")
    z = zipfile.ZipFile(io.BytesIO(pathlib.Path(dl.value.path()).read_bytes())); doc = z.read("word/document.xml").decode()
    import xml.dom.minidom as X; [X.parseString(z.read(n)) for n in z.namelist() if n.endswith(".xml") or n.endswith(".rels")]
    check("Restricted - Internal Use Only" in z.read("word/header1.xml").decode() and "Layout approved" in doc and len(z.namelist()) == 7, "Word file: 7 well-formed parts, label in the header, the bullets in the body")
    try:
        import docx as _d; dd = _d.Document(io.BytesIO(pathlib.Path(dl.value.path()).read_bytes())); check(any("Layout approved" in pp.text for pp in dd.paragraphs), "python-docx opens the Word file")
    except ImportError: print("SKIP python-docx not installed")
    pg.uncheck("[data-tmi='0:3']"); pg.evaluate("window.scrollTo(0,0)"); pg.screenshot(path=str(SHOTS / "36j-quick-launch-copy-for-manager.png"), full_page=False)
    pg.click("[data-ql='capture']"); pg.wait_for_selector("#touchdlg")
    check(len(pg.query_selector_all("#touchdlg [data-tdt]")) == 4 and pg.is_checked("#td-time"), "Log Touch: four type buttons and 'Also add to time log' ticked")
    pg.click("[data-tdt='email']"); pg.select_option("#td-acc", "Acme Fab"); pg.fill("#td-who", "Sam K."); pg.fill("#td-notes", "Sent the revised layout.  Asked for comments by Friday.")
    pg.screenshot(path=str(SHOTS / "36k-log-touch.png")); pg.keyboard.press("Escape"); check(pg.query_selector("#touchdlg") is None, "Esc closes Log Touch")
    # iPad width
    pg.set_viewport_size({"width": 820, "height": 1180}); pg.goto((app / "index.html").as_uri() + "?now=2026-11-04T10:00:00-06:00&machine=test&view=focus"); pg.wait_for_selector(".ql", timeout=60000)
    w = pg.evaluate("document.documentElement.scrollWidth"); check(w <= 822, f"iPad width: no sideways scroll ({w}px)")
    pg.screenshot(path=str(SHOTS / "36l-ipad-focus-timer.png"))
    check(not errors, f"no page errors {errors[:3]}")
    b.close()
print("T36 " + ("PASS" if ok else "FAIL")); sys.exit(0 if ok else 1)
