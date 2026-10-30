import sys, pathlib
from playwright.sync_api import sync_playwright
import tempfile
D = pathlib.Path(__file__).resolve().parents[1]
# Output dir: first argument, else a fresh temp dir (never overwrites published shots by accident).
OUT = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(tempfile.mkdtemp(prefix="dash-shots-")); OUT.mkdir(parents=True, exist_ok=True)
URL = (D / "index.html").as_uri() + "?now=2026-10-19T08:00:00-05:00&view=dashboard&machine=test"
errs = []
WAIT_MS = 60000   # rev 3 (QA Low): condition waits, not fixed sleeps
def settle(pg):
    pg.wait_for_function("document.fonts.status === 'loaded'", timeout=WAIT_MS)
    pg.evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    pg.evaluate("window.DASH && DASH.app && DASH.app.flush ? DASH.app.flush() : null")
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1440, "height": 900})
    pg.on("console", lambda m: m.type == "error" and errs.append(m.text)); pg.on("pageerror", lambda e: errs.append(str(e)))
    # 00.05 Daily Focus (home), fictional example data
    fq = (D / "index.html").as_uri() + "?now=2026-10-19T08:00:00-05:00&machine=test"
    pg.goto(fq); pg.wait_for_selector(".sq", timeout=WAIT_MS); settle(pg)
    pg.screenshot(path=str(OUT / "00a-focus-first-run-offer.png"))
    pg.click("#t1o-yes"); settle(pg); pg.screenshot(path=str(OUT / "00b-focus-1440.png"), full_page=True)
    pg.click("#fs-overdue [data-fsnooze='EX-1']"); pg.screenshot(path=str(OUT / "00c-focus-snooze-menu.png")); pg.keyboard.press("Escape")
    pg.click("#fs-dueToday [data-fdone='EX-7']"); settle(pg); pg.screenshot(path=str(OUT / "00d-focus-done-undo.png"))
    pg.click("[data-later]"); pg.screenshot(path=str(OUT / "00e-focus-later-open.png"), full_page=True); pg.click("[data-later]")
    pg.evaluate("document.getElementById('view-focus').classList.add('printing')"); pg.emulate_media(media="print")
    pg.pdf(path=str(OUT / "00f-focus-print.pdf"), width="11in", height="8.5in", print_background=True, margin={"top": "0", "bottom": "0", "left": "0", "right": "0"})
    pg.emulate_media(media="screen"); pg.evaluate("document.getElementById('view-focus').classList.remove('printing')")
    import subprocess; subprocess.run(["pdftoppm", "-png", "-r", "110", "-singlefile", str(OUT / "00f-focus-print.pdf"), str(OUT / "00f-focus-print-landscape")], check=True)
    pn = b.new_page(viewport={"width": 640, "height": 900}); pn.goto(fq); pn.wait_for_selector(".sq", timeout=WAIT_MS); settle(pn); pn.screenshot(path=str(OUT / "00g-focus-200pct.png"), full_page=True); pn.close()
    pg.goto(URL); pg.wait_for_selector(".tile", timeout=WAIT_MS)
    pg.screenshot(path=str(OUT / "01-dashboard-1440.png"))
    pg.click("[data-filter=overdue]"); pg.screenshot(path=str(OUT / "02-filter-overdue.png")); pg.click("#clearf")
    pg.screenshot(path=str(OUT / "03a-conflict-attended-prompt.png"), clip={"x": 0, "y": 270, "width": 1440, "height": 260})
    pg.click("[data-attend='CAL-3']"); pg.click(".evtime.conf"); pg.screenshot(path=str(OUT / "03-adjust-meeting-popover.png")); pg.click("#pop-ok")
    pg.click("[data-logcall]"); pg.select_option("#pop-kind", "Teams call"); pg.fill("#pop-min", "25"); pg.fill("#pop-note", "Sam K. riser question"); pg.screenshot(path=str(OUT / "03b-log-call-popover.png")); pg.click("#pop-ok")
    with pg.expect_file_chooser() as fc: pg.evaluate("document.querySelector('[data-act=importLog]').click()")
    fc.value.set_files(str(D / "tests/fixtures/example-notebook-log.md")); settle(pg)
    pg.click("[data-custom]"); pg.screenshot(path=str(OUT / "04-log-time-popover.png")); pg.click("#pop-ok")
    pg.click("#trends-toggle"); pg.screenshot(path=str(OUT / "05-trends.png"), full_page=True); pg.click("#trends-toggle")
    pg.evaluate("document.querySelector('#coldlist').scrollIntoView()"); pg.screenshot(path=str(OUT / "05b-going-cold-list.png"))
    pg.evaluate("document.querySelector('[data-act=clear]').click()"); pg.click("#clr-time"); pg.fill("#clr-word", "DEL"); pg.screenshot(path=str(OUT / "05c-clear-danger-confirm.png")); pg.click("#clr-cancel")
    pg.evaluate("scrollTo(0,0)"); pg.click(".tab[data-view=workload]"); pg.screenshot(path=str(OUT / "06-workload.png"), full_page=True)
    pg.click(".tab[data-view=print]"); pg.screenshot(path=str(OUT / "07-print-preview.png"), full_page=True)
    pg.click(".tab[data-view=manager]"); pg.screenshot(path=str(OUT / "08-manager-preview.png"), full_page=True)
    pg.click(".mtop >> text=Help"); pg.click("[data-act=hHelp]"); pg.screenshot(path=str(OUT / "09-help.png")); pg.keyboard.press("Escape")
    for name, act in (("print-mine", "print"), ("print-manager", "manager")):
        pg.click(f".tab[data-view={act}]"); pg.evaluate(f"document.querySelectorAll('.view').forEach(v=>v.classList.toggle('printing', v.id==='view-{act}'))")
        pg.emulate_media(media="print"); pg.pdf(path=str(OUT / f"10-{name}.pdf"), width="11in", height="8.5in", print_background=True, margin={"top": "0", "bottom": "0", "left": "0", "right": "0"})
        pg.emulate_media(media="screen")
        import subprocess; subprocess.run(["pdftoppm", "-png", "-r", "110", "-singlefile", str(OUT / f"10-{name}.pdf"), str(OUT / f"10-{name}-landscape")], check=True)
    b.close()
print("shots in", OUT); print("errors:", [e for e in errs if "ERR_FILE_NOT_FOUND" not in e])
