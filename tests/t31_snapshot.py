"""T31 (00.09.001): plain snapshot deliveries in an encrypted Data folder, end to end in Chromium. Fictional example data only.
A test-only stand-in for the granted folder (window.DASH_TEST_FS, as in T21) records which files had their contents read.
00.09.001 QA fixes: F1 future-dated snapshots refused, F2 example history dropped on the example-to-real switch, F4 temp file +
read-back + rename, the leftover-file waiting banner, and case 6 (folder vs opened snapshot by date).
Checks: unlocked adopt (newer, older, same, dated names, invalid, example, delete fails, idempotent), locked 'New snapshot waiting'
(no contents read, unlock from the chip), reconnect state, time logs still follow the delete setting, the GitHub-only stale tip,
clock reports expire after 24 h (O1), and a -06:00 snapshot after the DST change in Chicago and New York (O2).
Usage: python3 t31_snapshot.py [shots-dir]"""
import pathlib, shutil, tempfile, json, os, subprocess, sys, time
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(tempfile.mkdtemp(prefix="dash-t31-")); SHOTS.mkdir(parents=True, exist_ok=True)
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
PASS = "synthetic test passphrase t31"; ENV = dict(os.environ, DASH_TEST_PASS=PASS); HELP = str(SRC / "tests/snap_vault_helper.js")
FS_JS = """(() => { const nf = () => { const e = new Error('not found'); e.name = 'NotFoundError'; return e; }; window.__textReads = [];
  const fh = n => ({ kind: 'file', name: n, async getFile() { const r = await window.__fs('stat', n, ''); if (!r) throw nf();
      return { lastModified: r.m, size: r.size, text: async () => { window.__textReads.push(n); return (await window.__fs('read', n, '')).text; } }; },
    async move(to) { await window.__fs('move', n, to); },
    async createWritable() { let buf = ''; return { write: async t => { buf += t; }, close: async () => { await window.__fs('write', n, buf); } }; } });
  window.DASH_TEST_FS = { kind: 'directory', name: 'Data', denied: !!window.__denied, queryPermission: async () => 'granted',
    async *entries() { for (const f of await window.__fs('list', '', '')) yield [f, fh(f)]; },
    async getFileHandle(n, o) { const l = await window.__fs('list', '', ''); if (!l.includes(n) && !(o && o.create)) throw nf(); return fh(n); },
    async removeEntry(n) { if (await window.__fs('remove', n, '') === 'locked') { const e = new Error('file in use'); e.name = 'NoModificationAllowedError'; throw e; } } }; })();"""
tmp = pathlib.Path(tempfile.mkdtemp(prefix="dash-t31-w-")); app = tmp / "Dashboard"; shutil.copytree(SRC, app, ignore=shutil.ignore_patterns("tests", ".git"))
KR = tmp / "keyring.json"; subprocess.run(["node", HELP, "keyring", str(KR)], check=True, env=ENV)
BASE = json.loads((SRC / "examples/example-snapshot.json").read_text()); BASE.pop("example")
EX_DATES = {h["generated_at"] for h in BASE["totals_history"]}; BASE["totals_history"] = []   # real fixtures carry no example weekly totals (F2)
def snap(gen, example=False, bad=False):
    s = dict(BASE, generated_at=gen); s.pop("example", None)
    if example: s["example"] = True
    if bad: s["schema_version"] = 99
    return s
def enc(d, purpose, text, out):
    src = tmp / "in.txt"; src.write_text(text); subprocess.run(["node", HELP, "enc", str(KR), purpose, str(src), str(d / out)], check=True, env=ENV); src.unlink()
def gen_of(d): return subprocess.run(["node", HELP, "gen", str(KR), str(d / "inbox-snapshot.json.enc")], check=True, env=ENV, capture_output=True, text=True).stdout.strip()
def folder(old=None, plain=(), extra=()):
    d = pathlib.Path(tempfile.mkdtemp(prefix="Data-", dir=tmp)); shutil.copy(KR, d / "keyring.json")
    if old: enc(d, "snapshot", json.dumps(snap(old)), "inbox-snapshot.json.enc"); past = time.time() - 3600; os.utime(d / "inbox-snapshot.json.enc", (past, past))
    for name, s in plain: (d / name).write_text("window.DASH_SNAPSHOT = " + json.dumps(s) + ";\n" if name.endswith(".js") else json.dumps(s))
    for name, text in extra: (d / name).write_text(text)
    return d
LOCKED = set(); WRITES = []; CORRUPT = set()
def fs_for(d):
    def fs(op, name, text):
        if op == "list": return sorted(os.listdir(d))
        p = d / name
        if op in ("stat", "read"):
            if not p.exists(): return None
            st = p.stat(); r = {"m": int(st.st_mtime_ns // 1_000_000), "size": st.st_size}
            if op == "read": r["text"] = p.read_text()
            return r
        if op == "write": WRITES.append(name); p.write_text("{corrupt" if name in CORRUPT else text); return True
        if op == "move": os.replace(p, d / text); return True
        if op == "remove":
            if name in LOCKED: return "locked"
            p.unlink(); return True
    return fs
errors = []
NOW = "2026-10-30T09:00:00-05:00"
with sync_playwright() as p:
    b = p.chromium.launch()
    def page(d, unlock=True, denied=False, now=NOW, tz="America/Chicago", machine="workpc"):
        ctx = b.new_context(viewport={"width": 1440, "height": 900}, timezone_id=tz); ctx.expose_function("__fs", fs_for(d))
        if denied: ctx.add_init_script("window.__denied = true;")
        ctx.add_init_script(FS_JS); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto((app / "index.html").as_uri() + f"?now={now}&view=dashboard&machine={machine}")
        if denied: pg.wait_for_selector(".tile"); return ctx, pg
        pg.wait_for_selector("#vaultunlock")
        if unlock: pg.fill("#vault-pass", PASS); pg.click("#vault-ok"); pg.wait_for_function("() => !document.querySelector('#vaultunlock')", timeout=30000)
        else: pg.click("#vault-later")
        pg.wait_for_selector(".tile"); pg.evaluate("DASH.app.syncNow()"); pg.evaluate("DASH.app.flush()"); return ctx, pg
    S = lambda pg: pg.evaluate("({ gen: DASH.app.state.snap && DASH.app.state.snap.raw_generated_at, asof: document.getElementById('asof').textContent, asofTip: document.getElementById('asof').title, chip: document.getElementById('sync').textContent, chipTip: document.getElementById('sync').title, toast: document.getElementById('toast').textContent, notice: DASH.app.state.snapNoticeText || '', problems: DASH.app.state.problems.slice(), reads: window.__textReads.slice() })")
    OLD, NEW = "2026-10-27T06:35:00-05:00", "2026-10-30T06:47:00-05:00"

    # 1 unlocked, plain newer than .enc: encrypted, checked, loaded, deleted, notice
    d = folder(OLD, [("inbox-snapshot.js", snap(NEW))]); ctx, pg = page(d); s = S(pg)
    check(gen_of(d) == NEW and not (d / "inbox-snapshot.js").exists(), f"1 newer plain: encrypted into inbox-snapshot.json.enc and the plain file deleted ({sorted(os.listdir(d))})")
    check(s["gen"] == NEW and "Stale" not in s["asof"], f"1 newer plain: loaded at start-up, no Stale ({s['asof']!r})")
    check("New snapshot from Fri 10/30, 6:47 AM CT encrypted and loaded." in s["notice"] and "plain file was deleted" in s["notice"], f"1 notice names the time with its zone label ({s['notice']!r})")
    pg.evaluate(f"(() => {{ const t = document.getElementById('toast'); t.textContent = {json.dumps(s['notice'])}; t.classList.remove('hidden'); clearTimeout(window.__h); }})()")
    pg.screenshot(path=str(SHOTS / "31a-adopt-notice.png"))
    # 13 idempotent: nothing more is written on the next syncs
    n0 = len(WRITES); pg.evaluate("DASH.app.syncNow(true)"); pg.evaluate("DASH.app.syncNow(true)"); pg.evaluate("DASH.app.flush()")
    check(not [w for w in WRITES[n0:] if "snapshot" in w], f"13 idempotent: later syncs write no snapshot file ({WRITES[n0:]})"); ctx.close()

    # 2 plain older than .enc: .enc kept, plain deleted, notice says it wasn't used
    d = folder(NEW, [("inbox-snapshot.json", snap(OLD))]); before = (d / "inbox-snapshot.json.enc").read_text(); ctx, pg = page(d); s = S(pg)
    check((d / "inbox-snapshot.json.enc").read_text() == before and not (d / "inbox-snapshot.json").exists() and s["gen"] == NEW, "2 older plain: encrypted copy unchanged, plain deleted, newer one shown")
    check("wasn't used" in s["notice"], f"2 notice says the plain one was not newer ({s['notice']!r})"); ctx.close()

    # 3 same generated_at: no rewrite, plain deleted
    d = folder(NEW, [("inbox-snapshot.js", snap(NEW))]); before = (d / "inbox-snapshot.json.enc").read_text(); ctx, pg = page(d)
    check((d / "inbox-snapshot.json.enc").read_text() == before and not (d / "inbox-snapshot.js").exists(), "3 same generated_at: no rewrite, plain deleted"); ctx.close()

    # 4 dated names: newest by content wins (not by name), all removed
    d = folder(OLD, [("inbox-snapshot-261030.js", snap("2026-10-29T06:47:00-05:00")), ("inbox-snapshot_261029.json", snap(NEW))]); ctx, pg = page(d); s = S(pg)
    check(gen_of(d) == NEW and s["gen"] == NEW, f"4 dated names: newest generated_at wins even when its name has the earlier date ({gen_of(d)})")
    check(sorted(os.listdir(d)) == ["inbox-snapshot.json.enc", "keyring.json", "time-workpc.json.enc"], f"4 dated names: both plain files deleted ({sorted(os.listdir(d))})"); ctx.close()

    # 5 invalid and 9 example plain snapshots: kept, named in a problem line, current data kept
    d = folder(OLD, [("inbox-snapshot.js", snap(NEW, bad=True)), ("inbox-snapshot-ex.json", snap(NEW, example=True))]); ctx, pg = page(d); s = S(pg)
    check((d / "inbox-snapshot.js").exists() and gen_of(d) == OLD and s["gen"] == OLD, "5 invalid plain snapshot: kept, encrypted copy unchanged, current data kept")
    check(any("inbox-snapshot.js" in x and "rejected" in x for x in s["problems"]), "5 invalid: a problem line names the file")
    check((d / "inbox-snapshot-ex.json").exists() and any("inbox-snapshot-ex.json" in x and "example snapshot" in x for x in s["problems"]), "9 example snapshot: never encrypted into the folder, named in a problem line")
    check(not any("tasks" in x or "generated_at" in x for x in s["problems"]), "5/9 problem lines carry no snapshot contents"); ctx.close()

    # 10 delete fails: .enc written, warning once, no retry loop
    d = folder(OLD, [("inbox-snapshot.js", snap(NEW))]); LOCKED.add("inbox-snapshot.js"); n0 = len(WRITES); ctx, pg = page(d); s = S(pg)
    w1 = [w for w in WRITES[n0:] if w.startswith("inbox-snapshot")]
    check(gen_of(d) == NEW and (d / "inbox-snapshot.js").exists() and "couldn't be deleted" in s["notice"], f"10 delete fails: encrypted copy written and loaded, notice asks to delete by hand ({s['notice']!r})")
    check(any("delete it by hand" in x for x in s["problems"]), "10 delete fails: the sync chip lists it")
    n1 = len(WRITES); pg.evaluate("DASH.app.syncNow(true)"); pg.evaluate("DASH.app.syncNow(true)")
    check(not [w for w in WRITES[n1:] if w.startswith("inbox-snapshot")], f"10 delete fails: not encrypted again on later syncs ({WRITES[n1:]})"); LOCKED.clear(); ctx.close()

    # 14 time logs still follow the delete setting (off by default): a plain time file is encrypted and kept
    tl = json.dumps({"app": "activity-dashboard", "kind": "dash-time-log", "version": 1, "machine": "laptop", "updated_at": "2026-10-30T08:00:00Z", "events": []})
    d = folder(NEW, extra=[("time-laptop.json", tl)]); ctx, pg = page(d)
    check((d / "time-laptop.json").exists() and (d / "time-laptop.json.enc").exists(), "14 time logs: encrypted and the plain file kept (delete setting off), as before"); ctx.close()

    # 7 locked: names and dates only; header and chip say a new snapshot is waiting; unlock from the chip adopts it
    d = folder(OLD, [("inbox-snapshot.js", snap(NEW))]); n0 = len(WRITES); ctx, pg = page(d, unlock=False); s = S(pg)
    check(s["chip"] == "🔒 New snapshot waiting · Unlock to import" and "inbox-snapshot.js" in s["chipTip"], f"7 locked: chip says a new snapshot is waiting ({s['chip']!r})")
    check(s["asof"].startswith("🔒 New snapshot waiting · Unlock to import · ") and "Stale" not in s["asof"], f"7 locked: header shows waiting instead of Stale ({s['asof']!r})")
    check(not [r for r in s["reads"] if r != "keyring.json"] and len(WRITES) == n0 and (d / "inbox-snapshot.js").exists(), f"7 locked: no data file contents read (only keyring.json), nothing written (reads={s['reads']})")
    pg.screenshot(path=str(SHOTS / "31b-locked-new-snapshot-waiting.png"))
    pg.click("#sync"); pg.wait_for_selector("#vaultunlock"); pg.fill("#vault-pass", PASS); pg.click("#vault-ok")
    pg.wait_for_function("() => !document.querySelector('#vaultunlock')", timeout=30000); pg.evaluate("DASH.app.flush()"); pg.wait_for_function(f"() => DASH.app.state.snap.raw_generated_at === {json.dumps(NEW)}", timeout=15000); s = S(pg)
    check(gen_of(d) == NEW and not (d / "inbox-snapshot.js").exists() and "New snapshot from" in s["notice"], "7 unlock from the chip: encrypted, loaded, plain deleted, notice shown"); ctx.close()

    # 7b locked with no newer plain file: plain Data locked / Stale as before
    d = folder(OLD); ctx, pg = page(d, unlock=False); s = S(pg)
    check(s["chip"] == "🔒 Data locked" and "Stale" in s["asof"], f"7b locked, nothing waiting: chip and header unchanged ({s['chip']!r}, {s['asof']!r})"); ctx.close()

    # 8 permission not granted: reconnect state, nothing read or written
    d = folder(OLD, [("inbox-snapshot.js", snap(NEW))]); n0 = len(WRITES); ctx, pg = page(d, denied=True); pg.evaluate("DASH.app.syncNow()"); s = S(pg)
    check(s["chip"] == "⚠ Reconnect Data folder" and "New snapshots are checked" in s["chipTip"], f"8 no permission: chip says reconnect ({s['chip']!r})")
    check(s["asof"].startswith("⚠ Reconnect the Data folder to check for new snapshots"), f"8 no permission: header says reconnect instead of Stale ({s['asof']!r})")
    check(not s["reads"] and len(WRITES) == n0 and (d / "inbox-snapshot.js").exists(), "8 no permission: nothing read or written")
    pg.screenshot(path=str(SHOTS / "31c-reconnect-state.png")); ctx.close()

    # 12 GitHub-only (iPad): the stale tip says where a fresh snapshot comes from
    d = folder(OLD); ctx, pg = page(d); pg.evaluate("(() => { const S = DASH.app.state; S.hubOnly = true; S.dirStored = null; DASH.app.render(); })()"); s = S(pg)
    check("Stale" in s["asof"] and "computer with the Data folder" in s["asofTip"], f"12 GitHub-only: stale tip points to a computer with the Data folder ({s['asofTip']!r})"); ctx.close()

    # 15 O1: a report about workpc in mac's file counts when fresh and is ignored when older than 24 h
    def mac_file(at_hours, upd_hours, with_at=True):
        t = lambda h: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - h * 3600)); r = {"about": "workpc", "ahead_min": 40}
        if with_at: r["at"] = t(at_hours)
        return json.dumps({"app": "activity-dashboard", "kind": "dash-time-log", "version": 1, "machine": "mac", "updated_at": t(upd_hours), "events": [], "clock_reports": [r]})
    for label, txt, want in [("fresh (1 h)", mac_file(1, 1), True), ("25 h old", mac_file(25, 1), False), ("no at, file written 6 days ago", mac_file(0, 150, with_at=False), False)]:
        d = folder(NEW); enc(d, "time", txt, "time-mac.json.enc"); ctx, pg = page(d); s = S(pg)
        check(("clock is ahead" in s["chip"]) == want, f"15 O1 clock report {label}: warning {'shown' if want else 'not shown'} ({s['chip']!r})")
        if label.startswith("no at"): pg.screenshot(path=str(SHOTS / "31d-clock-warning-expired.png"))
        ctx.close()

    # 16 O2: a -06:00 snapshot after the DST change shows the right local time in Chicago and New York
    G = "2026-11-02T06:47:00-06:00"
    for tz, want in [("America/Chicago", "6:47 AM CT"), ("America/New_York", "7:47 AM ET")]:
        d = folder(OLD, [("inbox-snapshot.js", snap(G))]); ctx, pg = page(d, now="2026-11-02T08:00:00-06:00", tz=tz); s = S(pg)
        check(s["gen"] == G and want in s["asof"] and "Mon 11/2" in s["asof"] and "Stale" not in s["asof"], f"16 O2 -06:00 snapshot in {tz}: {want} ({s['asof']!r})"); ctx.close()
    # F1: a snapshot dated June 2027 is refused (named in a problem line, kept, not adopted); a normal delivery after it is adopted
    FUT = "2027-06-01T06:00:00-05:00"
    d = folder(OLD, [("inbox-snapshot-270601.js", snap(FUT))]); ctx, pg = page(d); s = S(pg)
    check(gen_of(d) == OLD and s["gen"] == OLD and (d / "inbox-snapshot-270601.js").exists(), "F1 future plain: not adopted, not deleted, encrypted copy unchanged")
    fp = [x for x in s["problems"] if "inbox-snapshot-270601.js" in x]
    check(fp and "in the future" in fp[0] and FUT not in fp[0] and "tasks" not in fp[0], f"F1 future plain: a problem line names the file only ({fp[:1]})")
    pg.evaluate("""(() => { const o = document.createElement('div'); o.id = 'qa-problems'; o.style.cssText = 'position:fixed;top:44px;right:8px;z-index:99;max-width:640px;background:#1b2230;color:#f4c56a;border:1px solid #f4c56a;padding:10px 12px;font:12px/1.5 monospace;white-space:pre-wrap';
      o.textContent = 'Sync chip problem lines (test overlay of the chip tooltip):\\n' + DASH.app.state.problems.join('\\n'); document.body.appendChild(o); })()""")
    pg.screenshot(path=str(SHOTS / "31e-future-snapshot-problem-line.png")); pg.evaluate("document.getElementById('qa-problems').remove()")
    (d / "inbox-snapshot.js").write_text("window.DASH_SNAPSHOT = " + json.dumps(snap(NEW)) + ";\n"); pg.evaluate("DASH.app.syncNow(true)"); pg.evaluate("DASH.app.flush()"); s = S(pg)
    check(gen_of(d) == NEW and s["gen"] == NEW and not (d / "inbox-snapshot.js").exists() and (d / "inbox-snapshot-270601.js").exists(), "F1 then a normal delivery: the real one is adopted and deleted; the future file stays"); ctx.close()
    # F1b: an existing future-dated .enc doesn't win: it is not shown, and a normal delivery replaces it
    d = folder(FUT, [("inbox-snapshot.js", snap(NEW))]); ctx, pg = page(d); s = S(pg)
    check(gen_of(d) == NEW and s["gen"] == NEW and not (d / "inbox-snapshot.js").exists(), f"F1b future .enc: does not win the comparison; the real delivery replaces it ({gen_of(d)})"); ctx.close()
    d = folder(FUT); ctx, pg = page(d); s = S(pg)
    check(s["gen"] != FUT and any("inbox-snapshot.json.enc" in x and "in the future" in x for x in s["problems"]), f"F1c future .enc alone: not shown, named in a problem line ({s['gen']})"); ctx.close()

    # F4: a failed write leaves the good .enc intact (temp file, read-back, then rename)
    d = folder(OLD, [("inbox-snapshot.js", snap(NEW))]); before = (d / "inbox-snapshot.json.enc").read_text(); CORRUPT.add("inbox-snapshot.json.enc.tmp"); ctx, pg = page(d); s = S(pg)
    check((d / "inbox-snapshot.json.enc").read_text() == before and gen_of(d) == OLD and s["gen"] == OLD, "F4 corrupt write: the previous encrypted copy is intact and still shown (not example data)")
    check((d / "inbox-snapshot.js").exists() and not (d / "inbox-snapshot.json.enc.tmp").exists() and any("read-back" in x for x in s["problems"]), "F4 corrupt write: plain file kept, no temp file left, problem line shown")
    CORRUPT.clear(); pg.evaluate("DASH.app.syncNow(true)"); pg.evaluate("DASH.app.flush()")
    check(gen_of(d) == NEW and not (d / "inbox-snapshot.js").exists(), "F4 next sync after the fault clears: adopted normally"); ctx.close()

    # Low: a leftover plain file that couldn't be deleted after a good adopt doesn't show 'New snapshot waiting' when locked
    d = folder(OLD, [("inbox-snapshot.js", snap(NEW))]); LOCKED.add("inbox-snapshot.js"); ctx, pg = page(d)
    pg.click('.mtop:has-text("File")'); pg.click('[data-act="encryption"]'); pg.wait_for_selector("#vaultmenu"); pg.click('#vaultmenu [data-v="lock"]') if pg.query_selector('#vaultmenu [data-v="lock"]') else pg.evaluate("(() => { const b = [...document.querySelectorAll('#vaultmenu button')].find(x => /Lock/.test(x.textContent)); b.click(); })()")
    pg.evaluate("DASH.app.syncNow()"); s = S(pg)
    check(s["chip"] == "🔒 Data locked", f"Low: leftover undeletable file doesn't raise 'New snapshot waiting' ({s['chip']!r})"); LOCKED.clear(); ctx.close()

    # F2: locked start shows EXAMPLE DATA; after unlock the real history holds none of the example weekly totals
    d = folder(OLD, [("inbox-snapshot.js", snap(NEW))]); ctx, pg = page(d, unlock=False)
    ex = pg.evaluate("DASH.app.state.history.map(h => h.generated_at)"); check(bool(EX_DATES & set(ex)), f"F2 locked start: example totals on screen ({len(ex)} weeks)")
    pg.click("#sync"); pg.wait_for_selector("#vaultunlock"); pg.fill("#vault-pass", PASS); pg.click("#vault-ok")
    pg.wait_for_function(f"() => DASH.app.state.snap.raw_generated_at === {json.dumps(NEW)}", timeout=30000); pg.evaluate("DASH.app.flush()")
    h1 = pg.evaluate("DASH.app.state.history.map(h => h.generated_at)")
    check(not (EX_DATES & set(h1)) and h1, f"F2 after unlock: in-memory history and trend lines carry no example weeks ({h1})")
    pg.reload(); pg.wait_for_selector(".tile"); pg.evaluate("DASH.app.flush()"); h2 = pg.evaluate("DASH.app.state.history.map(h => h.generated_at)")
    check(not (EX_DATES & set(h2)) and h2, f"F2 stored (encrypted) history after reload carries no example weeks ({h2})"); ctx.close()

    # 6: a newer folder snapshot beats an older opened one, and a newer opened one beats an older folder copy
    d = folder(OLD); ctx, pg = page(d)
    pg.evaluate(f"DASH.db.set('openedSnapshot', {json.dumps(snap('2026-10-28T06:00:00-05:00'))})"); pg.evaluate("DASH.app.flush()")
    (d / "inbox-snapshot.js").write_text("window.DASH_SNAPSHOT = " + json.dumps(snap(NEW)) + ";\n"); pg.reload(); pg.wait_for_selector(".tile"); s = S(pg)
    check(s["gen"] == NEW and "opened snapshot" not in s["asof"], f"6a newer folder snapshot beats an older opened one ({s['asof']!r})")
    pg.evaluate(f"DASH.db.set('openedSnapshot', {json.dumps(snap('2026-10-30T08:00:00-05:00'))})"); pg.evaluate("DASH.app.flush()"); pg.reload(); pg.wait_for_selector(".tile"); s = S(pg)
    check(s["gen"] == "2026-10-30T08:00:00-05:00" and "opened snapshot" in s["asof"], f"6b newer opened snapshot beats an older folder copy ({s['asof']!r})"); ctx.close()
    b.close()
check(not errors, f"no page errors ({errors[:3]})")
print("T31 " + ("OK" if ok else "FAIL")); sys.exit(0 if ok else 1)
