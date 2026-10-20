"""T11: opens index.html as a local file with ALL network blocked; asserts it renders, makes zero non-file requests,
falls back to the example when inbox-snapshot.js is absent, and persists time entries across reload for a non-example snapshot."""
import pathlib, shutil, tempfile, json
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
with sync_playwright() as p:
    b = p.chromium.launch()
    for case in ("with-snapshot", "no-snapshot", "real-persist", "autoload-log"):
        tmp = pathlib.Path(tempfile.mkdtemp()) / "dashboard"; shutil.copytree(SRC, tmp, ignore=shutil.ignore_patterns("tests"))
        if case == "no-snapshot": check(not (tmp / "Data").exists() and not (tmp / "data").exists(), f"[{case}] app ships no Data/ or data/ folder")
        if case == "with-snapshot":
            (tmp / "Data").mkdir(); (tmp / "Data/inbox-snapshot.js").write_text((tmp / "examples/example-snapshot.js").read_text().replace("DASH_EXAMPLE_SNAPSHOT", "DASH_SNAPSHOT"))
        if case == "autoload-log":
            import subprocess, sys as _s; (tmp / "Data").mkdir(exist_ok=True)
            subprocess.run([_s.executable, str(SRC / "tools/make_log_js.py"), str(SRC / "tests/fixtures/example-notebook-log.md"), str(tmp / "Data/notebook-log.js")], check=True, capture_output=True)
        if case in ("real-persist", "autoload-log"):
            snap = json.loads((tmp / "examples/example-snapshot.json").read_text()); snap.pop("example"); (tmp / "Data").mkdir(exist_ok=True)
            (tmp / "Data/inbox-snapshot.js").write_text("window.DASH_SNAPSHOT = " + json.dumps(snap) + ";\n")
        ctx = b.new_context(offline=True, viewport={"width": 1440, "height": 900}); pg = ctx.new_page(); net, errs = [], []
        pg.on("request", lambda r: (not r.url.startswith("file:")) and net.append(r.url)); pg.on("pageerror", lambda e: errs.append(str(e)))
        url = (tmp / "index.html").as_uri() + "?now=2026-10-19T08:00:00-05:00&machine=test"; pg.goto(url); pg.wait_for_selector(".tile")
        check(len(pg.query_selector_all(".tile")) == 10, f"[{case}] 10 totals render offline")
        check(not net, f"[{case}] no network requests {net}"); check(not errs, f"[{case}] no page errors {errs}")
        badge = pg.is_visible("#exbadge")
        check(badge == (case not in ("real-persist", "autoload-log")), f"[{case}] EXAMPLE DATA badge {'shown' if badge else 'hidden'}")
        if case == "autoload-log":
            n = pg.evaluate("DASH.app.state.entries.filter(e=>e.origin==='notebook-log').length"); check(n == 5, f"[{case}] Data/notebook-log.js autoloaded: 5 entries ({n})")
            check(pg.evaluate("DASH.app.state.entries.some(e=>e.person==='Priya M.'&&e.audience==='Owner/operator'&&e.subject==='Technical/design support'&&!e.guessed.audience)"), f"[{case}] audience/subject from the line are used, not guessed")
            pg.reload(); pg.wait_for_selector(".tile")
            n = pg.evaluate("DASH.app.state.entries.filter(e=>e.origin==='notebook-log').length"); check(n == 5, f"[{case}] reload doesn't duplicate ({n})")
            # (a) entries stored under the old line-number id scheme: 5 stay 5 after reload, re-keyed
            pg.evaluate("""(async()=>{const es=DASH.app.state.entries.map((e,k)=>{if(e.origin!=='notebook-log')return e;const o={...e,id:'log:'+(k+4)+':old'+k};delete o.idv;delete o.fp;delete o.legacy;return o});
              await DASH.db.set('timeEntries',es)})()""")
            pg.reload(); pg.wait_for_selector(".tile")
            st = pg.evaluate("DASH.app.state.entries.filter(e=>e.origin==='notebook-log').map(e=>[e.id,e.idv,!!e.legacy])")
            check(len(st) == 5 and all(x[1] == 2 and not x[2] and ":old" not in x[0] for x in st), f"[{case}] (a) legacy-id migration: 5 entries stay 5 after reload {st}")
            pg.reload(); pg.wait_for_selector(".tile")
            n = pg.evaluate("DASH.app.state.entries.filter(e=>e.origin==='notebook-log').length"); check(n == 5, f"[{case}] (a) still 5 after a second reload ({n})")
        if case == "real-persist":
            check(not pg.evaluate("window.DASH_NOTEBOOK_LOG"), f"[{case}] no notebook-log.js -> nothing autoloaded, Import still available")
            pg.click("[data-add='30']"); pg.reload(); pg.wait_for_selector(".tile")
            n = pg.evaluate("DASH.app.state.entries.filter(e=>e.source==='manual').length"); check(n == 1, f"[{case}] time entry persisted in IndexedDB across reload ({n})")
            cal = pg.evaluate("DASH.app.state.entries.filter(e=>e.source==='calendar').map(e=>e.eventId).sort()")
            check(cal == ["CAL-1", "CAL-4"], f"[{case}] calendar time counted at once, conflicts not filled {cal}")
            check("pending" not in pg.inner_text("body").lower() and "confirm?" not in pg.inner_text("body"), f"[{case}] no pending state on screen")
            pg.click("[data-attend='CAL-3']"); cal = pg.evaluate("DASH.app.state.entries.filter(e=>e.source==='calendar').map(e=>e.eventId).sort()")
            check(cal == ["CAL-1", "CAL-3", "CAL-4"], f"[{case}] only the Attended meeting fills {cal}")
            pg.evaluate("DASH.app.state")  # switch attended
            pg.click("[data-attend='CAL-2']"); cal = pg.evaluate("DASH.app.state.entries.filter(e=>e.source==='calendar').map(e=>e.eventId).sort()")
            check(cal == ["CAL-1", "CAL-2", "CAL-4"], f"[{case}] switching Attended moves the time {cal}")
            pg.click("[data-logcall]"); pg.select_option("#pop-kind", "Teams call"); pg.fill("#pop-min", "25"); pg.click("#pop-ok")
            check(pg.evaluate("DASH.app.state.entries.some(e=>e.source==='interaction'&&e.kind==='Teams call'&&e.minutes===25)"), f"[{case}] + Log call adds an interaction")
            with pg.expect_file_chooser() as fc: pg.evaluate("document.querySelector('[data-act=importLog]').click()")
            fc.value.set_files(str(SRC / "tests/fixtures/example-notebook-log.md")); pg.wait_for_function("DASH.app.state.entries.filter(e=>e.origin==='notebook-log').length===5")
            with pg.expect_file_chooser() as fc: pg.evaluate("document.querySelector('[data-act=importLog]').click()")
            fc.value.set_files(str(SRC / "tests/fixtures/example-notebook-log.md")); pg.wait_for_timeout(300)
            check(pg.evaluate("DASH.app.state.entries.filter(e=>e.origin==='notebook-log').length") == 5, f"[{case}] File → Import notebook log fallback: 5 [log] lines, re-import doesn't duplicate")
            with pg.expect_download() as dl: pg.evaluate("document.querySelector('[data-act=exportCSV]').click()")
            txt = open(dl.value.path()).read(); check(txt.startswith("date,time,minutes,hours,source,channel,audience,subject,account,person") and txt.count("\n") == 1 + pg.evaluate("DASH.app.state.entries.length"), f"[{case}] CSV export has every entry")
            total = pg.evaluate("DASH.app.state.entries.length")
            pg.evaluate("document.querySelector('[data-act=clear]').click()"); pg.click("#clr-time"); check(pg.is_disabled("#clr-ok"), f"[{case}] delete-time needs typed DELETE")
            pg.click("#clr-time")
            with pg.expect_navigation(): pg.click("#clr-ok")
            pg.wait_for_selector(".tile")
            check(pg.evaluate("DASH.app.state.entries.length") >= total, f"[{case}] Clear keeps time entries")
            pg.evaluate("document.querySelector('[data-act=clear]').click()"); pg.click("#clr-time"); pg.fill("#clr-word", "DELETE")
            with pg.expect_navigation(): pg.click("#clr-ok")
            pg.wait_for_selector(".tile")
            check(pg.evaluate("DASH.app.state.entries.filter(e=>e.source!=='calendar').length") == 0, f"[{case}] time entries deleted only after danger confirm")
            check(pg.is_visible("#coldlist tbody tr"), f"[{case}] Going Cold panel lists items")
            # F12: removing a meeting's time persists across reload
            pg.click(".tab[data-view=workload]"); pg.click("tr:has-text('Standup (internal)') [data-del]"); pg.evaluate("DASH.app.flush()"); pg.reload(); pg.wait_for_selector(".tile")
            check(not pg.evaluate("DASH.app.state.entries.some(e=>e.eventId==='CAL-1')"), f"[{case}] F12 removed meeting time stays removed after reload")
            # F11: Ctrl+P from Dashboard / Print tab prints the user's sheet; from Manager tab prints Manager's
            import subprocess as sp
            def pdf_text(view, fire):
                pg.click(f".tab[data-view={view}]")
                if fire: pg.evaluate("dispatchEvent(new Event('beforeprint'))")
                pg.emulate_media(media="print"); pdf = str(tmp.parent / f"p-{view}-{fire}.pdf")
                pg.pdf(path=pdf, width="11in", height="8.5in", print_background=True); pg.emulate_media(media="screen")
                if fire: pg.evaluate("dispatchEvent(new Event('afterprint'))")
                return sp.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True).stdout, int(sp.run(["pdfinfo", pdf], capture_output=True, text=True).stdout.split("Pages:")[1].split()[0])
            for view, fire in (("dashboard", False), ("dashboard", True), ("print", False), ("workload", True)):
                txt, pages = pdf_text(view, fire); check("Weekly Sheet — Mine" in txt and "I OWE" in txt and pages == 1, f"[{case}] F11 Ctrl+P from {view} (beforeprint={fire}) prints the user's sheet, 1 page")
            txt, pages = pdf_text("dashboard", False)
            imgs = sp.run(["pdfimages", "-list", str(tmp.parent / "p-dashboard-False.pdf")], capture_output=True, text=True).stdout.strip().splitlines()[2:]
            check(not imgs and not pg.query_selector("#sheet-print img, #sheet-manager img"), f"[{case}] #8 avatar not on the print sheets (0 images in PDF)")
            check(pg.is_visible("#avatar") or pg.is_visible("#avatar-fb"), f"[{case}] #8 avatar shown on screen")
            check(txt.count("[WITHHELD]") >= 1 and "send intro deck" in txt, f"[{case}] #7 withheld items on the user's print sheet with [WITHHELD] marker")
            pg.click(".tab[data-view=dashboard]")
            wl = pg.evaluate("[...document.querySelectorAll('#list .row')].filter(r=>r.querySelector('.withheld')).map(r=>r.dataset.id).sort()")
            check(wl == ["EX-4", "EX-8"], f"[{case}] #7 withheld items marked on screen {wl}")
            txt, pages = pdf_text("manager", True)
            check("WITHHELD" not in txt and "send intro deck" not in txt and "draft pricing summary" not in txt, f"[{case}] #7 withheld items never on Manager's sheet")
            check("Shared with Manager" in txt and "SANITIZED FOR MANAGER — no pricing, bid details or confidential details" in txt and "GOING COLD" not in txt and pages == 1, f"[{case}] F11/F14 Ctrl+P from Manager tab prints Manager's sheet, plan label, no Going Cold total")
            pg.goto(url.replace("2026-10-19T08", "2026-10-21T08")); pg.wait_for_selector(".tile")
            check("⚠ Stale" in pg.inner_text("#asof"), f"[{case}] stale flag after 24 h")
        ctx.close(); shutil.rmtree(tmp.parent)
    b.close()
print("T11", "PASS" if ok else "FAIL"); raise SystemExit(0 if ok else 1)
