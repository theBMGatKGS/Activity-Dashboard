"""T28 (00.07.000): Projects tab, a read-only Planner mirror (export only). Fictional example data only.
Part A (example, file://): tab + View menu, groups by plan › bucket, squares, due words, owner picklist (datalist) + free text,
'set here' + ↺ Planner, email refused as owner, filters (plan, owner, (unassigned), show completed), CSV export (download),
no write-back (no network request), print palette (print navy/print blue on white), dark on screen, example owners never stored.
Part B (Data folder stand-in as in T27): plaintext projects.json in an unencrypted folder is NOT read; after encryption it is
encrypted in place, read, cached under SECRET keys as envelopes; owners typed here are stored encrypted. Optional argv[1]: shots dir."""
import pathlib, shutil, tempfile, json, os, re, sys
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True; errors = []
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
Q = lambda now="2026-10-19T09:20:00-05:00", view="projects": f"?now={now}&machine=test&view={view}"
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    reqs = []; pg.on("request", lambda r: reqs.append(r.url) if not r.url.startswith(("file:", "data:", "blob:")) else None)
    pg.goto((SRC / "index.html").as_uri() + Q(view="focus")); pg.wait_for_selector(".sq")
    pg.click('.tab[data-view="projects"]'); pg.wait_for_selector(".ptable")
    check(pg.evaluate("document.querySelector('.tab[data-view=projects]').getAttribute('aria-selected')") == "true", "Projects tab selects the view")
    heads = pg.eval_on_selector_all(".pgroup h3", "e => e.map(x => x.textContent.replace(/\\s+/g, ' ').trim())")
    check(heads[:2] == ["Accounts › Follow-ups (3)", "Accounts › Waiting on (2)"] and heads[-1] == "Example Retrofit › Install (1)", f"grouped by plan › bucket in Planner's order ({heads})")
    sq = pg.inner_text(".projsum").replace("\n", " ")
    check(all(x in sq.upper() for x in ["9 OPEN", "1 OVERDUE", "1 DUE TODAY", "4 IN PROGRESS", "2 UNASSIGNED"]), f"squares ({sq})")
    check("Overdue" in pg.inner_text("[data-ptask='PT-1'] .pdue") and "over" in pg.get_attribute("[data-ptask='PT-1'] .pdue", "class") and pg.query_selector("[data-ptask='PT-7']") is None, "due words; completed hidden by default")
    check("read-only, export only" in pg.inner_text(".projhead") and "EXAMPLE DATA" in pg.inner_text(".projasof"), "header says read-only / export only and EXAMPLE DATA")
    dl = pg.eval_on_selector_all("#proj-owners option", "e => e.map(x => x.value)")
    check(dl == ["Alex R.", "Chris T.", "Dana L.", "Jordan P.", "Priya M.", "Sam K."], f"owner picklist from Planner assignees ({dl})")
    check(pg.get_attribute("[data-owner='PT-3']", "list") == "proj-owners", "owner input offers the picklist and accepts free text")
    if SHOTS: pg.screenshot(path=str(SHOTS / "07000-1-projects.png"), full_page=True)
    bg = pg.evaluate("getComputedStyle(document.querySelector('.pgroup')).backgroundColor")
    check(bg == "rgb(18, 23, 30)", f"on screen: underground dark surface ({bg})")
    # owner: pick from list / free text / email refused / reset
    pg.fill("[data-owner='PT-3']", "Priya M."); pg.press("[data-owner='PT-3']", "Enter"); pg.wait_for_timeout(50)
    check(pg.input_value("[data-owner='PT-3']") == "Priya M." and pg.query_selector("[data-ptask='PT-3'] .ownset") is not None, "picked owner shows 'set here'")
    pg.fill("[data-owner='PT-10']", "New Person Example"); pg.press("[data-owner='PT-10']", "Enter"); pg.wait_for_timeout(50)
    check("New Person Example" in pg.eval_on_selector_all("#proj-owners option", "e => e.map(x => x.value)"), "free-text owner is accepted and joins the picklist")
    pg.fill("[data-owner='PT-2']", "someone@contoso.example"); pg.press("[data-owner='PT-2']", "Enter"); pg.wait_for_timeout(50)
    check(pg.input_value("[data-owner='PT-2']") == "Alex R." and "no email" in pg.inner_text("#toast"), "an email address is refused as an owner")
    pg.click("[data-ownreset='PT-3']"); pg.wait_for_timeout(50)
    check(pg.input_value("[data-owner='PT-3']") == "" and pg.query_selector("[data-ptask='PT-3'] .ownset") is None, "↺ Planner goes back to Planner's assignee (none)")
    check(pg.evaluate("DASH.db.getRaw('projectOwners')") is None, "example owners are never stored")
    # filters
    pg.fill("#proj-owner", "dana l."); pg.press("#proj-owner", "Enter"); pg.wait_for_timeout(50)
    check(sorted(pg.eval_on_selector_all("[data-ptask]", "e => e.map(x => x.dataset.ptask)")) == ["PT-6", "PT-8"], "owner filter (case-insensitive, multi-assignee)")
    pg.fill("#proj-owner", "(unassigned)"); pg.press("#proj-owner", "Enter"); pg.wait_for_timeout(50)
    check(pg.eval_on_selector_all("[data-ptask]", "e => e.map(x => x.dataset.ptask)") == ["PT-3"], "(unassigned) filter")
    pg.fill("#proj-owner", ""); pg.press("#proj-owner", "Enter"); pg.select_option("#proj-plan", "PLAN-B"); pg.wait_for_timeout(50)
    check(pg.eval_on_selector_all("[data-ptask]", "e => e.map(x => x.dataset.ptask)") == ["PT-9", "PT-10"], "plan filter")
    pg.select_option("#proj-plan", ""); pg.check("#proj-done"); pg.wait_for_timeout(50)
    check(pg.query_selector("[data-ptask='PT-7'].pdone") is not None, "show completed")
    with pg.expect_download() as d: pg.click(".projtools [data-act='exportProjects']")
    csv = pathlib.Path(d.value.path()).read_text()
    check(d.value.suggested_filename == "dash-projects-2026-10-19.csv" and csv.splitlines()[0].startswith('plan,bucket,task_id,title,owner,owner_source') and len(csv.strip().splitlines()) == 11 and '"New Person Example","dashboard"' in csv, "Export CSV: filtered rows, owner source")
    check(not reqs, f"no network requests: nothing is written back to Planner ({reqs[:3]})")
    # print
    pg.evaluate("document.getElementById('view-projects').classList.add('printing')"); pg.emulate_media(media="print")
    pr = pg.evaluate("(() => { const q = s => getComputedStyle(document.querySelector(s)); return [q('#view-projects').backgroundColor, q('#view-projects h2').color, q('#view-projects h2').borderBottomColor, q('.pgroup').backgroundColor, q('.projtools').display, q('.pdue.over').color]; })()")
    check(pr == ["rgb(255, 255, 255)", "rgb(16, 38, 69)", "rgb(12, 119, 188)", "rgb(255, 255, 255)", "none", "rgb(172, 36, 42)"], f"print: white page, print navy headings, print-blue rule, tools hidden, overdue print red ({pr})")
    check(pg.evaluate("getComputedStyle(document.getElementById('view-focus')).display") == "none", "print: only Projects prints")
    if SHOTS: pg.screenshot(path=str(SHOTS / "07000-2-print.png"), full_page=True)
    pg.emulate_media(media="screen")
    # T1: real data arriving without projects.json after EXAMPLE DATA shows no example projects
    p3 = ctx.new_page(); p3.on("pageerror", lambda e: errors.append(str(e))); p3.goto((SRC / "index.html").as_uri() + Q()); p3.wait_for_selector(".ptable")
    raw = json.loads((SRC / "examples/example-snapshot.json").read_text()); raw.pop("example")
    p3.evaluate("r => DASH.app.useSnapshot(r, 'test')", raw); p3.wait_for_timeout(100)
    check(p3.evaluate("DASH.app.state.projFeed") is None and p3.query_selector("[data-ptask]") is None and p3.query_selector(".projempty") is not None, "T1 real data without projects.json after EXAMPLE DATA: no example projects (empty state)")
    p3.close(); ctx.close()
    # ---------------- Part B: encrypted projects feed through the Data folder ----------------
    FS_JS = (SRC / "tests/t21_vault.py").read_text().split('FS_JS = """', 1)[1].split('"""', 1)[0]
    tmp = pathlib.Path(tempfile.mkdtemp()); app = tmp / "Dashboard"; shutil.copytree(SRC, app, ignore=shutil.ignore_patterns("tests", ".git"))
    snap = json.loads((app / "examples/example-snapshot.json").read_text()); snap.pop("example")
    pj = json.loads(re.search(r"=\s*(\{[\s\S]*\});\s*$", (app / "examples/example-projects.js").read_text()).group(1)); pj.pop("example")
    data = tmp / "Data"; data.mkdir(); (data / "inbox-snapshot.json").write_text(json.dumps(snap)); (data / "projects.json").write_text(json.dumps(pj))
    def fs(op, name, text):
        if op == "list": return sorted(x for x in os.listdir(data) if not x.endswith(".crswap"))
        pth = data / name
        if op == "read":
            if not pth.exists(): return None
            st = pth.stat(); return {"m": int(st.st_mtime_ns // 1_000_000), "size": st.st_size, "text": pth.read_text()}
        if op == "write": t = data / (name + ".crswap"); t.write_text(text); os.replace(t, pth); return True
        if op == "remove": pth.unlink(missing_ok=True); return True
    c = b.new_context(viewport={"width": 1440, "height": 900}); c.expose_function("__fs", fs); c.add_init_script(FS_JS)
    mac = c.new_page(); mac.on("pageerror", lambda e: errors.append(f"B: {e}")); msgs = []; mac.on("dialog", lambda d: (msgs.append(d.message), d.accept()))
    mac.goto((app / "index.html").as_uri() + Q().replace("machine=test", "machine=mac")); mac.wait_for_selector("#view-projects"); mac.evaluate("DASH.app.syncNow()"); mac.evaluate("DASH.app.flush()")
    probs = mac.evaluate("DASH.app.state.problems.join(' | ')")
    check(mac.evaluate("DASH.app.state.projFeed") is None and mac.query_selector(".projempty") is not None and "only read encrypted" in probs, "unencrypted folder: plaintext projects.json is NOT read; empty state; the sync chip says why")
    mac.click('.mtop:has-text("File")'); mac.click('[data-act="encryption"]'); mac.wait_for_selector("#vaultsetup"); mac.fill("#vp1", "correct horse battery 07000"); mac.fill("#vp2", "correct horse battery 07000"); mac.click("#vs-ok")
    mac.wait_for_selector("#rk-value", timeout=20000); mac.check("#rk-done"); mac.click("#rk-ok"); mac.wait_for_function("() => document.querySelector('#toast').textContent.startsWith('Data folder encrypted')", timeout=20000)
    mac.evaluate("DASH.app.syncNow()"); mac.evaluate("DASH.app.syncNow()"); mac.wait_for_timeout(300)
    names = sorted(os.listdir(data))
    check("projects.json.enc" in names and "projects.json" not in names, f"after encryption projects.json is encrypted in place ({names})")
    blob = "".join((data / n).read_text() for n in names if n.endswith(".enc") or n == "keyring.json")
    check(not any(x in blob for x in ["riser layout", "Jordan P.", "Example Retrofit"]), "the encrypted files hold no readable task or owner text")
    mac.wait_for_selector(".ptable")
    check(mac.evaluate("!!DASH.app.state.projFeed && DASH.app.state.projFeed.plans.length === 2 && !DASH.app.state.projExample") and "EXAMPLE DATA" not in mac.inner_text(".projasof"), "encrypted feed is read and shown as real data")
    mac.evaluate("DASH.app.setOwner('PT-3', 'Sam K.')"); mac.evaluate("DASH.app.flush()"); mac.wait_for_timeout(100)
    env = mac.evaluate("Promise.all(['projectsFeed','projectOwners'].map(k => DASH.db.getRaw(k))).then(v => v.map(x => !!(x && x.dashCache === 1 && typeof x.env === 'string' && !x.env.includes('Sam'))))")
    check(env == [True, True], f"IndexedDB: projectsFeed and projectOwners are stored as encrypted envelopes ({env})")
    check(mac.evaluate("['projectsFeed','projectOwners'].every(k => DASH.db.SECRET.has(k))"), "projectsFeed and projectOwners are SECRET keys")
    msgs.clear(); mac.click(".projtools [data-act='exportProjects']"); mac.wait_for_timeout(200)
    check(any("unencrypted" in m and "CSV" in m for m in msgs), f"T2 Export CSV asks first when the Data folder is encrypted ({msgs})")
    c.close(); b.close()
check(not errors, "no page errors" + (f": {errors[:3]}" if errors else ""))
print("T28", "PASS" if ok else "FAIL"); sys.exit(0 if ok else 1)
