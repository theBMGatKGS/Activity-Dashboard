"""T35 (00.10.001): Grok Bot usage tile on Daily Focus.  Fictional numbers only.  Example placeholder; a real snapshot with usage:
percent with a bar, on-demand percent or Maxed, reset times and 'as of' in CT whatever the browser's zone; warning tone above 80% or
Maxed; click and Enter open the https detail link in a new tab with noopener; http links refused; no usage -> 'No usage data';
stale after 3 days; never a dollar amount; 44 px on the iPad.  argv[1]: shots dir."""
import pathlib, tempfile, json, sys, re
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True; errors = []
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(tempfile.mkdtemp(prefix="dash-t35-")); SHOTS.mkdir(parents=True, exist_ok=True)
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
URL = (SRC / "index.html").as_uri() + "?now=2026-11-01T08:00:00-06:00&machine=test&view=focus"
SNAP = json.loads((SRC / "examples/example-snapshot.json").read_text()); SNAP.pop("example"); SNAP["generated_at"] = "2026-11-01T07:30:00-06:00"
U = {"as_of": "2026-11-01T07:15:00-06:00", "weekly_used_pct": 67.9, "weekly_resets": "2026-11-06T05:03:00-06:00", "on_demand_pct": 24.7, "on_demand_maxed": False, "on_demand_resets": "2026-11-04T09:30:00-06:00", "detail_url": "https://example.com/usage"}
def load(pg, usage, extra=None):
    s = json.loads(json.dumps(SNAP))
    if usage is not None: s["usage"] = dict(usage, **(extra or {}))
    pg.evaluate("s => DASH.app.useSnapshot(s, 'test')", s); pg.wait_for_function("() => DASH.app.state.snap && DASH.app.state.snap.example === false"); pg.evaluate("DASH.app.render()")
    return pg.inner_text(".ustile")
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, timezone_id="Asia/Tokyo")   # the browser's zone is NOT Chicago
    ctx.route("https://example.com/**", lambda r: r.fulfill(status=200, body="usage details", content_type="text/plain"))
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto(URL); pg.wait_for_selector(".ustile", timeout=60000)
    t = pg.inner_text(".ustile")
    check("Grok Bot usage" in t and "example" in t and "42%" in t and "18.5%" in t and pg.query_selector("a.ustile") is None, f"EXAMPLE DATA: placeholder numbers, no link ({t[:60]!r})")
    pg.screenshot(path=str(SHOTS / "35a-usage-example.png"))
    t = load(pg, U)
    check("67.9%" in t and "24.7%" in t and pg.eval_on_selector(".usbar i", "e => e.style.width") == "67.9%", "weekly percent with a bar; on-demand percent")
    check("Weekly resets Fri 11/6 5:03 AM CT" in t and "On-demand resets Wed 11/4 9:30 AM CT" in t and "as of Sun 11/1 7:15 AM CT" in t, "reset times and 'as of' in CT, though the browser is in Tokyo")
    check(pg.query_selector(".ustile.warn") is None and pg.query_selector(".usstale") is None, "normal tone; not stale")
    a = pg.query_selector("a.ustile")
    check(a is not None and a.get_attribute("href") == "https://example.com/usage" and a.get_attribute("target") == "_blank" and "noopener" in a.get_attribute("rel"), "the tile is a link: https, new tab, rel=noopener")
    pg.screenshot(path=str(SHOTS / "35b-usage-normal.png"))
    with ctx.expect_page() as np: pg.click(".ustile")
    pop = np.value; pop.wait_for_load_state(); check(pop.url == "https://example.com/usage" and pop.evaluate("window.opener") is None, "click opens the details in a new tab without an opener"); pop.close()
    pg.focus("a.ustile")
    with ctx.expect_page() as np: pg.keyboard.press("Enter")
    pop = np.value; pop.wait_for_load_state(); check(pop.url == "https://example.com/usage", "Enter on the tile opens the details too"); pop.close()
    t = load(pg, U, {"weekly_used_pct": 80}); check(pg.query_selector(".ustile.warn") is None, "80% exactly: normal tone")
    t = load(pg, U, {"weekly_used_pct": 85.5}); check(pg.query_selector(".ustile.warn") is not None and "85.5%" in t, "weekly above 80%: warning tone")
    t = load(pg, U, {"on_demand_pct": 100, "on_demand_maxed": True}); check(pg.query_selector(".ustile.warn") is not None and "Maxed" in t and "100%" not in t, "on-demand used up: Maxed, warning tone")
    t = load(pg, U, {"weekly_used_pct": 91.2, "on_demand_pct": 100, "on_demand_maxed": True}); pg.screenshot(path=str(SHOTS / "35c-usage-warning.png"))
    t = load(pg, U, {"detail_url": "http://example.com/usage"}); check(pg.query_selector("a.ustile") is None and pg.query_selector("div.ustile") is not None, "an http detail link is refused (no link)")
    t = load(pg, U, {"detail_url": "javascript:alert(1)"}); check(pg.query_selector("a.ustile") is None, "a javascript: link is refused")
    t = load(pg, U, {"as_of": "2026-10-28T07:59:00-05:00"}); check(pg.query_selector(".usstale") is not None and "stale" in t, "as_of over 3 days old: stale note")
    t = load(pg, U, {"on_demand_used": 12.34, "on_demand_limit": 50, "bots": {"Example Bot": 9.87}})
    check("$" not in pg.inner_text("#view-focus") and "12.34" not in pg.content() and "Example Bot" not in pg.content(), "dollar fields and bots are never rendered")
    t = load(pg, None); check("No usage data" in t and pg.query_selector("a.ustile") is None, "no usage in the snapshot: 'No usage data'")
    t = load(pg, {"as_of": "bad"}); check("No usage data" in t and any(x.startswith("usage:") for x in pg.evaluate("DASH.app.state.snap.rejects")), "a bad usage block: 'No usage data' and a reject line; the snapshot still loads")
    ctx.close()
    ip = b.new_context(viewport={"width": 820, "height": 1180}, timezone_id="America/New_York"); ctx2 = ip
    ip.route("https://example.com/**", lambda r: r.fulfill(status=200, body="ok"))
    q = ip.new_page(); q.on("pageerror", lambda e: errors.append(str(e))); q.goto(URL); q.wait_for_selector(".ustile", timeout=60000); load(q, U)
    hgt = q.eval_on_selector("a.ustile", "e => e.getBoundingClientRect().height"); sw = q.evaluate("document.documentElement.scrollWidth")
    check(hgt >= 44 and sw <= 820, f"iPad width: 44 px tap target, no sideways scroll ({hgt:.0f} px, {sw})")
    check("as of Sun 11/1 7:15 AM CT" in q.inner_text(".ustile"), "New York browser: still CT")
    q.eval_on_selector(".ustile", "e => e.scrollIntoView()"); q.screenshot(path=str(SHOTS / "35d-usage-ipad.png")); ip.close(); b.close()
check(not errors, f"no page errors ({errors[:3]})")
print("T35 usage:", "PASS" if ok else "FAIL"); sys.exit(0 if ok else 1)
