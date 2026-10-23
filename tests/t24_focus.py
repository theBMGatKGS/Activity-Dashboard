"""T24 (00.05): Daily Focus home screen in Chromium. Fictional example data only (synthetic spec title "NFPA 318 Fab Ceiling").
Part A (example snapshot, file://): default view, squares and labels, delta chip, section order, row cap, T1 offer, Done + Undo,
Snooze menu (keyboard), Log touch clears a cold row, j/k + d/s/t keys, reduced motion, print palette, accessibility tree,
contrast, zoom reflow, no CSP violations, fonts from the same origin.
Part B (encrypted Data folder shared by "mac" and "workpc", test stand-in for the folder handle as in T21): stars / Done /
Snooze persist and sync, folder holds nothing readable, snooze comes back after its time (?now=).
Part C (http + service worker): fonts are cached and load offline."""
import pathlib, shutil, tempfile, json, os, re, sys, threading, functools, http.server
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
def lum(rgb):
    def ch(c): c /= 255; return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb; return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
def hexrgb(h): h = h.lstrip("#"); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
def rgb(s): return tuple(int(x) for x in re.findall(r"\d+", s)[:3])
def contrast(a, b): la, lb = sorted([lum(a), lum(b)], reverse=True); return (la + 0.05) / (lb + 0.05)
Q = "?now=2026-10-19T08:00:00-05:00&machine=test"
errors, csp = [], []
with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------------- Part A ----------------
    ctx = b.new_context(viewport={"width": 1440, "height": 900}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e))); pg.on("console", lambda m: csp.append(m.text) if "Content Security Policy" in m.text else None)
    pg.goto((SRC / "index.html").as_uri() + Q); pg.wait_for_selector("#view-focus .sq")
    check(pg.evaluate("DASH.app.state.view") == "focus" and pg.is_visible("#view-focus") and not pg.is_visible("#view-dashboard") and pg.get_attribute(".tab[data-view=focus]", "aria-selected") == "true", "Focus is the default view (Q9), other views are tabs")
    check(pg.inner_text(".tab[data-view=dashboard]") == "Totals", "the old Dashboard tab is now Totals")
    sq = pg.evaluate("[...document.querySelectorAll('.sq')].map(e => { const r = e.getBoundingClientRect(), l = e.parentElement.querySelector('.sqlab').getBoundingClientRect(); return [e.dataset.sq, Math.round(r.width), Math.round(r.height), l.bottom <= r.top + 0.5, getComputedStyle(e.parentElement.querySelector('.sqlab')).fontSize]; })")
    check([x[0] for x in sq] == ["dueToday", "overdue", "waiting", "cold"] and all(x[1] == 102 and x[2] == 102 and x[3] for x in sq), f"four equal 102×102 squares, labels above, Due Today first ({sq})")
    check(all(x[4] == "10px" for x in sq), "square labels are 10px (Q7)")
    dl = pg.evaluate("(() => { const s = document.querySelector('.sq.t-today').getBoundingClientRect(), d = document.querySelector('.sq.t-today .delta').getBoundingClientRect(); return [d.left >= s.left, d.right <= s.right, d.top >= s.top, d.bottom <= s.bottom, document.querySelector('.sq.t-today .delta').textContent]; })()")
    check(all(dl[:4]) and dl[4] == "▲+1", f"delta chip sits inside the Due Today square ({dl[4]})")
    check(pg.inner_text(".sq.t-today b") == "3" and pg.inner_text(".sq.t-over b") == "2" and pg.inner_text(".sq.t-wait b") == "2", "square counts: 3 due today, 2 overdue, 2 waiting past due")
    order = pg.evaluate("[...document.querySelectorAll('#view-focus section.blk')].map(s => s.id)")
    check(order == ["fs-dueToday", "fs-overdue", "fs-owed", "fs-waiting", "fs-cold", "fs-travel"], f"section order ({order})")
    check(pg.get_attribute("[data-later]", "aria-expanded") == "false" and not pg.query_selector("#later-list"), "Later this week is collapsed by default")
    # T1 offer (first run): a dialog the owner confirms; nothing starred before
    check(pg.is_visible(".t1offer[role=dialog]") and pg.inner_text(".sq.t-cold b") == "0", "first run: offer to star T1 accounts (nothing starred until confirmed)")
    pg.uncheck("[data-t1='Account D']"); pg.click("#t1o-yes"); pg.wait_for_timeout(100)
    st = pg.evaluate("Object.keys(DASH.app.state.flags).filter(k => DASH.app.state.flags[k].on).sort()")
    check("star:Account D" not in st and "star:Account F" in st and "setting:t1offer" in st and not pg.query_selector(".t1offer"), "offer: ticked T1 accounts starred, unticked left out, offer not shown again")
    check(pg.inner_text(".sq.t-cold b") == "1" and "41d since last" in pg.inner_text("#fs-cold"), "Going cold · key: starred account with no touch in 41 days")
    rows = pg.evaluate("document.querySelectorAll('#view-focus section.blk .frow').length")
    check(rows <= 12 and pg.query_selector("[data-fmore=owed]") is not None, f"row cap: {rows} rows ≤ 12, '+n more' on capped sections")
    pg.click("[data-fmore=owed]"); n_owed = pg.evaluate("document.querySelectorAll('#fs-owed .frow').length")
    check(n_owed == pg.evaluate("+document.querySelector('#fs-owed .badge').textContent"), "+n more expands the section in place"); pg.click("[data-fless=owed]")
    check("⚠ no date" in pg.inner_text("#fs-cold") and "no touch set" in pg.inner_text("#fs-cold"), "no-date flag on the cold row (word + icon)")
    wk = pg.evaluate("getComputedStyle(document.querySelector('#fs-owed .st.c-week')).color")
    check(wk == "rgb(228, 233, 229)" and "◆" not in pg.inner_text("#fs-owed .st.c-week") and pg.query_selector("#fs-owed .st.c-week use[href='#i-week']") is not None, "This week = ivory with the ◆ (diamond) icon (Q1)")
    check(pg.query_selector("#fs-waiting .st use[href='#i-wait']") is not None and pg.evaluate("document.querySelector('#fs-waiting .st').textContent.trim()") == "Waiting", "Waiting status: SVG hourglass + word")
    # Done + Undo
    pg.click("#fs-dueToday [data-fdone='EX-2']"); pg.wait_for_timeout(50)
    check(not pg.query_selector("#fs-dueToday [data-row='EX-2']") and pg.inner_text(".sq.t-today b") == "2" and "1 done here, not yet in To Do" in pg.inner_text(".donehere") and pg.inner_text(".sq.t-today .delta") == "▲+1",
          "Done hides the row, square counts what's left, delta unchanged (snapshot only), 'done here' count in the header")
    check(pg.is_visible("#undo-btn") and pg.get_attribute("#undo", "aria-live") == "polite", "Undo message (aria-live polite)")
    pg.click("#undo-btn"); check(pg.query_selector("#fs-dueToday [data-row='EX-2']") is not None and not pg.query_selector(".donehere"), "Undo restores the row")
    # Snooze menu (menu-button pattern)
    pg.focus("#fs-overdue [data-fsnooze='EX-1']"); pg.keyboard.press("Enter"); pg.wait_for_selector("#snz[role=menu]")
    check(pg.evaluate("document.activeElement.dataset.snz") == "later" and pg.get_attribute("#fs-overdue [data-fsnooze='EX-1']", "aria-expanded") == "true", "Snooze opens a menu, focus on Later today")
    labels = pg.evaluate("[...document.querySelectorAll('#snz [role=menuitem]')].map(b => b.textContent)")
    check(labels == ["Later today (+3 h)", "Tomorrow 8:00", "Next Monday 8:00", "Pick date…"], f"snooze options (Q11): {labels}")
    pg.keyboard.press("ArrowDown"); check(pg.evaluate("document.activeElement.dataset.snz") == "tomorrow", "arrow keys move in the menu")
    pg.keyboard.press("Escape"); check(not pg.query_selector("#snz") and pg.evaluate("document.activeElement.dataset.fsnooze") == "EX-1", "Esc closes the menu and returns focus")
    pg.click("#fs-overdue [data-fsnooze='EX-1']"); pg.click("#snz [data-snz='later']")
    fl = pg.evaluate("DASH.app.state.flags['snooze:EX-1']")
    check(not pg.query_selector("#fs-overdue [data-row='EX-1']") and pg.inner_text(".sq.t-over b") == "1" and fl["until"] == "2026-10-19T16:00:00.000Z" and fl["due"] == "2026-10-16", "Snooze (Later today) hides the row until 11:00 CT; the due date is kept")
    pg.click("[data-later]"); check("snoozed to" in pg.inner_text("#later-list") and "send revised scope sheet" in pg.inner_text("#later-list"), "snoozed row listed in Later this week"); pg.click("[data-later]")
    # Log touch on the cold row creates a time entry with the account and clears it
    pg.click("#fs-cold [data-ftouch]"); pg.wait_for_selector("#pop")
    check(pg.input_value("#pop-acc") == "Account F" and pg.input_value("#pop-kind") == "Phone" and pg.input_value("#pop-min") == "15", "Log touch opens + Log call pre-filled (account, Phone, 15 min)")
    pg.click("#pop-ok"); pg.wait_for_timeout(50)
    check(pg.evaluate("DASH.app.state.entries.some(e => e.account === 'Account F' && e.date === '2026-10-19' && e.source === 'interaction')") and pg.inner_text(".sq.t-cold b") == "0", "Log touch creates the time entry and clears the cold row")
    # keyboard-only: j/k/d/s/t
    pg.focus(".sq.t-today"); pg.keyboard.press("Enter"); check(pg.evaluate("document.activeElement.id") == "fh-dueToday", "Enter on a square jumps to (and focuses) its section")
    pg.keyboard.press("j"); first = pg.evaluate("document.activeElement.dataset.row"); pg.keyboard.press("j"); second = pg.evaluate("document.activeElement.dataset.row"); pg.keyboard.press("k")
    check(first == "EX-2" and second == "EX-21" and pg.evaluate("document.activeElement.dataset.row") == "EX-2", f"j/k move between rows ({first}, {second})")
    pg.keyboard.press("j"); pg.keyboard.press("d"); check(pg.evaluate("DASH.app.state.flags['done:EX-21'] && DASH.app.state.flags['done:EX-21'].on") and pg.evaluate("!!document.activeElement.closest('.frow')"), "d = Done on the focused row; focus stays on a row")
    pg.click("#undo-btn"); pg.focus("#fs-dueToday [data-row='EX-2']"); pg.keyboard.press("s"); check(pg.query_selector("#snz") is not None, "s opens Snooze"); pg.keyboard.press("Escape")
    pg.focus("#fs-dueToday [data-row='EX-2']"); pg.keyboard.press("t"); check(pg.query_selector("#pop") is not None and pg.input_value("#pop-acc") == "Account B", "t opens Log touch")
    pg.keyboard.type("j"); check(pg.query_selector("#pop") is not None, "shortcuts are off while typing / in a dialog"); pg.keyboard.press("Escape")
    # Tab order: squares → meetings → sections
    pg.evaluate("document.querySelector('.tab[data-view=focus]').focus()"); seq = []
    for _ in range(14):
        pg.keyboard.press("Tab"); seq.append(pg.evaluate("(a => a.dataset.sq ? 'sq' : a.dataset.prep ? 'meet' : a.closest('section.blk') ? 'sec' : a.closest('.fhead') ? 'head' : 'other')(document.activeElement)"))
    f = [x for x in seq if x in ("sq", "meet", "sec")]; check(f[:4] == ["sq"] * 4 and "meet" in f and f.index("sec") > max(i for i, x in enumerate(f) if x == "meet"), f"Tab order squares → meetings → sections ({f[:9]})")
    # accessibility tree (Playwright aria snapshot)
    snap = pg.locator("#view-focus").aria_snapshot()
    check('heading "Daily Focus" [level=1]' in snap and all(f'heading "{h}' in snap for h in ["Due Today", "Overdue", "Owed to outside", "Waiting · past check-back", "Going cold · key", "Travel ≤ 7 days"]), "aria: h1 + one h2 per section")
    check('button "Overdue, 1 item. Go to section"' in snap and re.search(r'button "Due Today, 3 items\. 1 more due today', snap) and 'button "Done: send riser layout markup"' in snap and "listitem" in snap, "aria: squares and row buttons have task names; rows are list items")
    # contrast (WCAG 2.2 AA, 4.5:1 text) on the Hardline pairs actually rendered
    P = {"bg": "#0A0D0C", "panel": "#121715", "ink": "#E4E9E5", "muted": "#8A968F", "gold": "#C8A25A", "green": "#36E07F", "red": "#E5484D", "amber": "#F5A623", "blue": "#4EA8FF"}
    pairs = [("ink", "bg"), ("ink", "panel"), ("muted", "panel"), ("muted", "bg"), ("gold", "panel"), ("gold", "bg"), ("green", "panel"), ("red", "panel"), ("amber", "panel"), ("blue", "panel"),
             ("bg", "green"), ("bg", "red"), ("bg", "amber"), ("bg", "blue"), ("green", "bg")]
    low = [(a, b2, round(contrast(hexrgb(P[a]), hexrgb(P[b2])), 2)) for a, b2 in pairs if contrast(hexrgb(P[a]), hexrgb(P[b2])) < 4.5]
    check(not low, f"contrast ≥ 4.5:1 for all {len(pairs)} text/background pairs (lowest {min(round(contrast(hexrgb(P[a]), hexrgb(P[b2])), 2) for a, b2 in pairs)}:1) {low}")
    real = pg.evaluate("(() => { const e = document.querySelector('#fs-owed .per'); return [getComputedStyle(e).color, getComputedStyle(e.closest('.blk')).backgroundColor]; })()")
    check(contrast(rgb(real[0]), rgb(real[1])) >= 4.5, f"rendered muted text on panel {contrast(rgb(real[0]), rgb(real[1])):.2f}:1")
    fr = pg.evaluate("(() => { const b = document.querySelector('#fs-overdue [data-fdone]'); b.focus(); const s = getComputedStyle(b); return [s.outlineStyle, s.outlineWidth, s.outlineColor]; })()")
    check(fr[0] != "none" and fr[1] == "2px" and fr[2] == "rgb(200, 162, 90)", f"gold 2px focus ring ({fr})")
    # fonts: self-hosted, same origin
    pg.evaluate("document.fonts.ready.then(() => true)")
    fonts = pg.evaluate("[...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/\"/g, ''))")
    check("Space Grotesk" in fonts and "IBM Plex Mono" in fonts, f"Space Grotesk and IBM Plex Mono load from assets/fonts ({sorted(set(fonts))})")
    check(pg.evaluate("performance.getEntriesByType('resource').filter(r => /woff2/.test(r.name)).every(r => r.name.startsWith(location.href.split('/index.html')[0]))"), "font files come from the app's own folder")
    # print emulation: print palette, no shadows / animation
    pg.click(".mtop >> text=File"); check(pg.is_visible("[data-act=printFocus]"), "File → Print Daily Focus… (Q8)"); pg.keyboard.press("Escape")
    if pg.get_attribute('[data-nodate]', 'aria-expanded') != 'true': pg.click('[data-nodate]')   # U2: rows with the 'no date' pill
    pg.evaluate("document.getElementById('view-focus').classList.add('printing')"); pg.emulate_media(media="print")
    pr = pg.evaluate("(() => { const v = document.getElementById('view-focus'), q = document.querySelector('.sq.t-today'), r = document.querySelector('.frow'); return [getComputedStyle(v).backgroundColor, getComputedStyle(q).backgroundColor, getComputedStyle(q).boxShadow, getComputedStyle(r).animationName, getComputedStyle(document.querySelector('#fs-dueToday h2')).color, getComputedStyle(document.querySelector('.btns')).display]; })()")
    check(pr[0] == "rgb(255, 255, 255)" and pr[1] == "rgb(255, 255, 255)" and pr[2] == "none" and pr[3] == "none" and pr[4] == "rgb(16, 38, 69)" and pr[5] == "none", f"print: white page, outlined squares, no shadow/animation, navy headings, no buttons ({pr})")
    # the longest form (cold key row): "no touch set ⚠ no date"; put it into one printed row's due cell
    pg.evaluate("""() => { const c = document.querySelector('#fs-overdue .frow .nx'); c.innerHTML = '<span class="muted">no touch set</span> <span class="nodate">⚠ no date</span>'; }""")
    ov = pg.evaluate("""() => { const p = [...document.querySelectorAll('#view-focus .nodate')].filter(e => e.offsetParent);
      return p.map(e => { const r = e.getBoundingClientRect(), row = e.closest('.frow, .blk').getBoundingClientRect(), c = e.closest('.nx') ? e.closest('.nx').getBoundingClientRect() : row;
        return [Math.round(r.right - row.right), Math.round(r.right - c.right)]; }); }""")
    check(len(ov) > 0 and all(a <= 0 and b <= 1 for a, b in ov), f"U2 print: every 'no date' pill stays inside its row and cell ({ov})")
    tmpd = pathlib.Path(os.environ.get("T24_PDF_DIR") or tempfile.mkdtemp()); pg.pdf(path=str(tmpd / "f.pdf"), width="11in", height="8.5in", print_background=True, margin={"top": "0", "bottom": "0", "left": "0", "right": "0"})
    import subprocess; info = subprocess.run(["pdfinfo", str(tmpd / "f.pdf")], capture_output=True, text=True).stdout
    check(re.search(r"Pages:\s+1\n", info) is not None and "792 x 612" in info, "Print Daily Focus = one landscape letter page")
    pg.emulate_media(media="screen"); pg.evaluate("document.getElementById('view-focus').classList.remove('printing')")
    # reduced motion: rows fade in on load only, and not at all with reduced motion
    check(pg.evaluate("getComputedStyle(document.querySelector('.frow')).animationName") == "none" or not pg.query_selector(".frow.anim"), "no row animation on re-renders (only the first render)")
    c2 = b.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce"); p2 = c2.new_page(); p2.goto((SRC / "index.html").as_uri() + Q); p2.wait_for_selector(".frow")
    check(p2.evaluate("[...document.querySelectorAll('.frow')].every(r => getComputedStyle(r).animationName === 'none' && !r.style.animationDelay)"), "prefers-reduced-motion: no animations")
    a1 = c2.new_page(); c2.close()
    c3 = b.new_context(viewport={"width": 1440, "height": 900}); p3 = c3.new_page(); p3.goto((SRC / "index.html").as_uri() + Q); p3.wait_for_selector(".frow")
    check(p3.evaluate("getComputedStyle(document.querySelector('.frow')).animationName") == "fu", "normal motion: rows fade in once on load"); c3.close()
    # zoom 200% (~640 css px): squares 2×2, rows on two lines
    c4 = b.new_context(viewport={"width": 640, "height": 800}); p4 = c4.new_page(); p4.goto((SRC / "index.html").as_uri() + Q); p4.wait_for_selector(".sq")
    pos = p4.evaluate("[...document.querySelectorAll('.sq')].map(e => [Math.round(e.getBoundingClientRect().left), Math.round(e.getBoundingClientRect().top)])")
    check(pos[0][1] == pos[1][1] and pos[2][1] > pos[0][1] and pos[0][0] == pos[2][0] and p4.evaluate("document.getElementById('view-focus').scrollWidth <= innerWidth + 1"), f"200% zoom: squares wrap 2×2, Daily Focus needs no sideways scroll ({pos})"); c4.close()
    check(not [c for c in csp if "refused" in c.lower() or "violat" in c.lower()], f"no CSP violations ({csp[:2]})")
    ctx.close()
    # ---------------- Part B: encrypted folder, two machines ----------------
    FS_JS = (SRC / "tests/t21_vault.py").read_text().split('FS_JS = """', 1)[1].split('"""', 1)[0]
    tmp = pathlib.Path(tempfile.mkdtemp()); app = tmp / "Dashboard"; shutil.copytree(SRC, app, ignore=shutil.ignore_patterns("tests", ".git"))
    snap = json.loads((app / "examples/example-snapshot.json").read_text()); snap.pop("example")
    data = tmp / "Data"; data.mkdir(); (data / "inbox-snapshot.json").write_text(json.dumps(snap))
    def fs(op, name, text):
        if op == "list": return sorted(x for x in os.listdir(data) if not x.endswith(".crswap"))
        pth = data / name
        if op == "read":
            if not pth.exists(): return None
            st = pth.stat(); return {"m": int(st.st_mtime_ns // 1_000_000), "size": st.st_size, "text": pth.read_text()}
        if op == "write": t = data / (name + ".crswap"); t.write_text(text); os.replace(t, pth); return True
        if op == "remove": pth.unlink(); return True
    PASS1 = "synthetic focus test passphrase"
    def page(m, now="2026-10-19T08:00:00-05:00"):
        c = b.new_context(viewport={"width": 1440, "height": 900}); c.expose_function("__fs", fs); c.add_init_script(FS_JS)
        pp = c.new_page(); pp.on("pageerror", lambda e: errors.append(f"{m}: {e}")); pp.on("dialog", lambda d: d.accept())
        pp.goto((app / "index.html").as_uri() + f"?now={now}&machine={m}"); return c, pp
    cm, mac = page("mac"); mac.wait_for_selector(".sq"); mac.evaluate("DASH.app.syncNow()"); mac.evaluate("DASH.app.flush()")
    mac.click('.mtop:has-text("File")'); mac.click('[data-act="encryption"]'); mac.wait_for_selector("#vaultsetup"); mac.fill("#vp1", PASS1); mac.fill("#vp2", PASS1); mac.click("#vs-ok")
    mac.wait_for_selector("#rk-value", timeout=20000); mac.check("#rk-done"); mac.click("#rk-ok"); mac.wait_for_function("() => document.querySelector('#toast').textContent.startsWith('Data folder encrypted')", timeout=20000)
    mac.wait_for_selector("#t1o-yes"); mac.click("#t1o-yes"); mac.click("#fs-dueToday [data-fdone='EX-7']"); mac.click("#fs-overdue [data-fsnooze='EX-1']"); mac.click("#snz [data-snz='later']")
    mac.evaluate("DASH.app.flush()"); mac.evaluate("DASH.app.writeOwn()")
    names = sorted(os.listdir(data)); blob = "".join((data / n).read_text() for n in names if not n.endswith(".crswap"))
    secrets = sorted({a["name"] for a in snap["accounts"]} | {"star:", "done:", "snooze:", "EX-7", "Owner/operator"})
    check(all(n == "keyring.json" or n.endswith(".enc") for n in names) and not any(s in blob for s in secrets), f"folder: stars, Done and Snooze stored only encrypted (raw scan of {len(names)} files finds no account names or flag ids)")
    cp, pc = page("workpc"); pc.wait_for_selector("#vaultunlock", timeout=20000); pc.fill("#vault-pass", PASS1); pc.click("#vault-ok"); pc.wait_for_selector(".sq", timeout=30000)
    pc.evaluate("DASH.app.syncNow()"); pc.evaluate("DASH.app.flush()"); pc.wait_for_timeout(200)
    check(pc.evaluate("DASH.app.state.flags['star:Account F'] && DASH.app.state.flags['star:Account F'].on") and not pc.query_selector(".t1offer") and pc.inner_text(".sq.t-cold b") == "1", "workpc: stars made on the mac arrive through the folder (no second T1 offer)")
    check(not pc.query_selector("[data-row='EX-7']") and "1 done here" in pc.inner_text(".donehere") and not pc.query_selector("#fs-overdue [data-row='EX-1']"), "workpc: Done and Snooze from the mac apply here too")
    pc.click("#fs-dueToday [data-row='EX-2'] .key"); pc.evaluate("DASH.app.flush()"); pc.evaluate("DASH.app.writeOwn()")
    mac.evaluate("DASH.app.syncNow()"); mac.wait_for_timeout(200)
    check(mac.evaluate("DASH.app.state.flags['star:Account B'].on === false") and mac.query_selector("#fs-dueToday [data-row='EX-2'] .key") is None, "unstar on workpc wins on the mac (later stamp)")
    mac.goto((app / "index.html").as_uri() + "?now=2026-10-19T11:30:00-05:00&machine=mac"); mac.wait_for_selector(".sq", timeout=30000); mac.evaluate("DASH.app.syncNow()")
    check(mac.query_selector("#fs-overdue [data-row='EX-1']") is not None and mac.query_selector("[data-row='EX-7']") is None, "after reload at 11:30 CT the snoozed row is back; the Done row stays hidden until To Do catches up")
    snap2 = dict(snap, generated_at="2026-10-20T07:30:00-05:00", tasks=[dict(t, status="done") if t["id"] == "EX-7" else t for t in snap["tasks"]])
    mac.evaluate("""(async t => { const S = DASH.app.state; await S.dir.getFileHandle('inbox-snapshot.json', { create: true }).then(h => h.createWritable()).then(async w => { await w.write(t); await w.close(); }); })""", json.dumps(snap2))
    mac.evaluate("DASH.app.syncNow()"); mac.evaluate("DASH.app.syncNow()"); mac.wait_for_timeout(200)
    check(mac.evaluate("DASH.app.state.snap.generatedAt").startswith("2026-10-20") and not mac.query_selector(".donehere"), "To Do caught up (task done in the next snapshot): the 'done here' count clears itself")
    cm.close(); cp.close()
    # ---------------- Part C: fonts cached by the service worker, offline ----------------
    site = tmp / "site"; shutil.copytree(SRC, site, ignore=shutil.ignore_patterns("tests", ".git"))
    class H(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(H, directory=str(site))); threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_address[1]}/index.html" + Q
    c5 = b.new_context(viewport={"width": 1280, "height": 860}); p5 = c5.new_page(); p5.on("console", lambda m: csp.append("http: " + m.text) if "Content Security Policy" in m.text else None)
    p5.goto(url); p5.wait_for_selector(".sq"); p5.evaluate("navigator.serviceWorker.ready.then(() => true)"); p5.reload(); p5.wait_for_selector(".sq")
    c5.set_offline(True); p5.reload(); p5.wait_for_selector(".sq", timeout=10000); p5.evaluate("document.fonts.ready.then(() => true)")
    check(p5.evaluate("[...document.fonts].some(f => f.family.includes('Space Grotesk') && f.status === 'loaded')"), "offline (service worker): Daily Focus and its fonts load from the cache")
    check(not [c for c in csp if "refused" in c.lower() or "violat" in c.lower()], "http: no CSP violations (fonts are same-origin, CSP unchanged)")
    c5.close(); srv.shutdown(); b.close()
check(not errors, "no page errors" + (f": {errors[:3]}" if errors else ""))
print("T24", "PASS" if ok else "FAIL"); sys.exit(0 if ok else 1)
