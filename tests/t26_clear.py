"""T26 (00.05.003): Today's Clear bar on Daily Focus, in Chromium. Fictional example data only.
Bar under the squares (same width), role=progressbar with aria values/text, Done fills it (Undo empties it), Snooze is hatched and
never counts, reduced motion has no transition, print = flat navy fill on white with the count as text. Optional argv[1]: shots dir."""
import json, pathlib, re, sys
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True; errors = []
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
Q = "?now=2026-10-19T08:00:00-05:00&machine=test"
def pb(pg): return pg.evaluate("(() => { const e = document.querySelector('.tclear [role=progressbar]'); return e && [+e.getAttribute('aria-valuenow'), +e.getAttribute('aria-valuemax'), e.getAttribute('aria-valuetext'), document.querySelectorAll('.tclear .seg.done').length, document.querySelectorAll('.tclear .seg.snzd').length]; })()")
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1440, "height": 900}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e))); pg.on("dialog", lambda d: d.accept())
    pg.goto((SRC / "index.html").as_uri() + Q); pg.wait_for_selector(".tclear .track")
    g = pg.evaluate("(() => { const t = document.querySelector('.tiles4').getBoundingClientRect(), c = document.querySelector('.tclear .track').getBoundingClientRect(); return [Math.round(t.width), Math.round(c.width), c.top >= t.bottom, Math.round(c.height)]; })()")
    check(g[1] == 456 and g[2] and g[3] == 10, f"bar sits under the four squares, 456px wide (4×102 + 3×16), 10px tall ({g})")
    v0 = pb(pg); exp = pg.evaluate("(() => { const m = DASH.app.state.clearModel; return [m.done, m.total, m.text]; })()")
    check(v0[:3] == exp and v0[1] > 0, f"role=progressbar: aria-valuenow/max and valuetext match the model ({v0[:3]})")
    check(pg.evaluate("document.querySelector('.tclear [role=progressbar]').getAttribute('aria-labelledby')") == "tclear-l" and pg.inner_text("#tclear-l").lower() == "today's clear", "progressbar is named by the 'Today's clear' caption")
    check(re.fullmatch(r"\d+ of \d+ · \d+%", pg.inner_text(".tclear .pct")) is not None, f"readout 'n of N · p%' ({pg.inner_text('.tclear .pct')})")
    check(pg.evaluate("document.querySelector('.tclear .ticks').getAttribute('aria-hidden')") == "true", "tick strip is decorative (aria-hidden)")
    if SHOTS: pg.locator(".fhead").screenshot(path=str(SHOTS / "05003-1-bar.png"))
    first = pg.evaluate("document.querySelector('#fs-dueToday [data-fdone]').dataset.fdone")
    pg.click(f"#fs-dueToday [data-fdone='{first}']"); pg.wait_for_timeout(100); v1 = pb(pg)
    check(v1[0] == v0[0] + 1 and v1[1] == v0[1], f"✓ Done fills one more (total unchanged) ({v0[0]}→{v1[0]} of {v1[1]})")
    if SHOTS: pg.locator(".fhead").screenshot(path=str(SHOTS / "05003-2-after-done.png"))
    pg.click("#undo button"); pg.wait_for_timeout(100); check(pb(pg)[0] == v0[0], "Undo empties it again")
    sid = pg.evaluate("(document.querySelector('#fs-overdue [data-fsnooze]') || document.querySelector('#fs-dueToday [data-fsnooze]')).dataset.fsnooze")
    pg.click(f"[data-fsnooze='{sid}']"); pg.click("#snz [data-snz='later']"); pg.wait_for_timeout(100); v2 = pb(pg)
    check(v2[0] == v0[0] and v2[1] == v0[1] and v2[4] == 1 and "1 snoozed" in v2[2] and "snoozed (not counted)" in pg.inner_text(".tclear .pnote"), f"Snooze: hatched segment, never counts as cleared, total unchanged ({v2})")
    bgi = pg.evaluate("getComputedStyle(document.querySelector('.tclear .seg.snzd')).backgroundImage")
    check("repeating-linear-gradient" in bgi, "snoozed segment is hatched (not color alone)")
    if SHOTS: pg.locator(".fhead").screenshot(path=str(SHOTS / "05003-3-snoozed.png"))
    check(pg.evaluate("getComputedStyle(document.querySelector('.tclear .seg')).transitionDuration") == "0.25s", "fill animates over 250 ms")
    # print (one Done + one Snooze in place)
    pg.click(f"#fs-dueToday [data-fdone='{first}']"); pg.wait_for_timeout(100)
    pg.evaluate("document.getElementById('view-focus').classList.add('printing')"); pg.emulate_media(media="print")
    pr = pg.evaluate("(() => { const q = s => getComputedStyle(document.querySelector(s)); return [q('.tclear .seg.done').backgroundColor, q('.tclear .seg.snzd').backgroundImage, q('.tclear .track').backgroundColor, q('.tclear .ticks').display, q('.tclear .pct').color]; })()")
    check(pr == ["rgb(16, 38, 69)", "none", "rgb(255, 255, 255)", "none", "rgb(16, 38, 69)"], f"print: flat navy fill on white, no hatch, no ticks, navy count ({pr})")
    check("snoozed" in pg.inner_text(".tclear .pnote"), "print: snooze count written as text")
    if SHOTS: pg.locator(".fhead").screenshot(path=str(SHOTS / "05003-4-print.png"))
    pg.emulate_media(media="screen"); pg.evaluate("document.getElementById('view-focus').classList.remove('printing')")
    c2 = b.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce"); p2 = c2.new_page(); p2.goto((SRC / "index.html").as_uri() + Q); p2.wait_for_selector(".tclear .seg")
    check(p2.evaluate("getComputedStyle(document.querySelector('.tclear .seg')).transitionDuration") == "0s", "reduced motion: no fill animation")
    c3 = b.new_context(viewport={"width": 900, "height": 900}); p3 = c3.new_page(); p3.goto((SRC / "index.html").as_uri() + Q); p3.wait_for_selector(".tclear .track")
    w = p3.evaluate("[Math.round(document.querySelector('.tiles4').getBoundingClientRect().width), Math.round(document.querySelector('.tclear .track').getBoundingClientRect().width)]")
    check(w[1] <= w[0] + 1, f"narrow / 200% zoom: bar matches the 2×2 squares ({w})")
    if SHOTS: p3.locator(".fhead").screenshot(path=str(SHOTS / "05003-5-narrow.png"))
    # B1: a baseline is never taken from EXAMPLE DATA; real data shown after it starts with 0 added
    raw = json.loads((SRC / "examples/example-snapshot.json").read_text())
    c4 = b.new_context(viewport={"width": 1440, "height": 900}); p4 = c4.new_page(); p4.on("pageerror", lambda e: errors.append(str(e)))
    p4.goto((SRC / "index.html").as_uri() + Q); p4.wait_for_selector(".tclear .track")
    check(p4.evaluate("DASH.app.state.clearBase") is None, "example data shown: no Today's Clear baseline is taken (in memory or stored)")
    real = dict(raw, example=False, tasks=[dict(t, id="R-" + t["id"]) for t in raw["tasks"]])
    p4.evaluate("r => DASH.app.useSnapshot(r, 'test')", real); p4.wait_for_timeout(100)
    m = p4.evaluate("[DASH.app.state.clearModel.added, DASH.app.state.clearBase && DASH.app.state.clearBase.ids.length, DASH.app.state.clearModel.total]")
    check(m[0] == 0 and m[1] == m[2] and "added" not in (p4.inner_text(".tclear") or ""), f"example → real data: 0 added, baseline = the real scope ({m})")
    check(p4.evaluate("DASH.db.SECRET.has('clearBase')"), "E1: clearBase is a SECRET key (encrypted with the Data folder, never written while locked)")
    # T1: tick strip shown up to 40 items in scope, hidden at 41
    for n, want in ((40, True), (41, False)):
        many = dict(real, tasks=[{"id": f"M-{i}", "list": "Follow-ups", "title": f"example task {i}", "account": None, "person": None, "next_date": "2026-10-16", "status": "not_started", "last_modified": "2026-10-18T09:00:00-05:00", "withhold": False} for i in range(n)])
        p4.evaluate("r => DASH.app.useSnapshot(r, 'test')", many); p4.wait_for_timeout(100)
        t = p4.evaluate("[document.querySelectorAll('.tclear .tk').length, +document.querySelector('.tclear [role=progressbar]').getAttribute('aria-valuemax')]")
        check(t == ([n, n] if want else [0, n]), f"{n} items: tick strip {'shown' if want else 'hidden'} ({t}); count stays in the note: {'overdue open' in p4.inner_text('.tclear .pnote')}")
    c4.close()
    b.close()
check(not errors, "no page errors" + (f": {errors[:3]}" if errors else ""))
print("T26", "PASS" if ok else "FAIL"); sys.exit(0 if ok else 1)
