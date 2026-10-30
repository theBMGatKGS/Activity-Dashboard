"""T33 (00.10.000): Events tab, Daily Focus count, Accounts 'Events' block, File → Links… and SAM bullets.  Fictional data only.
Part A (EXAMPLE DATA): the tab sits after Accounts; a 120-day strip; sections; Outlook time with its zone label; the Focus count is red
flags only; import refused; nothing cached; print in the print palette with the label.
Part B (Data folder stand-in): unencrypted folder refuses the import; after encryption events.md (sentinels) is saved as
events-store.json.enc only, with no sentinel in the folder, IndexedDB or localStorage; snapshot events[] merge with the notebook rows;
a cut-off title asks once (answer stored, survives reload); the Accounts tab shows the event; Links are stored encrypted, never exported;
the SAM link points at last month's notebook file; a locked folder refuses the import; an older snapshot without events still loads.  argv[1]: shots dir."""
import pathlib, shutil, tempfile, json, os, re, sys, hashlib, subprocess
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent)); import sentinels as SN
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True; errors = []
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(tempfile.mkdtemp(prefix="dash-t33-")); SHOTS.mkdir(parents=True, exist_ok=True)
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
Q = lambda view="events", m="test": f"?now=2026-10-19T09:20:00-05:00&machine={m}&view={view}"
S = lambda p: "EVNT_SENTINEL_" + hashlib.sha256(("t33:" + p).encode()).hexdigest()[:24]
FX = (SRC / "tests/fixtures/example-events.md").read_text(); ACC = (SRC / "tests/fixtures/example-account.md").read_text()
TMP = pathlib.Path(tempfile.mkdtemp())
def pick(pg, act, paths):
    with pg.expect_file_chooser() as fc: pg.evaluate(f"document.querySelector('[data-act={act}]').click()")
    fc.value.set_files([str(x) for x in paths]); pg.wait_for_timeout(250)
with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------------- Part A: EXAMPLE DATA ----------------
    ctx = b.new_context(viewport={"width": 1440, "height": 900}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e))); pg.on("dialog", lambda d: d.accept())
    pg.goto((SRC / "index.html").as_uri() + Q()); pg.wait_for_selector(".evrow")
    tabs = pg.eval_on_selector_all(".tabs .tab", "e => e.map(x => x.dataset.view)")
    check(tabs.index("calendar") == tabs.index("accounts") + 1 and tabs.index("events") == tabs.index("calendar") + 1, f"Calendar sits after Accounts, then Events ({tabs})")
    check(pg.eval_on_selector_all(".evstrip .evd", "e => e.length") == 120 and pg.query_selector(".evstrip .evd.red") is not None, "120-day month strip with a red dot")
    check([h.split(" ")[0] for h in pg.eval_on_selector_all(".evsec h3", "e => e.map(x => x.textContent.trim())")] == ["Needs", "Upcoming"], "sections: Needs action, then Upcoming")
    check(re.search(r"18:00–20:00 CT", pg.inner_text("#view-events")) is not None and "all day" in pg.inner_text("#view-events"), "Outlook's time is shown with its zone label; all-day events say so")
    check("Trip data not available" in pg.inner_text(".evlegend"), "no trip data: the overlap flag is hidden with 'Trip data not available'")
    check(pg.query_selector(".evrow [data-accgo]") is not None, "target accounts link to the Accounts tab")
    pg.screenshot(path=str(SHOTS / "33a-events-example.png"), full_page=True)
    pick(pg, "importEvents", [SRC / "tests/fixtures/example-events.md"]); t = pg.inner_text("#toast")
    check("Load your real data first" in t and pg.evaluate("DASH.app.state.evStore.events.length") == 2, f"EXAMPLE DATA refuses Import events ({t[:50]})")
    check(pg.evaluate("DASH.db.getRaw('eventsStore')") is None, "example events are never cached")
    pg.evaluate("document.getElementById('view-events').classList.add('printing')"); pg.emulate_media(media="print")
    bg = pg.evaluate("getComputedStyle(document.getElementById('view-events')).backgroundColor"); vis = pg.evaluate("[getComputedStyle(document.querySelector('.evlist')).display, getComputedStyle(document.querySelector('.evprint')).display]")
    check(bg == "rgb(255, 255, 255)" and vis == ["none", "block"] and "Restricted - Internal Use Only" in pg.inner_text(".evprint"), f"print: white paper, list view, label in the footer ({bg} {vis})")
    pg.pdf(path=str(SHOTS / "33b-events-print.pdf"), width="8.5in", height="11in", print_background=True)
    pages = int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", str(SHOTS / "33b-events-print.pdf")], capture_output=True, text=True).stdout).group(1))
    check(pages == 1, f"print: one page ({pages})")
    subprocess.run(["pdftoppm", "-png", "-r", "70", "-f", "1", "-l", "1", "-singlefile", str(SHOTS / "33b-events-print.pdf"), str(SHOTS / "33b-events-print")], check=True)
    pg.emulate_media(media="screen")
    pg.goto((SRC / "index.html").as_uri() + Q("focus")); pg.wait_for_selector(".sq"); pg.wait_for_timeout(200)
    ef = pg.query_selector(".evfocus")
    check(ef is not None and ef.query_selector(".badge").inner_text() == "1" and "Example Expo 2026" in ef.inner_text() and "Example Chapter" not in ef.inner_text(), "Daily Focus: 🎪 Events counts red-flag events only")
    pg.screenshot(path=str(SHOTS / "33c-focus-events-count.png"))
    pg.click(".evfocus [data-evgo]"); pg.wait_for_timeout(100); check(pg.evaluate("DASH.app.state.view") == "events", "the Focus row opens the Events tab")
    # Calendar tab (rev 3): events only, four months, red dots, Next 3, counts; a click opens the row in Events
    pg.goto((SRC / "index.html").as_uri() + Q("calendar")); pg.wait_for_selector(".calmonth", timeout=60000)
    ct = pg.inner_text("#view-calendar")
    check(pg.eval_on_selector_all(".calmonth", "e => e.length") == 4 and [h.strip() for h in pg.eval_on_selector_all(".calmonth h3", "e => e.map(x => x.textContent)")][:1] == ["October 2026"], "Calendar: four months from this month")
    check(pg.eval_on_selector_all(".calgrid th", "e => e.slice(0, 7).map(x => x.textContent)") == ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"], "Calendar: weeks start Monday")
    check(pg.query_selector(".calday.red .dot") is not None and pg.query_selector(".calday.today") is not None, "Calendar: red dot on days that need action; today outlined")
    check("1 need action" in pg.inner_text(".calcounts").replace("\n", " ") and "Next: Example Expo 2026" in pg.inner_text(".calcounts"), "Calendar: counts and the next event")
    check(pg.eval_on_selector_all(".calcard", "e => e.length") <= 3 and "Example Hold Fair" not in pg.inner_text(".calnext3"), "Calendar: Next 3 skips on-hold events")
    check("meetings stay on Totals" in ct, "Calendar: events only; meetings stay on Totals")
    pg.screenshot(path=str(SHOTS / "34a-calendar-desktop.png"), full_page=True)
    pg.click(".calcard"); pg.wait_for_timeout(300)
    check(pg.evaluate("DASH.app.state.view") == "events" and pg.query_selector(".evlist .evrow.flash") is not None, "Calendar: a card opens Events with the row highlighted")
    pg.goto((SRC / "index.html").as_uri() + Q("calendar")); pg.wait_for_selector(".calmonth"); pg.click("button.calday.red"); pg.wait_for_timeout(300)
    check(pg.evaluate("DASH.app.state.view") == "events" and pg.query_selector(".evlist .evrow.dayhit, .evlist .evrow.flash") is not None, "Calendar: a day opens Events with that day's rows marked")
    pg.set_viewport_size({"width": 820, "height": 1180}); pg.goto((SRC / "index.html").as_uri() + Q("calendar")); pg.wait_for_selector(".calmonth")
    sw = pg.evaluate("document.documentElement.scrollWidth"); hs = pg.eval_on_selector_all("button.calday, .calcard", "e => Math.min(...e.map(x => x.getBoundingClientRect().height))")
    check(sw <= 820 and hs >= 44, f"Calendar on iPad width: no sideways scroll, 44 px targets ({sw} {hs})")
    pg.screenshot(path=str(SHOTS / "34b-calendar-ipad.png"), full_page=True)
    pg.set_viewport_size({"width": 1440, "height": 900}); pg.goto((SRC / "index.html").as_uri() + Q("calendar")); pg.wait_for_selector(".calmonth")
    pg.evaluate("document.getElementById('view-calendar').classList.add('printing')"); pg.emulate_media(media="print")
    check(pg.evaluate("getComputedStyle(document.getElementById('view-calendar')).backgroundColor") == "rgb(255, 255, 255)" and "Restricted - Internal Use Only" in pg.inner_text(".calprintfoot"), "Calendar print: white paper with the label")
    pg.emulate_media(media="screen")
    ctx.close()
    # ---------------- Part B: Data folder ----------------
    FS_JS = (SRC / "tests/t21_vault.py").read_text().split('FS_JS = """', 1)[1].split('"""', 1)[0]
    tmp = pathlib.Path(tempfile.mkdtemp()); app = tmp / "Dashboard"; shutil.copytree(SRC, app, ignore=shutil.ignore_patterns("tests", ".git"))
    snap = json.loads((app / "examples/example-snapshot.json").read_text()); snap.pop("example")
    OLD = json.loads(json.dumps(snap))
    snap["events"] = [
        {"id": "ev-expo", "title": "Example Expo 2026", "title_truncated": False, "start_date": "2026-11-08", "end_date": "2026-11-10", "all_day": True, "start": None, "end": None, "zone": "America/Chicago", "location": "Springfield, ST", "category": "Tradeshow", "show_as": "oof"},
        {"id": "ev-summit", "title": "Example Summit Annual Conference and", "title_truncated": True, "start_date": "2026-11-20", "end_date": "2026-11-21", "all_day": True, "start": None, "end": None, "zone": "America/Chicago", "location": "Riverton, ST", "category": None, "show_as": "busy"},
        {"id": "ev-other", "title": "Example Other Show", "title_truncated": False, "start_date": "2026-11-12", "end_date": "2026-11-12", "all_day": False, "start": "2026-11-12T10:00:00-05:00", "end": "2026-11-12T15:00:00-05:00", "zone": "America/New_York", "location": "Bayside, ST", "category": None, "show_as": "tentative"}]
    SENTS = [S(k) for k in ("series", "role", "follow", "note", "foot")]
    md = FX.replace("Example Association", SENTS[0]).replace("| exhibitor |", "| " + SENTS[1] + " |").replace("Fictional footnote text.", SENTS[4]).replace("none in vault", SENTS[3]).replace("[[projects/example-booth\\|booth plan]]", "[[projects/example-booth\\|booth plan]], " + SENTS[2])
    md = md.replace("| Example Hold Fair | 2026-12-02 | 2026-12-03 | Lakeside, ST | ? |", "| Example Hold Fair | 2026-12-02 | 2026-12-03 | Lakeside, ST | <img src=x onerror=window.__xss=1> |")
    md = md.replace("accounts/owner-operators/acme-fab", "accounts/owner-operators/example-account")   # the account fixture's slug
    src = TMP / "events.md"; src.write_text(md)
    acc = TMP / "example-account.md"; acc.write_text(ACC)
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
    mac.goto((app / "index.html").as_uri() + Q("events", "mac")); mac.wait_for_selector("#view-events"); mac.evaluate("DASH.app.syncNow()"); mac.evaluate("DASH.app.flush()"); mac.wait_for_timeout(300)
    check(mac.evaluate("DASH.app.state.evStore") is None and mac.eval_on_selector_all(".evlist .evrow", "e => e.length") == 3 and "In Outlook, no details yet" in mac.inner_text("#view-events"), "real data: no example events; the snapshot's three Outlook events show with no details yet")
    pick(mac, "importEvents", [src]); mac.evaluate("DASH.app.flush()")
    check("needs an encrypted" in mac.inner_text("#toast") and mac.evaluate("DASH.app.state.evStore") is None and not any(x.startswith("events") for x in os.listdir(data)), "unencrypted folder: events import refused; nothing saved")
    mac.click('.mtop:has-text("File")'); mac.click('[data-act="links"]'); mac.wait_for_timeout(200)
    check(mac.query_selector("#linksdlg") is None and "Links need an encrypted" in mac.inner_text("#toast"), "unencrypted folder: Links refuses to store anything")
    mac.click('.mtop:has-text("File")'); mac.click('[data-act="encryption"]'); mac.wait_for_selector("#vaultsetup"); mac.fill("#vp1", "correct horse battery 10000"); mac.fill("#vp2", "correct horse battery 10000"); mac.click("#vs-ok")
    mac.wait_for_selector("#rk-value", timeout=20000); mac.check("#rk-done"); mac.click("#rk-ok"); mac.wait_for_function("() => document.querySelector('#toast').textContent.startsWith('Data folder encrypted')", timeout=20000)
    bad = TMP / "bad" / "events.md"; bad.parent.mkdir(exist_ok=True); bad.write_text(md.replace("| registered |", "| maybe |")); pick(mac, "importEvents", [bad])
    check("Nothing imported" in mac.inner_text("#toast") and mac.evaluate("DASH.app.state.evStore") is None and re.search(r"events\.md:\d+ STATUS", mac.inner_text(".projrej")) is not None, "a bad status refuses the whole file, listed as file:line RULE")
    pick(mac, "importAccounts", [acc]); mac.evaluate("DASH.app.flush()"); mac.wait_for_timeout(200)
    pick(mac, "importEvents", [src]); mac.evaluate("DASH.app.flush()"); mac.wait_for_timeout(300)
    names = sorted(os.listdir(data))
    check("events-store.json.enc" in names and not any(n.startswith("events") and not n.endswith(".enc") for n in names), f"saved as events-store.json.enc only ({[n for n in names if n.startswith('events')]})")
    lk = SN.leaks({n: (data / n).read_text() for n in names if n.endswith(".enc") or n == "keyring.json"}, SENTS)
    check(not lk, f"Data folder files hold none of the {len(SENTS)} sentinels, raw or decoded ({lk[:2]})")
    env = mac.evaluate("DASH.db.getRaw('eventsStore').then(x => x && x.dashCache === 1 ? x.env : null)")
    check(env and not SN.leaks({"e": env}, SENTS), "IndexedDB: eventsStore is an encrypted envelope with no sentinels")
    check(not SN.leaks({"ls": mac.evaluate("JSON.stringify(Object.assign({}, localStorage))")}, SENTS), "localStorage holds no sentinels")
    dec = mac.evaluate("(async () => { const f = await (await window.DASH_TEST_FS.getFileHandle('events-store.json.enc')).getFile(); return await DASH.vault.decrypt(DASH.app.state.vault.key, DASH.app.state.vault.kr, await f.text(), 'events'); })()")
    check(all(s in dec for s in SENTS), f"control: the decrypted events store holds every sentinel ({[i for i, s in enumerate(SENTS) if s not in dec]})")
    txt = mac.inner_text("#view-events")
    check("Outlook + notebook" in txt and "Example Other Show" in txt and "10:00–15:00 ET" in txt, "Outlook and notebook rows merge; a New York event shows its own ET label")
    check(mac.evaluate("window.__xss") is None and "<img src=x" in txt, "HTML in a cell is shown as text, never run")
    ask = mac.query_selector(".evask"); check(ask is not None and "Example Summit Annual Conference and Workshop" in ask.inner_text(), "a cut-off Outlook title asks to link to the one matching row")
    mac.screenshot(path=str(SHOTS / "33d-events-possible-match.png"), full_page=True)
    mac.click(".evask [data-ch=link]"); mac.evaluate("DASH.app.flush()"); mac.wait_for_timeout(200)
    check(mac.query_selector(".evask") is None and mac.evaluate("DASH.app.state.evStore.answers['ev-summit'].choice") == "link", "Link: stored in the encrypted events store")
    mac.click("[data-evpast]"); mac.wait_for_timeout(100); check("Example Fall Forum" in mac.inner_text("#evs-past") and "Met at this event" in mac.inner_text("#evs-past"), "past events stay under Past with the accounts met there")
    mac.screenshot(path=str(SHOTS / "33e-events-real-fixture.png"), full_page=True)
    mac.evaluate("DASH.app.state.accSel = 'example-account'"); mac.click('.tab[data-view="accounts"]'); mac.wait_for_timeout(200)
    check("Example Expo 2026" in mac.inner_text(".accmain") and "Example Fall Forum" in mac.inner_text(".accmain"), "Accounts tab: the account shows its upcoming event and where it was met")
    # Links (encrypted, per computer, never exported) and SAM bullets
    mac.click('.mtop:has-text("File")'); mac.click('[data-act="links"]'); mac.wait_for_selector("#linksdlg")
    mac.fill("#lk-vault", "Example Vault"); mac.fill("#lk-repo", "javascript:alert(1)"); mac.click("#lk-save"); mac.wait_for_timeout(100)
    check("repo address" in mac.inner_text("#lk-err") and mac.query_selector("#linksdlg") is not None, "Links: a non-GitHub address is refused")
    mac.fill("#lk-repo", "https://github.com/example-owner/example-notebook"); mac.screenshot(path=str(SHOTS / "33f-links-dialog.png")); mac.click("#lk-save"); mac.wait_for_timeout(200)
    raw = mac.evaluate("DASH.db.getRaw('links')"); check(raw and raw.get("dashCache") == 1 and "example-owner" not in json.dumps(raw), "Links are stored as an encrypted envelope")
    exp = mac.evaluate("DASH.db.exportAll().then(x => JSON.stringify(x))")
    check("example-owner" not in exp and "links" not in json.loads(exp) and "eventsStore" in json.loads(exp), "Links are never in File → Export local data (the events store is, like the accounts store)")
    mac.click('.mtop:has-text("File")'); mac.click('[data-act="samLink"]'); mac.wait_for_selector("#samdlg")
    hrefs = mac.eval_on_selector_all("#samdlg a.btn", "e => e.map(x => x.getAttribute('href'))")
    check("September 2026" in mac.inner_text("#samdlg") and "obsidian://open?vault=Example%20Vault&file=reports%2Fsam-activity%2F2026-09" in hrefs and "https://github.com/example-owner/example-notebook/blob/main/reports/sam-activity/2026-09.md" in hrefs and any("crm/outbox/sam-report/2026-09/sources.md" in h for h in hrefs), f"SAM bullets: last month's notebook file and sources file, Obsidian and GitHub ({len(hrefs)} links)")
    check(all(h.startswith(("obsidian://", "https://github.com/")) for h in hrefs) and mac.eval_on_selector_all("#samdlg a.btn", "e => e.every(x => x.rel.includes('noopener'))"), "SAM links: only obsidian:// and https://github.com/, opened with noopener")
    mac.screenshot(path=str(SHOTS / "33g-sam-bullets.png")); mac.click("#sam-close")
    # reload: the answer and links survive; locked folder refuses the import
    mac.reload(); mac.wait_for_selector("#view-events"); mac.wait_for_function("() => DASH.app.state.vault.key && DASH.app.state.evStore", timeout=20000)   # remembered on this computer
    mac.click('.tab[data-view="events"]'); mac.wait_for_timeout(300)
    check(mac.query_selector(".evask") is None and mac.evaluate("DASH.app.state.evStore.answers['ev-summit'].choice") == "link", "after reload: the cut-off title is not asked again")
    check(mac.query_selector('.evrow a.evnote[href^="obsidian://open?vault=Example%20Vault"]') is not None, "after reload: Links are read back; note paths open in Obsidian")
    c.close()
    # locked folder: import refused, nothing written
    c2 = b.new_context(viewport={"width": 1440, "height": 900}); c2.expose_function("__fs", fs); c2.add_init_script(FS_JS); lp = c2.new_page(); lp.on("pageerror", lambda e: errors.append(f"L: {e}")); lp.on("dialog", lambda d: d.accept())
    lp.goto((app / "index.html").as_uri() + Q("events", "mac2")); lp.wait_for_selector("#vaultunlock", timeout=20000); lp.wait_for_timeout(300)
    before = (data / "events-store.json.enc").read_text(); pick(lp, "importEvents", [src])
    check("Nothing was imported" in lp.inner_text("#toast") and (data / "events-store.json.enc").read_text() == before, "locked folder: the import is refused and nothing is written")
    c2.close()
    # an older snapshot without events still loads
    c3 = b.new_context(viewport={"width": 1440, "height": 900}); op = c3.new_page(); op.on("pageerror", lambda e: errors.append(f"O: {e}"))
    oldf = TMP / "old-snapshot.json"; oldf.write_text(json.dumps(OLD))
    op.goto((SRC / "index.html").as_uri() + Q("focus", "old")); op.wait_for_selector(".sq")
    with op.expect_file_chooser() as fc: op.evaluate("DASH.app.openSnapshot ? DASH.app.openSnapshot() : document.querySelector('[data-act=open]').click()")
    fc.value.set_files(str(oldf)); op.wait_for_timeout(500)
    check(op.evaluate("DASH.app.state.snap.example") is False and op.evaluate("DASH.app.state.snap.events.length") == 0 and op.evaluate("DASH.app.state.snap.hasEvents") is False, "a snapshot without events[] loads (no events, no error)")
    op.click('.tab[data-view="events"]'); op.wait_for_timeout(100); check("no Outlook" in op.inner_text("#view-events") or "No events yet" in op.inner_text("#view-events"), "Events tab explains there is no Outlook section yet")
    c3.close(); b.close()
check(not errors, f"no page errors ({errors[:3]})")
print("T33 events:", "PASS" if ok else "FAIL"); sys.exit(0 if ok else 1)
