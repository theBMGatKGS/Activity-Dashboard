"""T29 (00.08.000): pinned 'Front and center' strip and File → Import project JSON…. Fictional example data only.
Part A (example, file://): import the example project file through the picker (full format: pinned, notes, named checklist items,
focus blocks); the strip shows at the top of Daily Focus and Projects, open tasks only, overdue first; dark on screen, print palette
when printed; Pin/Unpin toggles it; completing every task clears it; a file with a dollar figure or an email is refused whole.
Part B (Data folder stand-in as in T28): unencrypted folder: import is refused and nothing is stored; after encryption the import
is saved as projects-store.json.enc only, and no plaintext sentinel (raw or decoded) is in any Data file, the IndexedDB cache
or localStorage; no plaintext file is ever written. argv[1]: shots dir."""
import pathlib, shutil, tempfile, json, os, re, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent)); import sentinels as SN
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True; errors = []
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
if SHOTS: SHOTS.mkdir(parents=True, exist_ok=True)
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
Q = lambda view="focus", m="test": f"?now=2026-10-19T09:20:00-05:00&machine={m}&view={view}"
FIX = SRC / "tests/fixtures/example-project-import.json"
GF = json.loads((SRC / "tests/fixtures/example-guard-fixtures.json").read_text())
TMP = pathlib.Path(tempfile.mkdtemp())
def pick(pg, path):
    with pg.expect_file_chooser() as fc: pg.evaluate("document.querySelector('[data-act=importProjectJson]').click()")
    fc.value.set_files(str(path)); pg.wait_for_timeout(250)
STRIP_IDS = "e => e.map(x => x.dataset.pinedit)"
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("dialog", lambda d: d.accept())
    pg.goto((SRC / "index.html").as_uri() + Q()); pg.wait_for_selector(".sq")
    check(pg.query_selector(".fcstrip") is None, "no pinned plan: no Front and center strip")
    check(pg.query_selector("[data-act=importProjectJson][role=menuitem]") is not None, "File → Import project JSON… is in the menu")
    n0 = pg.evaluate("DASH.app.state.projStore.plans.length")
    pick(pg, FIX); t = pg.inner_text("#toast")
    check("Load your real data first" in t and "Nothing was imported" in t and pg.evaluate("DASH.app.state.projStore.plans.length") == n0 and not pg.evaluate("DASH.app.state.projStore.plans.some(p => p.id === 'PLAN-PIN')") and pg.query_selector(".fcstrip") is None, f"X1: EXAMPLE DATA refuses Import project JSON; nothing mixed into the example store ({t[:70]})")
    # the strip checks below load the example file through the in-memory rules path (importProjectFile + readStore), not the picker
    pg.evaluate("raw => { const R = DASH.rules, S = DASH.app.state; const r = R.importProjectFile(raw, S.projStore, new Date().toISOString()); if (r.rejects.length) throw new Error(r.rejects.join('; ')); S.projStore = R.readStore(r.store); DASH.app.render(); }", json.loads(FIX.read_text()))
    pl = pg.evaluate("DASH.app.state.projStore.plans.find(p => p.id === 'PLAN-PIN')")
    check(pl["pinned"] is True and [c["title"] for c in [t2 for t2 in pl["tasks"] if t2["id"] == "PIN-4"][0]["checklist"]] == ["Block 1 (6:00-9:30 AM)", "Block 2 (10:00-11:00 AM)"] and [t2 for t2 in pl["tasks"] if t2["id"] == "PIN-1"][0]["notes"] == "Source: example inbox task", "in-memory path: pinned, notes and checklist item names (focus blocks) loaded")
    pg.click('.tab[data-view="focus"]'); pg.wait_for_selector("#fc-focus")
    ids = pg.eval_on_selector_all("#fc-focus [data-pinedit]", STRIP_IDS)
    check(ids == ["PIN-2", "PIN-1", "PIN-4", "PIN-3"], f"Daily Focus strip: open tasks only, urgent first (overdue, then by date), then the rest by date, no date last ({ids})")
    order = pg.evaluate("[...document.querySelector('#view-focus').children].map(e => e.className.split(' ')[0])")
    check(order.index("fcstrip") <= 1 and order.index("fcstrip") < order.index("strip"), f"strip sits at the top of Daily Focus, above the Today strip ({order[:4]})")
    check("1 overdue" in pg.inner_text("#fc-focus") and "4 open of 5" in pg.inner_text("#fc-focus"), "strip header: open of total, overdue count")
    check(pg.evaluate("getComputedStyle(document.querySelector('#fc-focus')).backgroundColor") == "rgb(18, 23, 30)", "on screen: dark surface")
    if SHOTS: pg.screenshot(path=str(SHOTS / "08000-1-focus-strip.png"), full_page=True)
    pg.evaluate("document.getElementById('view-focus').classList.add('printing')"); pg.emulate_media(media="print")
    pr = pg.evaluate("(() => { const q = s => getComputedStyle(document.querySelector(s)); return [q('#fc-focus').backgroundColor, q('#fc-focus .fch').color, q('#fc-focus').borderTopColor, q('#fc-focus .pdue.over').color]; })()")
    check(pr == ["rgb(255, 255, 255)", "rgb(16, 38, 69)", "rgb(16, 38, 69)", "rgb(172, 36, 42)"], f"print: white, print navy heading and border, overdue print red ({pr})")
    if SHOTS:
        pg.pdf(path=str(SHOTS / "08000-2-focus-print.pdf"), width="11in", height="8.5in", print_background=True, margin={"top": "0", "bottom": "0", "left": "0", "right": "0"})
        import subprocess; subprocess.run(["pdftoppm", "-png", "-r", "110", "-singlefile", str(SHOTS / "08000-2-focus-print.pdf"), str(SHOTS / "08000-2-focus-print")], check=True)
    pg.emulate_media(media="screen"); pg.evaluate("document.getElementById('view-focus').classList.remove('printing')")
    pg.click('.tab[data-view="projects"]'); pg.wait_for_selector("#fc-projects")
    check(pg.evaluate("document.querySelector('#view-projects').firstElementChild.id") == "fc-projects" and pg.eval_on_selector_all("#fc-projects [data-pinedit]", STRIP_IDS) == ids, "Projects: the same strip at the top")
    pg.select_option("#proj-plan", "PLAN-PIN"); pg.wait_for_timeout(50)
    if SHOTS: pg.screenshot(path=str(SHOTS / "08000-3-projects-strip.png"), full_page=True)
    pg.evaluate("document.getElementById('view-projects').classList.add('printing')"); pg.emulate_media(media="print")
    if SHOTS: pg.screenshot(path=str(SHOTS / "08000-4-projects-print.png"), full_page=True)
    pg.emulate_media(media="screen"); pg.evaluate("document.getElementById('view-projects').classList.remove('printing')")
    pg.click("[data-pact=togglePin]"); pg.wait_for_timeout(50)
    check(pg.query_selector("#fc-projects") is None and "Pin to Front and center" in pg.inner_text("[data-pact=togglePin]"), "Unpin removes the strip")
    pg.click("[data-pact=togglePin]"); pg.wait_for_timeout(50); check(pg.query_selector("#fc-projects") is not None, "Pin brings it back")
    for tid in ["PIN-2", "PIN-1", "PIN-4", "PIN-3"]:
        pg.click(f"#fc-projects [data-pinedit='{tid}']"); pg.wait_for_selector("#projdlg"); pg.select_option("#pd-status", "completed"); pg.click("#pd-save"); pg.wait_for_timeout(50)
        if tid == "PIN-4": check(pg.eval_on_selector_all("#fc-projects [data-pinedit]", STRIP_IDS) == ["PIN-3"], "completed tasks leave the strip")
    check(pg.query_selector("#fc-projects") is None, "strip clears once every task is completed (Projects)")
    pg.click('.tab[data-view="focus"]'); pg.wait_for_timeout(50); check(pg.query_selector("#fc-focus") is None, "strip clears on Daily Focus too")
    if SHOTS: pg.screenshot(path=str(SHOTS / "08000-5-focus-cleared.png"))
    check(pg.evaluate("DASH.db.getRaw('projectsStore')") is None, "example-mode edits are never stored")
    ctx.close()
    # ---------------- Part B: encryption rules through the Data folder ----------------
    FS_JS = (SRC / "tests/t21_vault.py").read_text().split('FS_JS = """', 1)[1].split('"""', 1)[0]
    tmp = pathlib.Path(tempfile.mkdtemp()); app = tmp / "Dashboard"; shutil.copytree(SRC, app, ignore=shutil.ignore_patterns("tests", ".git"))
    snap = json.loads((app / "examples/example-snapshot.json").read_text()); snap.pop("example")
    raw = json.loads(FIX.read_text()); raw.pop("_about")
    seeded, SENTS, IDM = SN.seed(raw, skip={"status", "priority"}, id_keys={"id", "bucketId"})
    src = TMP / "project-sentinel.json"; src.write_text(json.dumps(seeded))   # the picked file lives outside the Data folder
    data = tmp / "Data"; data.mkdir(); (data / "inbox-snapshot.json").write_text(json.dumps(snap))
    def fs(op, name, text):
        if op == "list": return sorted(x for x in os.listdir(data) if not x.endswith(".crswap"))
        pth = data / name
        if op == "read":
            if not pth.exists(): return None
            s2 = pth.stat(); return {"m": int(s2.st_mtime_ns // 1_000_000), "size": s2.st_size, "text": pth.read_text()}
        if op == "write": t3 = data / (name + ".crswap"); t3.write_text(text); os.replace(t3, pth); return True
        if op == "remove": pth.unlink(missing_ok=True); return True
    c = b.new_context(viewport={"width": 1440, "height": 900}); c.expose_function("__fs", fs); c.add_init_script(FS_JS)
    mac = c.new_page(); mac.on("pageerror", lambda e: errors.append(f"B: {e}")); mac.on("dialog", lambda d: d.accept())
    mac.goto((app / "index.html").as_uri() + Q("projects", "mac")); mac.wait_for_selector("#view-projects"); mac.evaluate("DASH.app.syncNow()"); mac.evaluate("DASH.app.flush()")
    pick(mac, src); mac.evaluate("DASH.app.flush()")
    check("needs an encrypted" in mac.inner_text("#toast") and mac.evaluate("DASH.app.state.projStore") is None and mac.evaluate("DASH.db.getRaw('projectsStore')") is None and not any(x.startswith("projects") for x in os.listdir(data)), "unencrypted folder: import refused, nothing in memory, the browser cache or the Data folder")
    mac.click('.mtop:has-text("File")'); mac.click('[data-act="encryption"]'); mac.wait_for_selector("#vaultsetup"); mac.fill("#vp1", "correct horse battery 08000"); mac.fill("#vp2", "correct horse battery 08000"); mac.click("#vs-ok")
    mac.wait_for_selector("#rk-value", timeout=20000); mac.check("#rk-done"); mac.click("#rk-ok"); mac.wait_for_function("() => document.querySelector('#toast').textContent.startsWith('Data folder encrypted')", timeout=20000)
    bad = TMP / "bad-money.json"; x = json.loads(FIX.read_text()); x["plans"][0]["tasks"][2]["checklist"] = ["ok", GF["money"][0]]; bad.write_text(json.dumps(x))
    pick(mac, bad); t = mac.inner_text("#toast")
    check("nothing imported" in t and "pricing" in t and mac.query_selector(".fcstrip") is None and not any(n.startswith("projects-store") for n in os.listdir(data)), f"a file with a dollar figure in a checklist item is refused whole ({t[:90]})")
    bad2 = TMP / "bad-email.json"; x = json.loads(FIX.read_text()); x["plans"][0]["tasks"][0]["notes"] = GF["email"][0]; bad2.write_text(json.dumps(x))
    pick(mac, bad2); t = mac.inner_text("#toast"); check("nothing imported" in t and "email" in t and mac.evaluate("!DASH.app.state.projStore || !DASH.app.state.projStore.plans.length"), f"a file with an email address in notes is refused whole ({t[:90]})")
    pick(mac, src); mac.evaluate("DASH.app.flush()"); mac.wait_for_timeout(300)
    names = sorted(os.listdir(data))
    check("Imported 5 task(s)" in mac.inner_text("#toast") and "delete it now" in mac.inner_text("#toast") and "projects-store.json.enc" in names and not any(n.startswith("project") and not n.endswith(".enc") for n in names), f"encrypted folder: imported, saved as projects-store.json.enc only, no plaintext file written ({names})")
    check(mac.query_selector("#fc-projects") is not None, "imported pinned plan shows the strip")
    lk = SN.leaks({n: (data / n).read_text() for n in names if n.endswith(".enc") or n == "keyring.json"}, SENTS)
    check(len(SENTS) >= 15 and not lk, f"Data folder files hold none of the {len(SENTS)} plaintext sentinels ({lk[:2]})")
    env = mac.evaluate("DASH.db.getRaw('projectsStore').then(x => x && x.dashCache === 1 && typeof x.env === 'string' ? x.env : null)")
    check(env is not None and not SN.leaks({"cache": env}, SENTS), "IndexedDB: the imported store is an encrypted envelope with no sentinels")
    ls = mac.evaluate("JSON.stringify(Object.assign({}, localStorage))"); check(not SN.leaks({"ls": ls}, SENTS), "localStorage holds no sentinels")
    dec = mac.evaluate("(async () => { const f = await (await window.DASH_TEST_FS.getFileHandle('projects-store.json.enc')).getFile(); return await DASH.vault.decrypt(DASH.app.state.vault.key, DASH.app.state.vault.kr, await f.text(), 'projstore'); })()")
    check(all(s in dec for s in SENTS) and json.loads(dec)["plans"][0]["pinned"] is True, "control: the decrypted store holds every sentinel and pinned:true")
    # T1: locked folder refuses the import; store and file unchanged
    other = TMP / "other.json"; x = json.loads(FIX.read_text()); x["plans"][0]["id"] = "PLAN-OTHER"; x["plans"][0]["name"] = "Other Example"; other.write_text(json.dumps(x))
    before = (data / "projects-store.json.enc").read_text(); st0 = mac.evaluate("JSON.stringify(DASH.app.state.projStore.plans)")
    mac.click('.mtop:has-text("File")'); mac.click('[data-act="encryption"]'); mac.wait_for_selector("[data-v='lock']"); mac.click("[data-v='lock']"); mac.wait_for_timeout(100)
    pick(mac, other); mac.evaluate("DASH.app.flush()"); mac.wait_for_timeout(200)
    check("needs an encrypted, unlocked" in mac.inner_text("#toast") and mac.evaluate("JSON.stringify(DASH.app.state.projStore.plans)") == st0 and (data / "projects-store.json.enc").read_text() == before and sorted(os.listdir(data)) == names, "T1 locked: import refused; store, cache file and folder unchanged")
    c.close(); b.close()
check(not errors, "no page errors" + (f": {errors[:3]}" if errors else ""))
print("T29", "PASS" if ok else "FAIL"); sys.exit(0 if ok else 1)
