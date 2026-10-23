"""T25 (00.05.001): the time zone follows the computer's clock (no setting). Fictional example data only.
Chromium's zone is set per test (timezone_id / CDP Emulation.setTimezoneOverride) to check Eastern and Pacific day
boundaries, the as-of stamp, the snooze 08:00 return, the read-only zone chip, and a zone change mid-session
(focus, visibility change, poll) that recomputes without a reload."""
import pathlib, sys, re
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
URL = (SRC / "index.html").as_uri() + "?now=2026-10-19T23:30:00-05:00&machine=test"   # 23:30 CDT Mon = 00:30 EDT Tue = 21:30 PDT Mon
errors = []
def opened(b, tz):
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, **({"timezone_id": tz} if tz else {})); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e))); pg.goto(URL); pg.wait_for_selector("#view-focus .sq"); return ctx, pg
st = lambda pg: pg.evaluate("({ today: DASH.app.state.today, tz: DASH.rules.getTimeZone(), chip: document.getElementById('tz').textContent, asof: document.getElementById('asof').textContent, focusAsof: (document.querySelector('#view-focus .asof') || {}).textContent || '', due: document.querySelector('.sq.t-today b').textContent, over: document.querySelector('.sq.t-over b').textContent })")
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx, pg = opened(b, "America/Chicago"); c = st(pg)
    check(c["tz"] == "America/Chicago" and c["today"] == "2026-10-19" and c["chip"] == "CT · America/Chicago", f"Chicago (default behaviour unchanged): today Mon 10/19, chip 'CT · America/Chicago' ({c})")
    check(" CT " in c["asof"] + " " and "CT" in c["focusAsof"], f"as-of stamp says CT ({c['asof']!r}, {c['focusAsof']!r})")
    check(pg.get_attribute("#tz", "role") == "status" and not pg.query_selector("#tz input, #tz select, #tz button") and not pg.query_selector("[data-act=timeZone], select#tz-pick"), "zone shown read-only (status chip, no picker or menu item)")
    chicago = c; ctx.close()
    ctx, pg = opened(b, "America/New_York"); c = st(pg)
    check(c["today"] == "2026-10-20" and c["chip"] == "ET · America/New_York", f"Eastern: 00:30 EDT is already Tue 10/20 ({c})")
    check("ET" in c["asof"] and "08:30" in c["focusAsof"] and "ET" in c["focusAsof"], f"as-of in Eastern time (07:30 CDT = 08:30 ET) ({c['asof']!r}, {c['focusAsof']!r})")
    check((c["due"], c["over"]) != (chicago["due"], chicago["over"]), f"Due Today / Overdue follow the Eastern day (CT {chicago['due']}/{chicago['over']} vs ET {c['due']}/{c['over']})")
    ctx.close()
    ctx, pg = opened(b, "America/Los_Angeles"); c = st(pg)
    check(c["today"] == "2026-10-19" and c["chip"] == "PT · America/Los_Angeles" and "05:30" in c["focusAsof"], f"Pacific: still Mon 10/19 (21:30 PDT), as-of 05:30 PT ({c})")
    task = pg.get_attribute("#view-focus [data-fsnooze]:not([disabled])", "data-fsnooze"); pg.click(f"#view-focus [data-fsnooze='{task}']")
    pg.click("[role=menuitem] >> text=Tomorrow"); pg.wait_for_timeout(200)
    un = pg.evaluate(f"DASH.app.state.flags['snooze:{task}'].until")
    check(un == "2026-10-20T15:00:00.000Z", f"Snooze → Tomorrow returns at 08:00 PT (15:00Z), not 08:00 CT ({un})")
    toast = pg.inner_text("#undo") if pg.query_selector("#undo") else ""
    check("08:00 PT" in toast, f"snooze message names the zone ({toast!r})")
    ctx.close()
    # ---- mid-session zone change (travel): no reload ----
    ctx, pg = opened(b, None); cdp = ctx.new_cdp_session(pg)   # no context zone, so CDP can change it mid-session
    cdp.send("Emulation.setTimezoneOverride", {"timezoneId": "America/Chicago"}); pg.evaluate("DASH.app.checkTz()")
    pg.evaluate("window.__noReload = 1"); before = st(pg)
    cdp.send("Emulation.setTimezoneOverride", {"timezoneId": ""}); cdp.send("Emulation.setTimezoneOverride", {"timezoneId": "America/New_York"})
    pg.evaluate("window.dispatchEvent(new Event('focus'))"); pg.wait_for_timeout(300); c = st(pg)
    check(pg.evaluate("window.__noReload") == 1 and c["tz"] == "America/New_York" and c["today"] == "2026-10-20" and c["chip"] == "ET · America/New_York", f"zone change detected on focus, no reload ({c})")
    check((c["due"], c["over"]) != (before["due"], before["over"]) and "ET" in c["asof"] and "08:30" in c["focusAsof"], f"Due Today / Overdue and as-of recomputed (CT {before['due']}/{before['over']} → ET {c['due']}/{c['over']}, {c['focusAsof']!r})")
    check("America/New_York" in pg.inner_text("body"), "a message tells the user the zone changed")
    cdp.send("Emulation.setTimezoneOverride", {"timezoneId": ""}); cdp.send("Emulation.setTimezoneOverride", {"timezoneId": "America/Los_Angeles"})
    pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_timeout(300); c = st(pg)
    check(c["tz"] == "America/Los_Angeles" and c["today"] == "2026-10-19" and "05:30" in c["focusAsof"], f"zone change detected on visibility change ({c})")
    cdp.send("Emulation.setTimezoneOverride", {"timezoneId": ""}); cdp.send("Emulation.setTimezoneOverride", {"timezoneId": "America/Chicago"})
    check(pg.evaluate("DASH.app.checkTz()") is True and st(pg)["chip"] == "CT · America/Chicago", "poll check (checkTz, run every poll) picks up the change back to Chicago")
    check(pg.evaluate("DASH.app.checkTz()") is False, "no change → nothing recomputed")
    task = pg.get_attribute("#view-focus [data-fsnooze]:not([disabled])", "data-fsnooze"); pg.click(f"#view-focus [data-fsnooze='{task}']")
    pg.click("[role=menuitem] >> text=Tomorrow"); pg.wait_for_timeout(200)
    check(pg.evaluate(f"DASH.app.state.flags['snooze:{task}'].until") == "2026-10-20T13:00:00.000Z", "after travelling back, Snooze → Tomorrow is 08:00 CT again")
    pg.screenshot(path=str(pathlib.Path(sys.argv[1]) / "tz-chip.png") if len(sys.argv) > 1 else "/tmp/tz-chip.png", clip={"x": 0, "y": 0, "width": 1440, "height": 60})
    ctx.close()
    check(not errors, f"no page errors {errors}")
    b.close()
print("T25 PASS" if ok else "T25 FAIL"); sys.exit(0 if ok else 1)
