"""T35 (00.10.001): Grok Bot usage on Daily Focus: a fifth square (glowing ring = weekly % used, design option 3) and a one-line
strip.  Fictional numbers only.  Example placeholder; the square is the same size as the other four and sits right of Going cold;
ring colour green / amber above 80% / red at 100% or Maxed; 100%+ when over; click and Enter open the https details in a new tab
with noopener; http links refused; the strip shows on-demand % or Maxed once, reset times and 'as of' in CT whatever the browser's
zone, and a stale note; no usage -> 'No usage data'; never a dollar amount; not printed; reduced motion stops the glow; at 820 px
the five squares wrap and the strip wraps to two lines.  argv[1]: shots dir."""
import pathlib, tempfile, json, sys
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True; errors = []
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(tempfile.mkdtemp(prefix="dash-t35-")); SHOTS.mkdir(parents=True, exist_ok=True)
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
URL = (SRC / "index.html").as_uri() + "?now=2026-11-01T08:00:00-06:00&machine=test&view=focus"
SNAP = json.loads((SRC / "examples/example-snapshot.json").read_text()); SNAP.pop("example"); SNAP["generated_at"] = "2026-11-01T07:30:00-06:00"
U = {"as_of": "2026-11-01T07:15:00-06:00", "weekly_used_pct": 67.9, "weekly_resets": "2026-11-06T05:03:00-06:00", "on_demand_pct": 24.7, "on_demand_maxed": False, "on_demand_resets": "2026-11-04T09:30:00-06:00", "detail_url": "https://example.com/usage"}
SQ, ST = ".tw.us .t-usage", ".usstrip"
def load(pg, usage, extra=None):
    s = json.loads(json.dumps(SNAP))
    if usage is not None: s["usage"] = dict(usage, **(extra or {}))
    pg.evaluate("s => DASH.app.useSnapshot(s, 'test')", s); pg.wait_for_function("() => DASH.app.state.snap && DASH.app.state.snap.example === false"); pg.evaluate("DASH.app.render()")
    pg.evaluate("window.scrollTo(0, 0)")
    return pg.inner_text(SQ), pg.inner_text(ST)
tone = lambda pg: pg.eval_on_selector(SQ, "e => [...e.classList].find(c => c.startsWith('tone-'))")
dash = lambda pg: pg.eval_on_selector(".usring .arc", "e => e.getAttribute('stroke-dasharray')") if pg.query_selector(".usring .arc") else None
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Tokyo")   # the browser's zone is NOT Chicago
    ctx.route("https://example.com/**", lambda r: r.fulfill(status=200, body="usage details", content_type="text/plain"))
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL); pg.wait_for_selector(SQ, timeout=60000)
    q, s = pg.inner_text(SQ), pg.inner_text(ST)
    check("42%" in q and "GROK BOT" in q.upper() and "18.5%" in s and "example" in s and pg.query_selector("a.t-usage") is None, f"EXAMPLE DATA: placeholder numbers, no link ({q!r})")
    boxes = pg.eval_on_selector_all(".tiles4 .sq", "e => e.map(x => { const r = x.getBoundingClientRect(); return [x.dataset.sq || 'usage', Math.round(r.x), Math.round(r.y), r.width, r.height, getComputedStyle(x).borderRadius]; })")
    check(len(boxes) == 5 and boxes[4][0] == "usage" and boxes[3][0] == "cold" and boxes[4][2] == boxes[3][2] and boxes[4][1] > boxes[3][1] and all(x[3:] == boxes[0][3:] for x in boxes), f"a fifth square right of Going cold, same size and corners ({boxes[3:]})")
    check(pg.inner_text("#lab-usage").upper() == "GROK BOT USAGE", "its label above, like the other squares")
    fs = pg.eval_on_selector(".t-usage .uspct", "e => parseFloat(getComputedStyle(e).fontSize)"); fit = pg.eval_on_selector(".t-usage", "e => { const p = e.querySelector('.uspct').getBoundingClientRect(), r = e.querySelector('.usring').getBoundingClientRect(); return p.width < r.width * 0.7; }")
    check(19.8 <= fs <= 20.7 and fit, f"percent about 10-15% larger than the mockup's 18px, and it fits inside the ring ({fs}px)")
    pg.screenshot(path=str(SHOTS / "35a-gauge-example.png"))
    q, s = load(pg, U)
    check("67.9%" in q and tone(pg) == "tone-green" and dash(pg) and float(dash(pg).split()[0]) > 0, "weekly 67.9%: green ring filled to the percent")
    check(s.count("24.7%") == 1 and "Weekly resets Fri 11/6 5:03 AM CT" in s and "On-demand resets Wed 11/4 9:30 AM CT" in s and "as of Sun 11/1 7:15 AM CT" in s, "strip: on-demand % once, reset times and 'as of' in CT, though the browser is in Tokyo")
    h = pg.eval_on_selector(ST, "e => e.getBoundingClientRect().height"); check(h < 26, f"strip is one slim line on desktop ({h:.0f}px)")
    check(pg.query_selector(".ustile") is None, "the tall usage card is gone")
    a = pg.query_selector("a.t-usage")
    check(a is not None and a.get_attribute("href") == "https://example.com/usage" and a.get_attribute("target") == "_blank" and "noopener" in a.get_attribute("rel") and "Grok Bot usage: weekly 67.9% used" in a.get_attribute("aria-label"), "the square is a link: https, new tab, rel=noopener, with an aria label")
    pg.screenshot(path=str(SHOTS / "35b-gauge-green.png"))
    with ctx.expect_page() as np: pg.click(SQ)
    pop = np.value; pop.wait_for_load_state(); check(pop.url == "https://example.com/usage" and pop.evaluate("window.opener") is None, "click opens the details in a new tab without an opener"); pop.close()
    pg.focus("a.t-usage")
    with ctx.expect_page() as np: pg.keyboard.press("Enter")
    pop = np.value; pop.wait_for_load_state(); check(pop.url == "https://example.com/usage", "Enter on the square opens the details too"); pop.close()
    load(pg, U, {"weekly_used_pct": 80}); check(tone(pg) == "tone-green", "80% exactly: green")
    q, s = load(pg, U, {"weekly_used_pct": 85.5}); check(tone(pg) == "tone-amber" and "85.5%" in q, "above 80%: amber"); pg.screenshot(path=str(SHOTS / "35c-gauge-amber.png"))
    q, s = load(pg, U, {"weekly_used_pct": 91.2, "on_demand_pct": 100, "on_demand_maxed": True})
    check(tone(pg) == "tone-red" and pg.inner_text("#view-focus").count("Maxed") == 1 and "100%" not in s, "on-demand Maxed: red ring, Maxed shown once"); pg.screenshot(path=str(SHOTS / "35d-gauge-red-maxed.png"))
    q, s = load(pg, U, {"weekly_used_pct": 100}); check(tone(pg) == "tone-red" and "100%" in q and "100%+" not in q, "100%: red")
    q, s = load(pg, U, {"weekly_used_pct": 137.4}); full = dash(pg).split()
    check("100%+" in q and tone(pg) == "tone-red" and abs(float(full[0]) - float(full[1])) < 0.01, "over 100: 100%+, full ring, red")
    load(pg, U, {"detail_url": "http://example.com/usage"}); check(pg.query_selector("a.t-usage") is None and pg.query_selector("div.t-usage") is not None, "an http detail link is refused (no link)")
    load(pg, U, {"detail_url": "javascript:alert(1)"}); check(pg.query_selector("a.t-usage") is None, "a javascript: link is refused")
    q, s = load(pg, U, {"as_of": "2026-10-28T07:59:00-05:00"}); check(pg.query_selector(".usstale") is not None and "stale" in s, "as_of over 3 days old: stale note")
    load(pg, U, {"on_demand_used": 12.34, "on_demand_limit": 50, "bots": {"Example Bot": 9.87}})
    check("$" not in pg.inner_text("#view-focus") and "12.34" not in pg.content() and "Example Bot" not in pg.content(), "dollar fields and bots are never rendered")
    pg.evaluate("document.getElementById('view-focus').classList.add('printing')"); pg.emulate_media(media="print")
    check(pg.eval_on_selector(".tw.us", "e => getComputedStyle(e).display") == "none" and pg.eval_on_selector(ST, "e => getComputedStyle(e).display") == "none", "not printed"); pg.emulate_media(media="screen")
    pg.evaluate("document.getElementById('view-focus').classList.remove('printing')")
    check(pg.eval_on_selector(".usring .arc", "e => getComputedStyle(e).animationName") == "usglow", "the ring glows (animation) normally")
    q, s = load(pg, None); check("No usage data" in s and "—" in q and pg.query_selector("a.t-usage") is None and pg.query_selector(".usring .arc") is None, "no usage: an empty ring with — and 'No usage data' in the strip")
    q, s = load(pg, {"as_of": "bad"}); check("No usage data" in s and any(x.startswith("usage:") for x in pg.evaluate("DASH.app.state.snap.rejects")), "a bad usage block: 'No usage data' and a reject line; the snapshot still loads")
    ctx.close()
    rm = b.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce"); r = rm.new_page(); r.goto(URL); r.wait_for_selector(".usring .arc")
    check(r.eval_on_selector(".usring .arc", "e => getComputedStyle(e).animationName") == "none", "reduced motion: no glow animation"); rm.close()
    ip = b.new_context(viewport={"width": 820, "height": 1180}, timezone_id="America/New_York")
    ip.route("https://example.com/**", lambda r: r.fulfill(status=200, body="ok"))
    q2 = ip.new_page(); q2.on("pageerror", lambda e: errors.append(str(e))); q2.goto(URL); q2.wait_for_selector(SQ, timeout=60000); load(q2, U)
    boxes = q2.eval_on_selector_all(".tiles4 .sq", "e => e.map(x => { const r = x.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.top), r.width]; })")
    rows = sorted(set(x[2] for x in boxes)); sw = q2.evaluate("document.documentElement.scrollWidth")
    overlap = any(a[2] == c[2] and a[0] < c[1] and c[0] < a[1] for i, a in enumerate(boxes) for c in boxes[i + 1:])
    check(len(boxes) == 5 and len(rows) == 2 and not overlap and all(x[1] <= 820 for x in boxes) and sw <= 820, f"820 px: the five squares wrap onto two rows, no overlap, no sideways scroll ({boxes})")
    sh = q2.eval_on_selector(ST, "e => [e.getBoundingClientRect().height, e.scrollWidth <= e.clientWidth + 1]")
    check(sh[1] and sh[0] <= 44, f"820 px: the strip fits in at most two lines, nothing cut off ({sh})")
    q2.set_viewport_size({"width": 640, "height": 1000}); sh = q2.eval_on_selector(ST, "e => [e.getBoundingClientRect().height, e.scrollWidth <= e.clientWidth + 1]")
    check(sh[1] and sh[0] >= 26 and q2.eval_on_selector(ST, "e => e.getBoundingClientRect().right") <= 640, f"narrower (640 px, 200% zoom): the strip wraps instead of cutting off ({sh})")
    q2.set_viewport_size({"width": 820, "height": 1180})
    check("as of Sun 11/1 7:15 AM CT" in q2.inner_text(ST), "New York browser: still CT")
    q2.evaluate("window.scrollTo(0, 0)"); q2.wait_for_function("() => { const r = document.querySelector('.usstrip').getBoundingClientRect(), h = document.querySelector('header.top').getBoundingClientRect(); return document.querySelector('.tw.us').getBoundingClientRect().top >= h.bottom && r.bottom <= innerHeight; }")
    q2.screenshot(path=str(SHOTS / "35e-gauge-ipad.png")); ip.close(); b.close()
check(not errors, f"no page errors ({errors[:3]})")
print("T35 usage:", "PASS" if ok else "FAIL"); sys.exit(0 if ok else 1)
