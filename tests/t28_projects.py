"""T28 (00.07.000 rev 2): Projects is the source of truth (plans, buckets, tasks, checklists, owners picklist + free text) and
exports Planner-ready CSV, xlsx and Graph JSON (files only, no network). Fictional example data only.
Part A (example, file://): tab, groups, add plan / bucket / task with checklist in the editor, owner picklist + free text, email and
pricing refused, filters, the three exports (download contents), no network requests, print palette (print navy/blue/red on
white), dark on screen, example edits never stored, real data after example shows no example projects (T1).
Part B (Data folder stand-in as in T27): unencrypted folder: projects stay in the browser and NO projects-store file is written;
plaintext projects.json feed is not read. After encryption: saving writes projects-store.json.enc only, no readable text, cache
envelopes; the Planner feed is encrypted in place and Import copies it into the store; every export asks first (T2). argv[1]: shots dir."""
import pathlib, shutil, tempfile, json, os, re, sys, zipfile
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True; errors = []
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
Q = lambda now="2026-10-19T09:20:00-05:00", view="projects": f"?now={now}&machine=test&view={view}"
IDS = "e => e.map(x => x.dataset.ptask)"
GF = json.loads((SRC / "tests/fixtures/example-guard-fixtures.json").read_text())   # money / email fixtures (exempted file)
MONEY = {m.split(" ")[0]: m for m in GF["money"] if m.startswith(("Bid ", "Quote is "))}
def dl(pg, sel):
    with pg.expect_download() as d: pg.click(sel)
    return d.value.suggested_filename, pathlib.Path(d.value.path()).read_bytes()
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    reqs = []; pg.on("request", lambda r: reqs.append(r.url) if not r.url.startswith(("file:", "data:", "blob:")) else None)
    answers = []; pg.on("dialog", lambda d: d.accept(answers.pop(0)) if d.type == "prompt" and answers else d.accept())
    pg.goto((SRC / "index.html").as_uri() + Q(view="focus")); pg.wait_for_selector(".sq")
    pg.click('.tab[data-view="projects"]'); pg.wait_for_selector(".ptable")
    heads = pg.eval_on_selector_all(".pgroup h3", "e => e.map(x => x.firstChild.textContent + x.childNodes[2].textContent)")
    check(len(heads) == 6 and "source of truth" in pg.inner_text(".projhead") and "EXAMPLE DATA" in pg.inner_text(".projasof"), f"Projects: plan › bucket groups, 'source of truth', EXAMPLE DATA ({len(heads)})")
    sq = pg.inner_text(".projsum").replace("\n", " ").upper()
    check(all(x in sq for x in ["9 OPEN", "1 OVERDUE", "1 DUE TODAY", "4 IN PROGRESS", "2 UNASSIGNED"]), f"squares ({sq})")
    check(pg.evaluate("getComputedStyle(document.querySelector('.pgroup')).backgroundColor") == "rgb(18, 23, 30)", "on screen: underground dark surface")
    # owner picklist + free text, email refused
    check(pg.eval_on_selector_all("#proj-owners option", "e => e.map(x => x.value)") == ["Alex R.", "Chris T.", "Dana L.", "Jordan P.", "Priya M.", "Sam K."], "owner picklist")
    pg.fill("[data-owner='PT-3']", "New Person Example"); pg.press("[data-owner='PT-3']", "Enter"); pg.wait_for_timeout(50)
    check(pg.input_value("[data-owner='PT-3']") == "New Person Example" and "New Person Example" in pg.eval_on_selector_all("#proj-owners option", "e => e.map(x => x.value)"), "free-text owner saved on the task and joins the picklist")
    pg.fill("[data-owner='PT-2']", "someone@contoso.example"); pg.press("[data-owner='PT-2']", "Enter"); pg.wait_for_timeout(50)
    check(pg.input_value("[data-owner='PT-2']") == "Alex R." and "no email" in pg.inner_text("#toast"), "an email address is refused as an owner")
    # new plan, bucket, task with checklist
    answers[:] = ["Pilot Example"]; pg.click("[data-pact='addPlan']"); pg.wait_for_timeout(50)
    check(pg.evaluate("DASH.app.state.projPlan") != "" and "Pilot Example › To do" in pg.inner_text("#view-projects").replace("\n", " "), "+ Plan creates a plan with a 'To do' bucket and selects it")
    answers[:] = ["Design"]; pg.click(".projacts [data-pact='addBucket']"); pg.wait_for_timeout(50)
    answers[:] = [MONEY["Bid"]]; pg.click(".projacts [data-pact='addBucket']"); pg.wait_for_timeout(50)
    check("Pilot Example › Design" in pg.inner_text("#view-projects").replace("\n", " ") and "pricing" in pg.inner_text("#toast"), "+ Bucket adds a bucket; a bucket with a dollar figure is refused")
    pg.click(".projacts [data-pact='addTask']"); pg.wait_for_selector("#projdlg")
    pg.fill("#pd-title", "Walk the riser"); pg.select_option("#pd-bucket", label="Design"); pg.fill("#pd-owner", "Dana L."); pg.select_option("#pd-status", "inProgress"); pg.fill("#pd-pct", "40")
    pg.fill("#pd-due", "2026-10-23"); pg.select_option("#pd-pri", "important"); pg.fill("#pd-notes", "Bring the layout")
    for x in ["Print layout", "Walk floors 1-3"]: pg.fill("#pd-cknew", x); pg.press("#pd-cknew", "Enter")
    pg.check("[data-ck='0']"); pg.fill("#pd-notes", MONEY["Quote"]); pg.click("#pd-save")
    check("pricing" in pg.inner_text("#pd-err") and pg.query_selector("#projdlg") is not None, "editor refuses pricing in notes and stays open")
    pg.fill("#pd-notes", "Bring the layout"); pg.click("#pd-save"); pg.wait_for_timeout(50)
    t = pg.evaluate("DASH.app.state.projStore.plans.find(p => p.name === 'Pilot Example').tasks[0]")
    check(t["title"] == "Walk the riser" and t["assignees"] == ["Dana L."] and t["percent"] == 40 and t["priority"] == "important" and [c["done"] for c in t["checklist"]] == [True, False], f"task saved with owner, progress, priority and checklist ({t['checklist']})")
    pg.click(f"[data-pedit='{t['id']}']"); pg.wait_for_selector("#projdlg"); pg.select_option("#pd-status", "completed"); pg.click("#pd-save"); pg.wait_for_timeout(50)
    t2 = pg.evaluate("DASH.app.state.projStore.plans.find(p => p.name === 'Pilot Example').tasks[0]")
    check(t2["percent"] == 100 and t2["completedOn"] == "2026-10-19" and pg.query_selector(f"[data-ptask='{t['id']}']") is None, "completing a task sets 100% and the date; hidden unless Show completed")
    pg.press("body", "Escape")
    check(pg.evaluate("DASH.db.getRaw('projectsStore')") is None, "example edits are never stored")
    if SHOTS: pg.screenshot(path=str(SHOTS / "07000-1-projects.png"), full_page=True)
    # filters
    pg.select_option("#proj-plan", "PLAN-A"); pg.fill("#proj-owner", "dana l."); pg.press("#proj-owner", "Enter"); pg.wait_for_timeout(50)
    check(sorted(pg.eval_on_selector_all("[data-ptask]", IDS)) == ["PT-6", "PT-8"], "plan + owner filter (case-insensitive, multi-owner)")
    pg.fill("#proj-owner", ""); pg.press("#proj-owner", "Enter"); pg.select_option("#proj-plan", ""); pg.wait_for_timeout(50)
    # exports
    n, csv = dl(pg, ".projacts [data-act='exportProjects']"); csv = csv.decode("utf-8-sig")
    check(n == "dash-projects-2026-10-19.csv" and csv.splitlines()[0].startswith('"Plan Name","Task ID","Task Name","Bucket Name","Progress","Priority","Assigned To"') and '"Walk the riser","Design","Completed","Important","Dana L."' in csv and '"Print layout","Print layout; Walk floors 1-3"' in csv, "Export CSV: Planner columns, the new task, checklist columns")
    n, xb = dl(pg, ".projacts [data-act='exportProjectsXlsx']"); xp = pathlib.Path(tempfile.mkdtemp()) / n; xp.write_bytes(xb); z = zipfile.ZipFile(xp)
    check(n == "dash-projects-2026-10-19.xlsx" and z.testzip() is None and "xl/worksheets/sheet3.xml" in z.namelist() and 'name="Pilot Example"' in z.read("xl/workbook.xml").decode() and "Walk the riser" in z.read("xl/worksheets/sheet3.xml").decode(), "Export xlsx: valid workbook, one sheet per plan")
    n, gj = dl(pg, ".projacts [data-act='exportProjectsGraph']"); g = json.loads(gj)
    pl = [x for x in g["plans"] if x["plannerPlan"]["title"] == "Pilot Example"][0]
    check(n == "dash-projects-2026-10-19-graph.json" and pl["plannerPlan"]["@odata.type"] == "#microsoft.graph.plannerPlan" and [x["name"] for x in pl["plannerBuckets"]] == ["To do", "Design"] and pl["plannerTasks"][0]["priority"] == 3 and pl["plannerTasks"][0]["percentComplete"] == 100 and [c["title"] for c in pl["plannerTaskDetails"][0]["checklist"].values()] == ["Print layout", "Walk floors 1-3"], "Export Graph JSON: plannerPlan / Buckets / Tasks / TaskDetails")
    check(not reqs, f"no network requests: nothing is sent to Planner or Graph ({reqs[:3]})")
    # print
    pg.evaluate("document.getElementById('view-projects').classList.add('printing')"); pg.emulate_media(media="print")
    pr = pg.evaluate("(() => { const q = s => getComputedStyle(document.querySelector(s)); return [q('#view-projects').backgroundColor, q('#view-projects h2').color, q('#view-projects h2').borderBottomColor, q('.pgroup').backgroundColor, q('.projacts').display, q('.pdue.over').color, q('.ppri:not(.urgent)').color]; })()")
    check(pr == ["rgb(255, 255, 255)", "rgb(16, 38, 69)", "rgb(12, 119, 188)", "rgb(255, 255, 255)", "none", "rgb(172, 36, 42)", "rgb(16, 38, 69)"], f"print: white page, print navy headings, print-blue rule, actions hidden, overdue print red, Important navy ({pr})")
    if SHOTS: pg.screenshot(path=str(SHOTS / "07000-2-print.png"), full_page=True)
    pg.emulate_media(media="screen")
    # T1: real data after EXAMPLE DATA shows no example projects
    p3 = ctx.new_page(); p3.on("pageerror", lambda e: errors.append(str(e))); p3.goto((SRC / "index.html").as_uri() + Q()); p3.wait_for_selector(".ptable")
    raw = json.loads((SRC / "examples/example-snapshot.json").read_text()); raw.pop("example")
    p3.evaluate("r => DASH.app.useSnapshot(r, 'test')", raw); p3.wait_for_timeout(100)
    check(p3.evaluate("DASH.app.state.projStore") is None and p3.query_selector("[data-ptask]") is None and p3.query_selector(".projempty") is not None, "T1 real data after EXAMPLE DATA: no example projects (empty state)")
    p3.close(); ctx.close()
    # ---------------- Part B: encryption rules through the Data folder ----------------
    FS_JS = (SRC / "tests/t21_vault.py").read_text().split('FS_JS = """', 1)[1].split('"""', 1)[0]
    tmp = pathlib.Path(tempfile.mkdtemp()); app = tmp / "Dashboard"; shutil.copytree(SRC, app, ignore=shutil.ignore_patterns("tests", ".git"))
    snap = json.loads((app / "examples/example-snapshot.json").read_text()); snap.pop("example")
    st = json.loads(re.search(r"=\s*(\{[\s\S]*\});\s*$", (app / "examples/example-projects.js").read_text()).group(1))
    feed = {"schema_version": 1, "generated_at": st["updated_at"], "source": "planner-export", "plans": [{"id": "PLAN-F", "name": "Feed Example", "buckets": [{"id": "FB1", "name": "Doing"}], "tasks": [{"id": "FT-1", "title": "Imported example task", "bucketId": "FB1", "assignees": ["Chris T."], "status": "notStarted", "due": "2026-10-30"}]}]}
    data = tmp / "Data"; data.mkdir(); (data / "inbox-snapshot.json").write_text(json.dumps(snap)); (data / "projects.json").write_text(json.dumps(feed))
    def fs(op, name, text):
        if op == "list": return sorted(x for x in os.listdir(data) if not x.endswith(".crswap"))
        pth = data / name
        if op == "read":
            if not pth.exists(): return None
            s2 = pth.stat(); return {"m": int(s2.st_mtime_ns // 1_000_000), "size": s2.st_size, "text": pth.read_text()}
        if op == "write": t3 = data / (name + ".crswap"); t3.write_text(text); os.replace(t3, pth); return True
        if op == "remove": pth.unlink(missing_ok=True); return True
    c = b.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True); c.expose_function("__fs", fs); c.add_init_script(FS_JS)
    mac = c.new_page(); mac.on("pageerror", lambda e: errors.append(f"B: {e}")); msgs = []; ans = []
    mac.on("dialog", lambda d: (msgs.append(d.message), d.accept(ans.pop(0)) if d.type == "prompt" and ans else d.accept()))
    mac.goto((app / "index.html").as_uri() + Q().replace("machine=test", "machine=mac")); mac.wait_for_selector("#view-projects"); mac.evaluate("DASH.app.syncNow()"); mac.evaluate("DASH.app.flush()")
    probs = mac.evaluate("DASH.app.state.problems.join(' | ')")
    check(mac.evaluate("DASH.app.state.projFeed") is None and mac.query_selector(".projempty") is not None and "only read encrypted" in probs, "unencrypted folder: plaintext projects.json is NOT read; empty state")
    ans[:] = ["Plain Folder Plan"]; mac.click("[data-pact='addPlan']"); mac.evaluate("DASH.app.flush()"); mac.wait_for_timeout(100)
    check(not any(x.startswith("projects-store") for x in os.listdir(data)) and "browser only" in mac.inner_text(".projasof"), f"unencrypted folder: projects stay in the browser, no projects-store file is written ({sorted(os.listdir(data))})")
    mac.click('.mtop:has-text("File")'); mac.click('[data-act="encryption"]'); mac.wait_for_selector("#vaultsetup"); mac.fill("#vp1", "correct horse battery 07000"); mac.fill("#vp2", "correct horse battery 07000"); mac.click("#vs-ok")
    mac.wait_for_selector("#rk-value", timeout=20000); mac.check("#rk-done"); mac.click("#rk-ok"); mac.wait_for_function("() => document.querySelector('#toast').textContent.startsWith('Data folder encrypted')", timeout=20000)
    mac.evaluate("DASH.app.syncNow()"); mac.evaluate("DASH.app.syncNow()"); mac.wait_for_timeout(300)
    check("projects.json.enc" in os.listdir(data) and "projects.json" not in os.listdir(data) and mac.evaluate("!!DASH.app.state.projFeed"), "after encryption the Planner feed is encrypted in place and read")
    mac.click(".projacts [data-act='importPlanner']"); mac.evaluate("DASH.app.flush()"); mac.wait_for_timeout(200)
    names = sorted(os.listdir(data))
    check("projects-store.json.enc" in names and "projects-store.json" not in names and mac.query_selector("[data-ptask='FT-1']") is not None, f"Import Planner export copies the feed into the store; saved as projects-store.json.enc only ({names})")
    blob = "".join((data / n).read_text() for n in names if n.endswith(".enc") or n == "keyring.json")
    check(not any(x in blob for x in ["Plain Folder Plan", "Imported example task", "Chris T."]), "the encrypted files hold no readable plan, task or owner text")
    env = mac.evaluate("Promise.all(['projectsStore','projectsFeed'].map(k => DASH.db.getRaw(k))).then(v => v.map(x => !!(x && x.dashCache === 1 && typeof x.env === 'string' && !x.env.includes('Plain'))))")
    check(env == [True, True] and mac.evaluate("['projectsStore','projectsFeed'].every(k => DASH.db.SECRET.has(k))"), f"IndexedDB: projectsStore and projectsFeed are SECRET, stored as encrypted envelopes ({env})")
    dec = mac.evaluate("(async () => { try { const f = await (await window.DASH_TEST_FS.getFileHandle('projects-store.json.enc')).getFile(); const t = await DASH.vault.decrypt(DASH.app.state.vault.key, DASH.app.state.vault.kr, await f.text(), 'projstore'); return JSON.parse(t).plans.map(p => p.name).sort(); } catch (e) { return 'decrypt failed: ' + e.message; } })()")
    check(dec == ["Feed Example", "Plain Folder Plan"], f"projects-store.json.enc decrypts with purpose projstore to the store ({dec})")
    for act in ["exportProjects", "exportProjectsXlsx", "exportProjectsGraph"]:
        msgs.clear()
        with mac.expect_download(): mac.click(f".projacts [data-act='{act}']")
        check(any("unencrypted" in m for m in msgs), f"T2 {act} asks first when the Data folder is encrypted ({msgs})")
    # A2: locked → an edit writes no store file, raises no page error, and the header says so
    before = (data / "projects-store.json.enc").read_text(); errs0 = len(errors)
    mac.click('.mtop:has-text("File")'); mac.click('[data-act="encryption"]'); mac.wait_for_selector("[data-v='lock']"); mac.click("[data-v='lock']"); mac.wait_for_timeout(100)
    mac.fill("[data-owner='FT-1']", "Sam K."); mac.press("[data-owner='FT-1']", "Enter"); mac.evaluate("DASH.app.flush()"); mac.wait_for_timeout(200)
    after = sorted(x for x in os.listdir(data) if x.startswith("projects-store"))
    check(after == ["projects-store.json.enc"] and (data / "projects-store.json.enc").read_text() == before and len(errors) == errs0 and "browser only" in mac.inner_text(".projasof") and "locked" in mac.inner_text(".projasof"), f"A2 locked: editing writes no store file, no page error, header says locked / browser only ({after})")
    env2 = mac.evaluate("DASH.db.getRaw('projectsStore').then(x => !!(x && x.dashCache === 1 && !x.env.includes('Sam')))")
    check(env2, "A2 locked: nothing readable reaches the browser cache")
    c.close(); b.close()
check(not errors, "no page errors" + (f": {errors[:3]}" if errors else ""))
print("T28", "PASS" if ok else "FAIL"); sys.exit(0 if ok else 1)
