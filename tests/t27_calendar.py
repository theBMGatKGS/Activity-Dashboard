"""T27 (00.06.000; 00.07.000: browser zone pinned to America/Chicago so wall-clock checks hold on any box zone): Today strip + prep card on Daily Focus, the calendar assistant calendar feed and Travel trips. Fictional example data only.
Part A (example, file://): strip under the header, 07–20 (widened by the flight), overlapping meetings side by side (no overlap
of boxes), private hold, travel band + leave-by, hotel chip, deadline markers, now line, staleness chip (ok / amber / red),
empty state without a feed, prep card (dialog, details, itinerary, Esc returns focus), real data after example drops example
events, accessibility, print palette, reduced motion. Part B (Data folder test stand-in as in T21/T24): a plaintext feed in an
unencrypted folder is NOT read; after encryption it is encrypted in place (.enc), read, cached under SECRET keys as envelopes,
and the folder holds no readable event text. Optional argv[1]: shots dir."""
import pathlib, shutil, tempfile, json, os, re, sys
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True; errors = []
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
Q = lambda now="2026-10-19T09:20:00-05:00": f"?now={now}&machine=test"
BOX = "(id => { const r = document.querySelector(`[data-cal='${id}']`).getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom]; })"
def inter(a, b): return a[0] < b[1] - 0.5 and b[0] < a[1] - 0.5 and a[2] < b[3] - 0.5 and b[2] < a[3] - 0.5
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(timezone_id="America/Chicago", viewport={"width": 1440, "height": 900}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto((SRC / "index.html").as_uri() + Q()); pg.wait_for_selector(".strip .sev")
    m = pg.evaluate("(() => { const m = DASH.app.state.stripModel; return [m.from, m.to, m.events.length, m.travel.length, m.hotels.length, m.leaveBy]; })()")
    check(m[:5] == [7, 20, 5, 2, 1], f"strip model: 07–20 (widened by the 19:45 landing), 5 meetings, drive + flight, hotel chip ({m})")
    hb = pg.evaluate("(() => { const h = document.querySelector('.fhead').getBoundingClientRect(), s = document.querySelector('.strip').getBoundingClientRect(); return s.top >= h.bottom - 1; })()")
    check(hb, "strip sits under the squares / meetings header")
    a, c = pg.evaluate(BOX, "CAL-2"), pg.evaluate(BOX, "CAL-3")
    check(not inter(a, c) and a[0] < c[1] and c[0] < a[1], f"overlapping meetings 10:00–11:00 and 10:30–11:30 sit side by side in their own lanes, boxes don't overlap ({a} / {c})")
    cls = pg.evaluate("['CAL-1','CAL-2','CAL-3','CAL-6'].map(i => document.querySelector(`[data-cal='${i}']`).className)")
    check("k-internal" in cls[0] and "k-client" in cls[1] and "cf" in cls[1] and "cf" in cls[2] and "k-hold" in cls[3] and "cf" not in cls[3], f"kinds: internal / client / private hold; overlaps hatched ({cls})")
    check("leave by 15:15" in pg.inner_text(".stripbar") and "Example Hotel ABC" in pg.inner_text(".stripbar"), "travel chip: leave by 15:15 (17:30 − 45 min drive − 90 min); tonight's hotel with cancel-by")
    check(pg.query_selector(".stv") is not None and "XYZ→ABC" in pg.inner_text(".strav"), "travel band shows the drive and the flight")
    check(pg.query_selector(".smk.over") is not None and pg.query_selector(".smk.today") is not None and pg.query_selector(".snow") is not None, "overdue / due-today markers and the now line")
    chip = pg.evaluate("[document.querySelector('.calchip').className, document.querySelector('.calchip').textContent]")
    check("ok" in chip[0] and "as of Mon 10/19 06:30" in chip[1], f"calendar chip shows the feed's as-of time ({chip})")
    sr = pg.evaluate("[document.querySelector('.strip').getAttribute('aria-labelledby'), document.getElementById('strip-sr').textContent, document.querySelector('.sevs').getAttribute('role'), [...document.querySelectorAll('.sev')].every(e => e.tagName === 'BUTTON' && /Open details/.test(e.getAttribute('aria-label')))]")
    check(sr[0] == "strip-h" and "5 meetings today, with overlaps, leave by 15:15" in sr[1] and sr[2] == "list" and sr[3], f"accessibility: named region, spoken summary, meetings are a list of buttons with full labels ({sr[1]!r})")
    if SHOTS: pg.locator("#view-focus").screenshot(path=str(SHOTS / "06000-1-focus-strip.png"), clip=None) if False else pg.screenshot(path=str(SHOTS / "06000-1-focus-strip.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 430})
    # prep card
    pg.focus("[data-cal='CAL-2']"); pg.keyboard.press("Enter"); pg.wait_for_selector("#prep .prepcard")
    t = pg.inner_text("#prep"); t = t + t.upper()
    check(all(x in t for x in ["Account A design review prep", "6 · account-a.example, example.com", "Teams link", "send riser layout markup", "ITINERARY TODAY", "FLIGHT", "leave by 15:15", "Example Hotel ABC"]), "prep card: time, attendee count + domains, Teams link, linked To Do, open loops, itinerary")
    check("@" not in t, "prep card shows no email addresses")
    hrefs = pg.evaluate("[...document.querySelectorAll('#prep a')].map(a => [a.href, a.rel, a.target])")
    check(all(h[0].startswith(("https://teams.microsoft.com/", "https://maps.apple.com")) and "noopener" in h[1] for h in hrefs), f"links: allow-listed hosts only, noopener ({hrefs})")
    check(pg.evaluate("document.activeElement.classList.contains('prepcard') && document.querySelector('#prep [role=dialog]').getAttribute('aria-labelledby') === 'prep-h'"), "prep card is a named dialog and takes focus")
    if SHOTS: pg.screenshot(path=str(SHOTS / "06000-2-prep-card.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 520})
    pg.keyboard.press("Escape"); pg.wait_for_timeout(50)
    check(pg.query_selector("#prep") is None and pg.evaluate("document.activeElement.dataset.cal") == "CAL-2", "Esc closes it and focus returns to the meeting")
    # staleness
    for now, lvl in (("2026-10-19T13:00:00-05:00", "amber"), ("2026-10-20T08:00:00-05:00", "red")):
        p2 = ctx.new_page(); p2.goto((SRC / "index.html").as_uri() + Q(now)); p2.wait_for_selector(".strip")
        ch = p2.evaluate("[document.querySelector('.calchip').className, document.querySelector('.calchip').getAttribute('title')]")
        check(lvl in ch[0] and ("Outlook session" in ch[1]), f"{lvl} chip when the feed is old ({now}: {ch[0]})")
        if SHOTS and lvl == "red": p2.screenshot(path=str(SHOTS / "06000-4-stale-red.png"), clip={"x": 0, "y": 180, "width": 1440, "height": 160})
        p2.close()
    # no feed: snapshot meetings + chip; nothing today: empty state
    pg.evaluate("(() => { const S = DASH.app.state; S.calFeed = null; S.tripsFeed = null; DASH.app.render(); })()")
    check("No calendar feed" in pg.inner_text(".stripbar") and pg.query_selector("[data-cal='CAL-6']") is None and pg.query_selector("[data-cal='CAL-2']") is not None, "no feed: chip says so; meetings still come from the snapshot")
    pg.evaluate("(() => { const S = DASH.app.state; S.snap.calendar = []; DASH.app.render(); })()")
    check(pg.query_selector(".strip.empty") is not None and "No meetings or travel today" in pg.inner_text(".strip"), "nothing today and no feed: a quiet empty state, no grid")
    if SHOTS: pg.screenshot(path=str(SHOTS / "06000-3-empty-no-feed.png"), clip={"x": 0, "y": 180, "width": 1440, "height": 120})
    # example -> real: example events never carry over
    p3 = ctx.new_page(); p3.goto((SRC / "index.html").as_uri() + Q()); p3.wait_for_selector(".strip .sev")
    raw = json.loads((SRC / "examples/example-snapshot.json").read_text()); raw.pop("example")
    p3.evaluate("r => DASH.app.useSnapshot(r, 'test')", raw); p3.wait_for_timeout(100)
    check(p3.evaluate("DASH.app.state.calFeed") is None and p3.query_selector("[data-cal='CAL-6']") is None, "real data after EXAMPLE DATA: example feed events are dropped (no carry-over)")
    check(p3.evaluate("['calendarSnap','trips'].every(k => DASH.db.SECRET.has(k))"), "calendarSnap and trips are SECRET keys")
    p3.close()
    # print + reduced motion
    pg.goto((SRC / "index.html").as_uri() + Q()); pg.wait_for_selector(".strip .sev")
    pg.evaluate("document.getElementById('view-focus').classList.add('printing')"); pg.emulate_media(media="print")
    pr = pg.evaluate("(() => { const q = s => getComputedStyle(document.querySelector(s)); return [q('.strip').backgroundColor, q('.sev.k-client').backgroundColor, q('.sev.k-client').borderLeftColor, q('.stv').color, q('.sev.cf').backgroundImage]; })()")
    check(pr == ["rgb(255, 255, 255)", "rgb(255, 255, 255)", "rgb(12, 119, 188)", "rgb(16, 38, 69)", "none"], f"print: white strip, outlined events (client = print blue #0C77BC), navy travel, no hatch fill ({pr})")
    if SHOTS: pg.screenshot(path=str(SHOTS / "06000-5-print.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 400})
    pg.emulate_media(media="screen"); pg.evaluate("document.getElementById('view-focus').classList.remove('printing')")
    c2 = b.new_context(timezone_id="America/Chicago", viewport={"width": 1440, "height": 900}, reduced_motion="reduce"); q2 = c2.new_page(); q2.goto((SRC / "index.html").as_uri() + Q()); q2.wait_for_selector(".sev")
    check(q2.evaluate("getComputedStyle(document.querySelector('.sev')).transitionDuration") == "0s", "reduced motion: no transitions on the strip"); c2.close()
    c3 = b.new_context(timezone_id="America/Chicago", viewport={"width": 900, "height": 900}); q3 = c3.new_page(); q3.goto((SRC / "index.html").as_uri() + Q()); q3.wait_for_selector(".sev")
    w = q3.evaluate("[document.querySelector('.strip').getBoundingClientRect().right, document.documentElement.clientWidth]")
    check(w[0] <= w[1], f"narrow / 200% zoom: strip fits the window ({w})")
    if SHOTS: q3.screenshot(path=str(SHOTS / "06000-6-narrow.png"), clip={"x": 0, "y": 0, "width": 900, "height": 700})
    c3.close()
    # 00.07.000 Z2: one unpinned check in Eastern: the same instants, shown in Eastern wall-clock (leave by 16:15 ET = 20:15Z)
    ce = b.new_context(timezone_id="America/New_York", viewport={"width": 1440, "height": 900}); qe = ce.new_page(); qe.goto((SRC / "index.html").as_uri() + Q()); qe.wait_for_selector(".strip .sev")
    me = qe.evaluate("(() => { const m = DASH.app.state.stripModel; return [m.from, m.to, m.leaveBy]; })()")
    check(me == [7, 21, "2026-10-19T20:15:00.000Z"] and "leave by 16:15" in qe.inner_text(".stripbar") and "as of Mon 10/19 07:30 ET" in qe.inner_text(".calchip"), f"Eastern (unpinned zone): leave-by is the same instant (20:15Z, shown 16:15 ET), strip ends 21:00 for the 20:45 ET landing, chip 07:30 ET ({me})")
    ce.close(); ctx.close()
    # ---------------- Part B: encrypted feed through the Data folder ----------------
    FS_JS = (SRC / "tests/t21_vault.py").read_text().split('FS_JS = """', 1)[1].split('"""', 1)[0]
    tmp = pathlib.Path(tempfile.mkdtemp()); app = tmp / "Dashboard"; shutil.copytree(SRC, app, ignore=shutil.ignore_patterns("tests", ".git"))
    snap = json.loads((app / "examples/example-snapshot.json").read_text()); snap.pop("example")
    w = {}; exec("pass"); calx = json.loads(re.search(r"=\s*(\{[\s\S]*\});\s*$", (app / "examples/example-calendar.js").read_text()).group(1))
    data = tmp / "Data"; data.mkdir(); (data / "inbox-snapshot.json").write_text(json.dumps(snap))
    (data / "calendar-snapshot.json").write_text(json.dumps(calx["calendar"])); (data / "trips.json").write_text(json.dumps(calx["trips"]))
    def fs(op, name, text):
        if op == "list": return sorted(x for x in os.listdir(data) if not x.endswith(".crswap"))
        pth = data / name
        if op == "read":
            if not pth.exists(): return None
            st = pth.stat(); return {"m": int(st.st_mtime_ns // 1_000_000), "size": st.st_size, "text": pth.read_text()}
        if op == "write": t = data / (name + ".crswap"); t.write_text(text); os.replace(t, pth); return True
        if op == "remove": pth.unlink(missing_ok=True); return True
    c = b.new_context(timezone_id="America/Chicago", viewport={"width": 1440, "height": 900}); c.expose_function("__fs", fs); c.add_init_script(FS_JS)
    mac = c.new_page(); mac.on("pageerror", lambda e: errors.append(f"B: {e}")); mac.on("dialog", lambda d: d.accept())
    mac.goto((app / "index.html").as_uri() + Q() .replace("machine=test", "machine=mac")); mac.wait_for_selector(".sq"); mac.evaluate("DASH.app.syncNow()"); mac.evaluate("DASH.app.flush()")
    probs = mac.evaluate("DASH.app.state.problems.join(' | ')")
    check(mac.evaluate("DASH.app.state.calFeed") is None and mac.query_selector("[data-cal='CAL-6']") is None and "only read encrypted" in probs, f"unencrypted folder: the plaintext feed is NOT read, and the sync chip says why")
    mac.click('.mtop:has-text("File")'); mac.click('[data-act="encryption"]'); mac.wait_for_selector("#vaultsetup"); mac.fill("#vp1", "correct horse battery 06000"); mac.fill("#vp2", "correct horse battery 06000"); mac.click("#vs-ok")
    mac.wait_for_selector("#rk-value", timeout=20000); mac.check("#rk-done"); mac.click("#rk-ok"); mac.wait_for_function("() => document.querySelector('#toast').textContent.startsWith('Data folder encrypted')", timeout=20000)
    mac.evaluate("DASH.app.syncNow()"); mac.evaluate("DASH.app.syncNow()"); mac.wait_for_timeout(300)
    names = sorted(os.listdir(data))
    check("calendar-snapshot.json.enc" in names and "trips.json.enc" in names, f"after encryption the feeds are encrypted in place ({names})")
    blob = "".join((data / n).read_text() for n in names if n.endswith(".enc") or n == "keyring.json")
    check(not any(x in blob for x in ["design review prep", "Example Hotel", "account-a.example", "XYZ"]), "the encrypted files hold no readable event, hotel or domain text")
    check(mac.evaluate("!!DASH.app.state.calFeed && DASH.app.state.calFeed.events.length === 6") and mac.query_selector("[data-cal='CAL-6']") is not None, "encrypted feed is read: the private hold from the feed shows in the strip")
    env = mac.evaluate("Promise.all(['calendarSnap','trips'].map(k => DASH.db.getRaw(k))).then(v => v.map(x => !!(x && x.dashCache === 1 && typeof x.env === 'string' && !x.env.includes('Example'))))")
    check(env == [True, True], f"IndexedDB cache: calendarSnap and trips are stored as encrypted envelopes ({env})")
    c.close(); b.close()
check(not errors, "no page errors" + (f": {errors[:3]}" if errors else ""))
print("T27", "PASS" if ok else "FAIL"); sys.exit(0 if ok else 1)
