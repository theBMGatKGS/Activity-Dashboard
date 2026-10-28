"""T20 (00.02): two simulated machines ("mac", "workpc") share time through the Data folder.
The browser folder picker can't be driven headlessly, so each page gets a test-only stand-in for the granted
FileSystemDirectoryHandle (window.DASH_TEST_FS) backed by a real temp folder; OneDrive is simulated by copying files.
Checks: one-time migration, offline concurrent edits, conflict copies, unreadable files, identical totals,
each machine writes only its own file, sync chip. Fictional example data only."""
import pathlib, shutil, tempfile, json, os
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
FS_JS = """(() => { const nf = () => { const e = new Error('not found'); e.name = 'NotFoundError'; return e; };
  const fh = n => ({ kind: 'file', name: n, async getFile() { const r = await window.__fs('read', n, ''); if (!r) throw nf(); return { lastModified: r.m, size: r.size, text: async () => r.text }; },
    async createWritable() { let buf = ''; return { write: async t => { buf += t; }, close: async () => { await window.__fs('write', n, buf); } }; } });
  window.DASH_TEST_FS = { kind: 'directory', name: 'Data', queryPermission: async () => 'granted',
    async *entries() { for (const f of await window.__fs('list', '', '')) yield [f, fh(f)]; },
    async getFileHandle(n, o) { const l = await window.__fs('list', '', ''); if (!l.includes(n) && !(o && o.create)) throw nf(); return fh(n); } }; })();"""
tmp = pathlib.Path(tempfile.mkdtemp()); app = tmp / "Dashboard"; shutil.copytree(SRC, app, ignore=shutil.ignore_patterns("tests"))
snap = json.loads((app / "examples/example-snapshot.json").read_text()); snap.pop("example")
dirs = {m: tmp / f"{m}-Data" for m in ("mac", "workpc")}
for d in dirs.values(): d.mkdir(); (d / "inbox-snapshot.json").write_text(json.dumps(snap))
writes = {m: [] for m in dirs}
def fs_for(m):
    d = dirs[m]
    def fs(op, name, text):
        if op == "list": return sorted(os.listdir(d))
        p = d / name
        if op == "read":
            if not p.exists(): return None
            st = p.stat(); return {"m": int(st.st_mtime_ns // 1_000_000), "size": st.st_size, "text": p.read_text()}
        if op == "write":
            writes[m].append(name); t = d / (name + ".crswap"); t.write_text(text); os.replace(t, p); return True
    return fs
Q = "?now=2026-10-19T08:00:00-05:00&view=dashboard&machine="
TOT = """(() => { const R = DASH.rules, S = DASH.app.state; const w = R.workload(S.entries, R.mondayOf(S.today));
  return JSON.stringify({ entries: S.entries.map(e => [e.id, e.minutes, e.audience, e.subject]), w }); })()"""
with sync_playwright() as p:
    b = p.chromium.launch(); pages = {}
    for m in dirs:
        ctx = b.new_context(offline=True, viewport={"width": 1440, "height": 900}); ctx.expose_function("__fs", fs_for(m)); ctx.add_init_script(FS_JS)
        pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e, errs=errs: errs.append(str(e))); pg.goto((app / "index.html").as_uri() + Q + m)
        pg.wait_for_selector(".tile"); pg.evaluate("DASH.app.syncNow()"); pg.evaluate("DASH.app.flush()"); pages[m] = (pg, errs)
    mac, pc = pages["mac"][0], pages["workpc"][0]
    check((dirs["mac"] / "time-mac.json").exists() and (dirs["workpc"] / "time-workpc.json").exists(), "first run: each machine writes Data/time-<machine>.json")
    # one-time migration of 00.01 local entries
    mac.evaluate("""(async () => { const D = DASH.db; await D.set('timeEntries', [{ id: 'i-legacy1', taskId: null, eventId: null, date: '2026-10-16', minutes: 40, audience: 'Owner/operator', subject: 'Account strategy', account: 'Account D', source: 'manual', confirmed: true }]);
      await D.set('calTombstones', ['CAL-9']); await D.set('migratedV2', undefined); await D.set('ownEvents', undefined); })()""")
    mac.reload(); mac.wait_for_selector(".tile"); mac.evaluate("DASH.app.syncNow()"); mac.evaluate("DASH.app.flush()")
    f = json.loads((dirs["mac"] / "time-mac.json").read_text())
    check(any(e["id"] == "i-legacy1" for e in f["events"]) and any(e["id"] == "cal:CAL-9" and e["op"] == "remove" for e in f["events"]), "migration: 00.01 local entry + tombstone moved into time-mac.json")
    check(mac.evaluate("DASH.app.state.entries.filter(e=>e.id==='i-legacy1').length") == 1, "migration: entry counted once")
    mac.reload(); mac.wait_for_selector(".tile"); mac.evaluate("DASH.app.syncNow()")
    check(mac.evaluate("DASH.app.state.entries.filter(e=>e.id==='i-legacy1').length") == 1, "migration runs once (no duplicate after reload)")
    # F5: a removed notebook-log line adds no event on later loads
    import subprocess, sys as _s
    subprocess.run([_s.executable, str(SRC / "tools/make_log_js.py"), str(SRC / "tests/fixtures/example-notebook-log.md"), str(dirs["mac"] / "notebook-log.js")], check=True, capture_output=True)
    mac.evaluate("DASH.app.syncNow()"); mac.evaluate("DASH.app.flush()")
    check(mac.evaluate("DASH.app.state.entries.filter(e=>e.origin==='notebook-log').length") == 5, "notebook-log.js picked up from the Data folder by the poll")
    mac.evaluate("(() => { const S = DASH.app.state; const x = S.entries.find(e => e.origin === 'notebook-log'); S.entries = S.entries.filter(e => e !== x); return DASH.app.commit(); })()"); mac.evaluate("DASH.app.flush()")
    n0 = len(json.loads((dirs["mac"] / "time-mac.json").read_text())["events"])
    for _ in range(3): mac.reload(); mac.wait_for_selector(".tile"); mac.evaluate("DASH.app.syncNow()"); mac.evaluate("DASH.app.flush()")
    n1 = len(json.loads((dirs["mac"] / "time-mac.json").read_text())["events"])
    check(n0 == n1 and mac.evaluate("DASH.app.state.entries.filter(e=>e.origin==='notebook-log').length") == 4, f"F5 removed log line stays removed; 3 reloads add no events ({n0} -> {n1})")
    older_mac = (dirs["mac"] / "time-mac.json").read_text()
    # concurrent offline edits (OneDrive not syncing): mac removes the Standup meeting; later workpc adjusts it to 45 min
    mac.evaluate("""(() => { const S = DASH.app.state; S.entries.push({ id: 'i-mac1', taskId: 'EX-1', eventId: null, date: '2026-10-19', minutes: 30, audience: 'Owner/operator', subject: 'Account strategy', account: 'Account A', source: 'manual', confirmed: true });
      S.entries = S.entries.filter(e => e.id !== 'cal:CAL-1'); return DASH.app.commit(); })()"""); mac.evaluate("DASH.app.flush()")
    pc.wait_for_timeout(30)
    pc.evaluate("""(() => { const S = DASH.app.state; S.entries.push({ id: 'i-pc1', taskId: 'EX-2', eventId: null, date: '2026-10-19', minutes: 15, audience: 'Integrator/partner', subject: 'Training/education', account: 'Account D', source: 'manual', confirmed: true });
      S.entries.find(e => e.id === 'cal:CAL-1').minutes = 45; return DASH.app.commit(); })()"""); pc.evaluate("DASH.app.flush()")
    check(mac.evaluate(TOT) != pc.evaluate(TOT), "offline: machines differ before OneDrive syncs")
    # OneDrive syncs: files cross over; workpc also gets a conflict copy of an older time-mac.json and one broken file
    shutil.copy(dirs["mac"] / "time-mac.json", dirs["workpc"] / "time-mac.json"); shutil.copy(dirs["workpc"] / "time-workpc.json", dirs["mac"] / "time-workpc.json")
    (dirs["workpc"] / "time-mac-Laptop2.json").write_text(older_mac); (dirs["workpc"] / "time-broken.json").write_text("{not json")
    for m in dirs: writes[m].clear()
    before = {m: {n: (dirs[m] / n).read_text() for n in os.listdir(dirs[m]) if n != f"time-{m}.json"} for m in dirs}
    for _ in range(2):
        for pg in (mac, pc): pg.evaluate("DASH.app.syncNow()"); pg.evaluate("DASH.app.flush()")
    a, c = mac.evaluate(TOT), pc.evaluate(TOT)
    check(a == c, "after sync: identical entries and Workload totals on both machines")
    ents = dict((e[0], e[1]) for e in json.loads(a)["entries"])
    check(ents.get("cal:CAL-1") == 45 and "i-mac1" in ents and "i-pc1" in ents and "i-legacy1" in ents, "last writer wins (later 45-min adjust beats earlier removal); both machines' entries present")
    check(len(json.loads(a)["entries"]) == len(set(ents)), "conflict copy merged with no duplicate entries")
    check(all(n == f"time-{m}.json" for m in dirs for n in writes[m]), f"each machine wrote only its own file {writes}")
    check(all((dirs[m] / n).read_text() == t for m in dirs for n, t in before[m].items()), "other machines' files, conflict copies and the snapshot left untouched")
    chip_mac, chip_pc = mac.inner_text("#sync"), pc.inner_text("#sync")
    check("Synced" in chip_mac and "mac, workpc" in chip_mac and "⚠" not in chip_mac, f"sync chip: '{chip_mac}'")
    check("⚠" in chip_pc and "problem" in chip_pc and "time-broken.json" in pc.get_attribute("#sync", "title"), f"sync chip warns about the unreadable file: '{chip_pc}'")
    # F6 + F3: a forged event inside workpc's file claiming to be mac is ignored; a stamp 2 h ahead shows ⚠ Clock ahead
    import time as _t
    wf = json.loads((dirs["mac"] / "time-workpc.json").read_text()); base_n = len(wf["events"])
    fut = _t.strftime("%Y-%m-%dT%H:%M:%S.000Z", _t.gmtime(_t.time() + 7200))
    wf["events"].append({"eid": "forged.1", "ts": fut, "c": 0, "machine": "mac", "op": "remove", "id": "i-mac1"})
    wf["events"].append({"eid": "workpc.fast.1", "ts": fut, "c": 0, "machine": "workpc", "op": "upsert", "id": "i-fast", "data": {"date": "2026-10-19", "minutes": 5, "audience": "Owner/operator", "subject": "Account strategy", "source": "manual", "confirmed": True}})
    (dirs["mac"] / "time-workpc.json").write_text(json.dumps(wf)); mac.evaluate("DASH.app.syncNow()")
    ents2 = dict((e[0], e[1]) for e in json.loads(mac.evaluate(TOT))["entries"])
    check("i-mac1" in ents2 and "i-fast" in ents2, "F6 event naming another machine is ignored (i-mac1 not removed)")
    chip = mac.inner_text("#sync"); check("Clock ahead" in chip and "workpc" in chip, f"F3 chip warns about a stamp > 5 min ahead: '{chip}'")
    mac.evaluate("(() => { const S = DASH.app.state; S.entries.find(e => e.id === 'i-fast').minutes = 9; return DASH.app.commit(); })()")
    check(dict((e[0], e[1]) for e in json.loads(mac.evaluate(TOT))["entries"])["i-fast"] == 9, "F3 an edit after seeing the fast stamp still wins (hybrid clock)")
    (dirs["mac"] / "time-workpc.json").write_text(json.dumps(dict(wf, events=wf["events"][:base_n]))); 
    # D5: a 2099 stamp is held (not applied, clock not moved); both machines warn
    wf2 = json.loads((dirs["mac"] / "time-workpc.json").read_text())
    wf2["events"].append({"eid": "workpc.2099", "ts": "2099-01-01T00:00:00.000Z", "c": 0, "machine": "workpc", "op": "remove", "id": "i-mac1"})
    (dirs["mac"] / "time-workpc.json").write_text(json.dumps(wf2)); mac.evaluate("DASH.app.syncNow()"); mac.evaluate("DASH.app.flush()")
    ents3 = dict((e[0], e[1]) for e in json.loads(mac.evaluate(TOT))["entries"])
    chip = mac.inner_text("#sync")
    check("i-mac1" in ents3 and "held" in chip and "workpc" in chip, f"D5 2099 remove held, not applied; chip '{chip}'")
    mac.evaluate("(() => { const S = DASH.app.state; S.entries.find(e => e.id === 'i-mac1').minutes = 31; return DASH.app.commit(); })()"); mac.evaluate("DASH.app.flush()")
    mf = json.loads((dirs["mac"] / "time-mac.json").read_text())
    check(all(not e["ts"].startswith("2099") for e in mf["events"]), "D5 the held stamp doesn't advance this machine's clock")
    check(any(r["about"] == "workpc" for r in mf.get("clock_reports", [])), "D5 mac publishes a clock report about workpc")
    shutil.copy(dirs["mac"] / "time-mac.json", dirs["workpc"] / "time-mac.json"); pc.evaluate("DASH.app.syncNow()")
    chip = pc.inner_text("#sync"); check("This computer's clock is ahead" in chip, f"D5 the fast machine warns too: '{chip}'")
    (dirs["mac"] / "time-workpc.json").write_text(json.dumps(dict(wf2, events=wf2["events"][:base_n])))
    # D6: unparsable file name dropped and flagged; Import local data keeps only this machine's events
    (dirs["mac"] / "time-#1.json").write_text(json.dumps({"kind": "dash-time-log", "version": 1, "machine": "mac", "events": [{"eid": "x#1", "ts": "2026-10-19T23:00:00.000Z", "c": 0, "machine": "mac", "op": "remove", "id": "i-mac1"}]}))
    mac.evaluate("DASH.app.syncNow()")
    ents4 = dict((e[0], e[1]) for e in json.loads(mac.evaluate(TOT))["entries"])
    check("i-mac1" in ents4 and "time-#1.json" in (mac.get_attribute("#sync", "title") or ""), "D6 time-#1.json ignored and flagged on the chip")
    os.remove(dirs["mac"] / "time-#1.json")
    exp = {"app": "activity-dashboard", "exportVersion": 1, "ownEvents": [
        {"eid": "zzz.1", "ts": "2026-10-19T23:59:00.000Z", "c": 0, "machine": "zzz", "op": "remove", "id": "i-mac1"},
        {"eid": "mac.imp1", "ts": "2026-10-19T15:00:00.000Z", "c": 0, "machine": "mac", "op": "upsert", "id": "i-imported", "data": {"date": "2026-10-19", "minutes": 4, "audience": "Owner/operator", "subject": "Account strategy", "source": "manual", "confirmed": True}}]}
    r = mac.evaluate("(async e => { const r = await DASH.db.importAll(e); return r; })", exp)
    mac.reload(); mac.wait_for_selector(".tile"); mac.evaluate("DASH.app.syncNow()")
    ents5 = dict((e[0], e[1]) for e in json.loads(mac.evaluate(TOT))["entries"])
    check(r["dropped"] == 1 and "i-mac1" in ents5 and "i-imported" in ents5, f"D6 Import local data keeps only this machine's events (dropped {r['dropped']})")
    # a fresh snapshot dropped into Data shows up on the next poll
    s2 = dict(snap); s2["generated_at"] = "2026-10-19T09:30:00-05:00"; (dirs["mac"] / "inbox-snapshot.json").write_text(json.dumps(s2))
    mac.evaluate("DASH.app.syncNow()"); ga = mac.evaluate("DASH.app.state.snap.generatedAt"); asof = mac.inner_text("#asof")
    check(ga is not None and abs(__import__("datetime").datetime.fromisoformat(ga).timestamp() - __import__("datetime").datetime.fromisoformat("2026-10-19T09:30:00-05:00").timestamp()) < 1 and any(x in asof for x in ("9:30 AM CT", "10:30 AM ET", "8:30 AM MT", "7:30 AM PT")),
          f"poll picks up a new snapshot (instant 14:30Z, shown in the computer's zone): {ga} / {asof}")   # 00.07.000 Z1: zone-independent
    # persistence: reload mac from files
    mac.evaluate("DASH.app.syncNow()"); mac.evaluate("DASH.app.flush()"); pre = json.loads(mac.evaluate(TOT))["entries"]
    mac.reload(); mac.wait_for_selector(".tile"); mac.evaluate("DASH.app.syncNow()")
    check(json.loads(mac.evaluate(TOT))["entries"] == pre, "after reload the mac rebuilds the same entries from the Data folder")
    check(not pages["mac"][1] and not pages["workpc"][1], f"no page errors {pages['mac'][1] + pages['workpc'][1]}")
    # no folder granted (no test FS): chip says so
    ctx = b.new_context(offline=True); pg = ctx.new_page(); pg.goto((app / "index.html").as_uri() + Q + "spare"); pg.wait_for_selector(".tile")
    check("Connect Data folder" in pg.inner_text("#sync"), "no folder granted: chip shows ⚠ Connect Data folder")
    check(pg.evaluate("typeof showDirectoryPicker") == "function" and pg.evaluate("isSecureContext"), "Chromium exposes showDirectoryPicker on file:// (secure context)")
    # ---- DG1: both machines ran 00.01; one adjusted CAL-1 to 15, the other still has the automatic fill ----
    def fresh(m, d):
        ctx = b.new_context(offline=True, viewport={"width": 1440, "height": 900})
        dirs[m] = d; writes[m] = []; ctx.expose_function("__fs", fs_for(m)); ctx.add_init_script(FS_JS); pg = ctx.new_page(); pg.on("dialog", lambda dl: dl.accept())
        pg.goto((app / "index.html").as_uri() + Q + m); pg.wait_for_selector(".tile"); return ctx, pg
    LEG = """(async m => { const S = DASH.app.state, ev = S.snap.calendar.find(e => e.id === 'CAL-1'), full = DASH.rules.minutesBetween(ev.start, ev.end);
      await DASH.db.set('timeEntries', [{ id: 'cal:CAL-1', eventId: 'CAL-1', taskId: null, date: DASH.rules.isoDay(ev.start), minutes: m === 'auto' ? full : m, audience: 'Internal - Domestic', subject: 'Account strategy', source: 'calendar', confirmed: true, attended: false, guessed: { audience: 'domain', subject: 'title' }, title: ev.title }]);
      await DASH.db.set('migratedV2', undefined); await DASH.db.set('ownEvents', undefined); return full; })"""
    for a_, b_ in (("mac", "workpc"), ("zmac", "apc")):
        root = tmp / f"dg1-{a_}"; da, db_ = root / "A", root / "B"; da.mkdir(parents=True); db_.mkdir()
        for d in (da, db_): (d / "inbox-snapshot.json").write_text(json.dumps(snap))
        ca, pa = fresh(a_, da); cb, pb = fresh(b_, db_)
        full = pa.evaluate(LEG, 15); pb.evaluate(LEG, "auto")
        for pg in (pa, pb): pg.reload(); pg.wait_for_selector(".tile"); pg.evaluate("DASH.app.syncNow()"); pg.evaluate("DASH.app.flush()")
        shutil.copy(da / f"time-{a_}.json", db_ / f"time-{a_}.json"); shutil.copy(db_ / f"time-{b_}.json", da / f"time-{b_}.json")
        for pg in (pa, pb): pg.evaluate("DASH.app.syncNow()")
        va = pa.evaluate("DASH.app.state.entries.find(e => e.id === 'cal:CAL-1').minutes"); vb = pb.evaluate("DASH.app.state.entries.find(e => e.id === 'cal:CAL-1').minutes")
        check(va == 15 and vb == 15 and full != 15, f"DG1 two machines: {a_}'s adjusted CAL-1 (15) beats {b_}'s automatic {full} on both ({va}, {vb})")
        ca.close(); cb.close()
    import time as _t0
    # ---- DG5: File → Repair clock stamps… (menu action) ----
    rd = tmp / "repair"; rd.mkdir(); (rd / "inbox-snapshot.json").write_text(json.dumps(snap))
    E = lambda eid, ts, op, i, data=None: dict({"eid": eid, "ts": ts, "c": 0, "machine": "fast", "op": op, "id": i}, **({"data": data} if data else {}))
    D = lambda m: {"date": "2026-10-19", "minutes": m, "audience": "Owner/operator", "subject": "Account strategy", "source": "manual", "confirmed": True}
    orig = E("fast.orig", "2099-01-01T00:00:00.000Z", "upsert", "i-r1", D(5))
    (rd / "time-fast.json").write_text(json.dumps({"app": "activity-dashboard", "kind": "dash-time-log", "version": 1, "machine": "fast", "updated_at": "2026-10-19T12:00:00Z",
        "events": [E("fast.ok", "2026-10-19T09:00:00.000Z", "upsert", "i-r0", D(3)), orig]}))
    cr, pr = fresh("fast", rd); pr.evaluate("DASH.app.syncNow()"); pr.evaluate("DASH.app.flush()")
    check("i-r1" not in json.dumps(pr.evaluate(TOT)) and "held" in pr.inner_text("#sync"), f"DG5 own 2099 stamp held before repair: '{pr.inner_text('#sync')}'")
    with pr.expect_navigation(): pr.evaluate("document.querySelector('[data-act=repairClock]').click()")
    pr.wait_for_selector(".tile"); pr.evaluate("DASH.app.syncNow()"); pr.evaluate("DASH.app.flush()")
    ff = json.loads((rd / "time-fast.json").read_text()); rep = [e for e in ff["events"] if e.get("sup") == "fast.orig"]
    good = max(e["ts"] for e in ff["events"] if e.get("sup") is None and not e["ts"].startswith("2099"))
    check(rep and rep[0]["ts"] == good and _t0.time() * 1000 >= __import__("datetime").datetime.fromisoformat(rep[0]["ts"].replace("Z", "+00:00")).timestamp() * 1000 and not any(e["ts"].startswith("2099") for e in ff["events"]), "DG5 menu Repair re-stamps after the last good stamp and supersedes the original")
    check(dict((e[0], e[1]) for e in json.loads(pr.evaluate(TOT))["entries"]).get("i-r1") == 5 and "held" not in pr.inner_text("#sync"), "DG5 after Repair the entry counts and the warning clears")
    (rd / "time-fast-OldCopy.json").write_text(json.dumps({"app": "activity-dashboard", "kind": "dash-time-log", "version": 1, "machine": "fast", "events": [orig]}))
    pr.evaluate("(() => { const S = DASH.app.state; S.entries.find(e => e.id === 'i-r1').minutes = 9; return DASH.app.commit(); })()"); pr.evaluate("DASH.app.syncNow()"); pr.evaluate("DASH.app.flush()")
    check(dict((e[0], e[1]) for e in json.loads(pr.evaluate(TOT))["entries"]).get("i-r1") == 9 and "held" not in pr.inner_text("#sync"), "DG5 a conflict copy holding the original can't revive it")
    # refuse when this clock looks behind another machine
    import time as _t
    (rd / "time-other.json").write_text(json.dumps({"app": "activity-dashboard", "kind": "dash-time-log", "version": 1, "machine": "other", "updated_at": _t.strftime("%Y-%m-%dT%H:%M:%SZ", _t.gmtime(_t.time() + 3600)), "events": []}))
    pr.evaluate("DASH.app.syncNow()"); before_f = (rd / "time-fast.json").read_text()
    pr.evaluate("document.querySelector('[data-act=repairClock]').click()"); pr.wait_for_timeout(300)
    check("Repair refused" in pr.inner_text("#banner") and (rd / "time-fast.json").read_text() == before_f, "DG5c Repair refused while this clock looks behind another machine")
    cr.close()
    # DH5: corrupt 00.01 IndexedDB (entries not a list) -> migration skips it, warns, no page error
    cd_ = tmp / "corrupt"; cd_.mkdir(); (cd_ / "inbox-snapshot.json").write_text(json.dumps(snap))
    cc, pcc = fresh("corrupt", cd_); errs2 = []; pcc.on("pageerror", lambda e: errs2.append(str(e)))
    pcc.evaluate("(async () => { await DASH.db.set('timeEntries', 'oops'); await DASH.db.set('calTombstones', {bad: 1}); await DASH.db.set('migratedV2', undefined); })()")
    pcc.reload(); pcc.wait_for_selector(".tile")
    check(not errs2 and "couldn't be read and were skipped" in pcc.inner_text("#banner") and pcc.evaluate("DASH.db.get('migratedV2')") is not None, f"DH5 corrupt IndexedDB: migration skipped safely with a warning {errs2}")
    cc.close()
    # DI4: a 00.01 list holding a null (and a number) still migrates its valid entries, with a warning
    cd2 = tmp / "corrupt2"; cd2.mkdir(); (cd2 / "inbox-snapshot.json").write_text(json.dumps(snap))
    c3, p3 = fresh("corrupttwo", cd2); errs3 = []; p3.on("pageerror", lambda e: errs3.append(str(e)))
    p3.evaluate("""(async () => { await DASH.db.set('timeEntries', [null, 5, { id: 'i-ok1', taskId: null, eventId: null, date: '2026-10-16', minutes: 12, audience: 'Owner/operator', subject: 'Account strategy', source: 'manual', confirmed: true },
      { id: 'log:x:1', origin: 'notebook-log', date: '2026-10-16', time: '09:00', minutes: 5, kind: 'Phone', source: 'interaction', confirmed: true }]); await DASH.db.set('calTombstones', [null, 'CAL-9']); await DASH.db.set('migratedV2', undefined); await DASH.db.set('ownEvents', undefined); })()""")
    p3.reload(); p3.wait_for_selector(".tile"); p3.evaluate("DASH.app.flush()")
    have = p3.evaluate("DASH.app.state.entries.map(e => e.id)")
    check(not errs3 and "i-ok1" in have and "log:x:1" in have and "malformed" in p3.inner_text("#banner"), f"DI4 null items skipped with a warning; valid 00.01 entries migrated {errs3}")
    c3.close()
    b.close()
shutil.rmtree(tmp)
print("T20 PASS" if ok else "T20 FAIL"); raise SystemExit(0 if ok else 1)
