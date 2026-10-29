"""T30 (00.09.000): Accounts tab. Fictional example data only; real account plans never enter the repo.
Part A (EXAMPLE DATA, file://): example accounts show read-only in six sections with tier chips and a tier filter; (unverified)
items are flagged; the example loops are not synced into the example Projects; 🤝 Account touches shows on Daily Focus; the import is
refused on EXAMPLE DATA; print gives one account per page in the print palette with a Confidential footer and holds no email or phone.
Part B (Data folder stand-in as in T28/T29): unencrypted folder refuses both imports; after encryption the account plan (text fields
seeded with long unique sentinels) and a contacts CSV are saved as accounts-store.json.enc and contacts.json.enc only; no sentinel
(raw or decoded) is in any Data file, the IndexedDB cache or localStorage; loops land in Projects once (a re-import adds none); a file
with a dollar figure, email or phone is refused whole; reworded loops ask (Possible rename); a repeated loop with a later date than its
completed task asks (Repeated loop); Daily Focus counts the waiting prompts; a locked folder refuses the import. argv[1]: shots dir."""
import pathlib, shutil, tempfile, json, os, re, sys, hashlib, subprocess
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent)); import sentinels as SN
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True; errors = []
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(tempfile.mkdtemp(prefix="dash-t30-")); SHOTS.mkdir(parents=True, exist_ok=True)
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
Q = lambda view="accounts", m="test": f"?now=2026-10-19T09:20:00-05:00&machine={m}&view={view}"
FX = (SRC / "tests/fixtures/example-account.md").read_text()
TMP = pathlib.Path(tempfile.mkdtemp())
S = lambda p: "ACCT_SENTINEL_" + hashlib.sha256(("t30:" + p).encode()).hexdigest()[:24]   # long, unique; never a short marker
GF = json.loads((SRC / "tests/fixtures/example-guard-fixtures.json").read_text()); PHONE = GF["phone"][2]   # literal fixtures (555-01xx)
def pick(pg, act, paths):
    with pg.expect_file_chooser() as fc: pg.evaluate(f"document.querySelector('[data-act={act}]').click()")
    fc.value.set_files([str(x) for x in paths]); pg.wait_for_timeout(250)
with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------------- Part A: EXAMPLE DATA ----------------
    ctx = b.new_context(viewport={"width": 1440, "height": 900}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e))); pg.on("dialog", lambda d: d.accept())
    pg.goto((SRC / "index.html").as_uri() + Q()); pg.wait_for_selector(".accpage")
    check(pg.query_selector(".tab[data-view=accounts]") is not None and pg.query_selector("[data-act=importAccounts][role=menuitem]") is not None and pg.query_selector("[data-act=importContacts][role=menuitem]") is not None, "Accounts tab and File → Import account plans / Import contacts are present")
    heads = pg.eval_on_selector_all(".accmain .accsec h3", "e => e.map(x => x.firstChild.textContent.trim())")
    check(heads[:6] == ["1. What is happening", "2. Who influences the business", "3. What they are trying to accomplish", "4. Opportunities", "5. Relationship building", "6. Next strategic move"], f"six sections in plan order ({heads[:6]})")
    check(pg.eval_on_selector_all(".acclist .accli", "e => e.length") == 2 and pg.query_selector(".acclist .tierchip.t-key") and pg.query_selector(".acclist .tierchip.t-prospect"), "two example accounts, each with a tier chip")
    check(pg.query_selector("#view-accounts input:not(#acc-q), #view-accounts textarea, #view-accounts [contenteditable]") is None, "read-only: no edit fields on the Accounts tab")
    check(pg.eval_on_selector_all(".accmain .unv", "e => e.length") >= 4 and pg.query_selector(".accmain tr.unvrow") is not None, "(unverified) items carry a visible flag")
    pg.screenshot(path=str(SHOTS / "30a-accounts-key-1440.png"), full_page=True)
    pg.select_option("#acc-tier", "prospect"); pg.wait_for_timeout(100)
    check(pg.eval_on_selector_all(".acclist .accli", "e => e.length") == 1 and "Northwind" in pg.inner_text(".acclist"), "tier filter: Prospect shows one account")
    pg.screenshot(path=str(SHOTS / "30b-accounts-tier-filter.png")); pg.select_option("#acc-tier", ""); pg.wait_for_timeout(100)
    pg.fill("#acc-q", "north"); pg.wait_for_timeout(100); check(pg.eval_on_selector_all(".acclist .accli", "e => e.length") == 1, "search narrows the list"); pg.fill("#acc-q", ""); pg.wait_for_timeout(100)
    check(pg.evaluate("DASH.app.state.projStore.plans.some(p => p.name.startsWith('Accounts – '))") is False and pg.inner_text(".accmain").count("not in Projects") == 4, "EXAMPLE DATA: the example Projects store is left as it is; the example loops show 'not in Projects'")
    pg.click(".accmain [data-accmove]"); pg.wait_for_timeout(100)
    n1 = pg.evaluate("DASH.app.state.projStore.plans.find(p => p.name === 'Accounts – Acme Fab').tasks.length")
    check(n1 == 1 and pg.query_selector(".accmain [data-accmove]") is None and "linked to task" in pg.inner_text(".accmain"), "Create Projects task makes the next move once, then shows it linked")
    lb = pg.evaluate("(() => { const s = getComputedStyle(document.querySelector('.accmain .linkbtn')); return [s.backgroundColor, s.color]; })()")
    check(lb[0] in ("rgba(0, 0, 0, 0)", "transparent") and lb[1] != "rgb(0, 0, 0)", f"U1: 'open in Projects' is a dark-theme link, not a white box ({lb})")
    ct = pg.query_selector(".accmain details.ctd"); check(ct is not None, "stakeholders matched to contacts show a 'contact' toggle on screen")
    pg.click(".accmain details.ctd summary"); pg.screenshot(path=str(SHOTS / "30c-accounts-contact-open.png"))
    ph = pg.inner_html(".accprint")
    check(pg.eval_on_selector_all(".accprint .accpage", "e => e.length") == 2 and "@" not in ph and ".example" not in ph and "ctd" not in ph and "data-accmove" not in ph, "print copy: one page per account, no email address, no contact toggle, no buttons")
    pick(pg, "importAccounts", [SRC / "tests/fixtures/example-account.md"]); t = pg.inner_text("#toast")
    check("Load your real data first" in t and "Nothing was imported" in t and pg.evaluate("DASH.app.state.accStore.accounts.length") == 2, f"EXAMPLE DATA refuses Import account plans ({t[:60]})")
    check(pg.evaluate("DASH.db.getRaw('accountsStore')") is None and pg.evaluate("DASH.db.getRaw('contacts')") is None, "example accounts and contacts are never cached")
    pg.goto((SRC / "index.html").as_uri() + Q("focus")); pg.wait_for_selector(".sq"); pg.wait_for_timeout(200)
    af = pg.query_selector(".accfocus")
    check(af is not None and "Acme Fab" in af.inner_text() and "overdue" in af.inner_text() and pg.query_selector(".accfocus .accpend") is None, "Daily Focus: 🤝 Account touches lists the overdue touch and next move (no prompt count in example data)")
    fl = pg.evaluate("(() => { const s = getComputedStyle(document.querySelector('.accfocus .linkbtn')); return [s.backgroundColor, s.color, document.querySelector('.accfocus .linkbtn').textContent]; })()")
    check(fl[0] in ("rgba(0, 0, 0, 0)", "transparent") and fl[1] != "rgb(0, 0, 0)" and fl[2] == "Acme Fab", f"U1: account-name buttons on Daily Focus are readable dark-theme links ({fl})")
    pg.screenshot(path=str(SHOTS / "30d-focus-account-touches.png"))
    pg.click(".accfocus [data-accgo]"); pg.wait_for_timeout(100); check(pg.evaluate("DASH.app.state.view") == "accounts", "a touch row opens the account")
    pg.evaluate("document.getElementById('view-accounts').classList.add('printing')"); pg.emulate_media(media="print")
    bg = pg.evaluate("getComputedStyle(document.getElementById('view-accounts')).backgroundColor"); h2 = pg.evaluate("getComputedStyle(document.querySelector('.accprint .acchead h2')).color")
    vis = pg.evaluate("[getComputedStyle(document.querySelector('.accwrap')).display, getComputedStyle(document.querySelector('.accprint')).display, getComputedStyle(document.querySelector('.accprint .accpage')).breakAfter]")
    check(bg == "rgb(255, 255, 255)" and h2 == "rgb(16, 38, 69)" and vis == ["none", "block", "page"], f"print: white paper, navy headings, screen copy hidden, page break after each account ({bg} {h2} {vis})")
    ft = pg.evaluate("[...document.querySelectorAll('.accprint .accfoot')].map(f => [getComputedStyle(f).display, f.textContent])")
    check(len(ft) == 2 and all(d == "block" and "Confidential: internal" in x for d, x in ft), f"P2: Confidential footer (from the file's confidential field) on each printed account ({ft[:1]})")
    pg.pdf(path=str(SHOTS / "30e-accounts-print.pdf"), width="8.5in", height="11in", print_background=True)
    pages = int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", str(SHOTS / "30e-accounts-print.pdf")], capture_output=True, text=True).stdout).group(1))
    txt = subprocess.run(["pdftotext", str(SHOTS / "30e-accounts-print.pdf"), "-"], capture_output=True, text=True).stdout
    check(pages >= 2 and "@" not in txt and ".example" not in txt and txt.upper().count("1. WHAT IS HAPPENING") == 2, f"printed PDF: {pages} pages, each account starts its own page, no email in the printed text")
    subprocess.run(["pdftoppm", "-png", "-r", "70", "-f", "1", "-l", "1", "-singlefile", str(SHOTS / "30e-accounts-print.pdf"), str(SHOTS / "30e-accounts-print-p1")], check=True)
    pg.emulate_media(media="screen"); ctx.close()
    # ---------------- Part B: encryption through the Data folder ----------------
    FS_JS = (SRC / "tests/t21_vault.py").read_text().split('FS_JS = """', 1)[1].split('"""', 1)[0]
    tmp = pathlib.Path(tempfile.mkdtemp()); app = tmp / "Dashboard"; shutil.copytree(SRC, app, ignore=shutil.ignore_patterns("tests", ".git"))
    snap = json.loads((app / "examples/example-snapshot.json").read_text()); snap.pop("example")
    SENTS = [S(k) for k in ("happening", "goal", "stake", "notes", "opp", "loop1", "loop3", "src", "action")]
    md = FX.replace("Acme Fab is expanding", SENTS[0] + " is expanding").replace("Standardize detection", SENTS[1] + " standardize").replace("| Sam K. |", "| " + SENTS[2] + " |") \
           .replace("Prefers the old design", SENTS[3]).replace("| Hall 2 detection standard |", "| " + SENTS[4] + " |").replace("Send riser layout markup", SENTS[5]) \
           .replace("Quarterly check-in with the operations lead", SENTS[6]).replace("seen once", SENTS[7]).replace("Send the riser layout review to the site team", SENTS[8])
    md = md.replace("| Shared inbox |", "| <img src=x onerror=window.__xss=1> |")   # C1: file text is rendered as text
    src = TMP / "example-account.md"; src.write_text(md)
    CS = [S("c.first"), S("c.last"), S("c.company"), S("c.title")]; CMAIL = S("c.mail").lower() + "@contacts.example"
    csv = "first_name,last_name,email,company,title,phone,source,last_seen,last_touch\n" + f"Jordan,P.,{CMAIL},Acme Fab,{CS[3]},{PHONE},example,2026-10-01,2026-10-01\n{CS[0]},{CS[1]},x@y.example,{CS[2]},Lead,,example,,\n"
    csvf = TMP / "contacts-merged.csv"; csvf.write_text(csv); ALL = SENTS + CS + [CMAIL]
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
    mac.goto((app / "index.html").as_uri() + Q("accounts", "mac")); mac.wait_for_selector("#view-accounts"); mac.evaluate("DASH.app.syncNow()"); mac.evaluate("DASH.app.flush()")
    check(mac.query_selector(".accpage") is None and mac.evaluate("DASH.app.state.accStore") is None, "real data: no example accounts carried over (empty state)")
    pick(mac, "importAccounts", [src]); mac.evaluate("DASH.app.flush()")
    check("needs an encrypted" in mac.inner_text("#toast") and mac.evaluate("DASH.app.state.accStore") is None and mac.evaluate("DASH.db.getRaw('accountsStore')") is None and not any(x.startswith("accounts") for x in os.listdir(data)), "unencrypted folder: account import refused; nothing in memory, the cache or the Data folder")
    pick(mac, "importContacts", [csvf]); check("needs an encrypted" in mac.inner_text("#toast") and not any(x.startswith("contacts") for x in os.listdir(data)), "unencrypted folder: contacts import refused")
    mac.click('.mtop:has-text("File")'); mac.click('[data-act="encryption"]'); mac.wait_for_selector("#vaultsetup"); mac.fill("#vp1", "correct horse battery 09000"); mac.fill("#vp2", "correct horse battery 09000"); mac.click("#vs-ok")
    mac.wait_for_selector("#rk-value", timeout=20000); mac.check("#rk-done"); mac.click("#rk-ok"); mac.wait_for_function("() => document.querySelector('#toast').textContent.startsWith('Data folder encrypted')", timeout=20000)
    for label, bad in (("dollar figure", FX.replace("Standardize detection", "Standardize detection, budget " + GF["accountMoney"][0])), ("email", FX.replace("Prefers the old design", "sam.k@engineers.example")), ("phone", FX.replace("Prefers the old design", "call " + PHONE))):
        bf = TMP / "bad" / "example-account.md"; bf.parent.mkdir(exist_ok=True); bf.write_text(bad); pick(mac, "importAccounts", [bf]); t = mac.inner_text("#toast")
        check("Nothing imported" in t and mac.evaluate("DASH.app.state.accStore") is None and not any(x.startswith("accounts") for x in os.listdir(data)), f"a plan with a {label} is refused whole ({t[:80]})")
    check(mac.query_selector(".projrej") is not None and re.search(r"example-account\.md:\d+ PHONE", mac.inner_text(".projrej")) is not None, "refusals are listed as file:line RULE")
    pick(mac, "importAccounts", [src]); mac.evaluate("DASH.app.flush()"); mac.wait_for_timeout(300)
    pick(mac, "importContacts", [csvf]); mac.evaluate("DASH.app.flush()"); mac.wait_for_timeout(300)
    names = sorted(os.listdir(data))
    check({"accounts-store.json.enc", "contacts.json.enc", "projects-store.json.enc"} <= set(names) and not any(n.startswith(("accounts", "contacts")) and not n.endswith(".enc") for n in names), f"saved as accounts-store.json.enc and contacts.json.enc only; loops saved to projects-store.json.enc ({names})")
    lk = SN.leaks({n: (data / n).read_text() for n in names if n.endswith(".enc") or n == "keyring.json"}, ALL)
    check(len(ALL) >= 14 and not lk, f"Data folder files hold none of the {len(ALL)} plaintext sentinels, raw or decoded ({lk[:2]})")
    envs = mac.evaluate("Promise.all(['accountsStore','contacts','projectsStore'].map(k => DASH.db.getRaw(k))).then(v => v.map(x => x && x.dashCache === 1 && typeof x.env === 'string' ? x.env : null))")
    check(all(envs) and not SN.leaks({"c" + str(i): e for i, e in enumerate(envs)}, ALL), "IndexedDB: accountsStore, contacts and projectsStore are encrypted envelopes with no sentinels")
    ls = mac.evaluate("JSON.stringify(Object.assign({}, localStorage))"); check(not SN.leaks({"ls": ls}, ALL), "localStorage holds no sentinels")
    dec = mac.evaluate("(async () => { const f = await (await window.DASH_TEST_FS.getFileHandle('accounts-store.json.enc')).getFile(); return await DASH.vault.decrypt(DASH.app.state.vault.key, DASH.app.state.vault.kr, await f.text(), 'accstore'); })()")
    check(all(s in dec for s in SENTS), "control: the decrypted accounts store holds every account sentinel")
    plan = mac.evaluate("DASH.app.state.projStore.plans.find(p => p.name === 'Accounts – Acme Fab')")
    check(plan is not None and len(plan["tasks"]) == 4 and any(SENTS[5] in t["title"] for t in plan["tasks"]), "open loops were added to Projects automatically on import")
    check(CS[3] in mac.inner_text(".accmain") and mac.query_selector(".accmain details.ctd") is not None, "stakeholder is linked to the imported contact (title shown; email/phone behind the contact toggle)")
    check(mac.evaluate("window.__xss") is None and "<img src=x" in mac.inner_text(".accmain"), "C1: HTML in a table cell is shown as text, never run")
    pr = mac.inner_html(".accprint"); check(CMAIL not in pr and PHONE not in pr and "555" not in pr, "print copy holds neither the contact's email nor phone")
    mac.screenshot(path=str(SHOTS / "30f-accounts-encrypted-import.png"), full_page=True)
    pick(mac, "importAccounts", [src]); mac.evaluate("DASH.app.flush()"); mac.wait_for_timeout(200)
    check(mac.evaluate("DASH.app.state.projStore.plans.find(p => p.name === 'Accounts – Acme Fab').tasks.length") == 4 and "0 added to Projects, 4 already there" in mac.inner_text("#toast"), "re-import adds no duplicate tasks")
    fewer = TMP / "fewer" / "example-account.md"; fewer.parent.mkdir(exist_ok=True); fewer.write_text(re.sub(r"  - \{item: \"" + SENTS[5] + r"\".*\n", "", md)); pick(mac, "importAccounts", [fewer]); mac.evaluate("DASH.app.flush()")
    check(mac.evaluate("DASH.app.state.projStore.plans.find(p => p.name === 'Accounts – Acme Fab').tasks.length") == 4 and "no longer in the file" in mac.inner_text(".accmain"), "a loop removed from the file keeps its Projects task")
    # S2c: a reworded loop is only proposed ("Possible rename"); nothing merges until Same task / New task
    cnt = lambda: mac.evaluate("DASH.app.state.projStore.plans.find(p => p.name === 'Accounts – Acme Fab').tasks.length")
    oldt = mac.evaluate(f"DASH.app.state.projStore.plans.find(p => p.name === 'Accounts – Acme Fab').tasks.find(x => x.title === '{SENTS[6]}')")
    def imp(f): pick(mac, "importAccounts", [f]); mac.evaluate("DASH.app.flush()"); mac.wait_for_timeout(200)
    rw = TMP / "rw" / "example-account.md"; rw.parent.mkdir(exist_ok=True); rw.write_text(fewer.read_text().replace(SENTS[6], SENTS[6] + " follow up")); imp(rw)
    ask = mac.query_selector(".accask")
    check(ask is not None and SENTS[6] in ask.inner_text() and "Same task" in ask.inner_text() and "New task" in ask.inner_text() and cnt() == 4 and "1 possible rename" in mac.inner_text("#toast") and "waiting for your choice" in mac.inner_text(".accmain"), "reworded loop: the Possible rename prompt shows old and new titles; no task merged or made yet")
    mac.screenshot(path=str(SHOTS / "30g-possible-rename-prompt.png"), full_page=True)
    imp(rw); check(cnt() == 4 and mac.eval_on_selector_all(".accask .askrow", "e => e.length") == 1, "re-import while the rename is unanswered keeps one prompt and adds no task")
    mac.click(".accask [data-ch=same]"); mac.evaluate("DASH.app.flush()"); mac.wait_for_timeout(200)
    u = mac.evaluate(f"DASH.app.state.projStore.plans.find(p => p.name === 'Accounts – Acme Fab').tasks.find(x => x.id === '{oldt['id']}')")
    check(mac.query_selector(".accask") is None and cnt() == 4 and u["title"] == SENTS[6] + " follow up" and u["notes"].endswith("Previously: " + SENTS[6]), "Same task: the old task takes the new title; 'Previously: <old>' is added to its notes")
    rw2 = TMP / "rw2" / "example-account.md"; rw2.parent.mkdir(exist_ok=True); rw2.write_text(rw.read_text().replace(SENTS[6] + " follow up", SENTS[6] + " follow up again")); imp(rw2)
    check(mac.query_selector(".accask") is not None and cnt() == 4, "a second rewording asks again")
    mac.click(".accask [data-ch=new]"); mac.evaluate("DASH.app.flush()"); mac.wait_for_timeout(200)
    u2 = mac.evaluate(f"DASH.app.state.projStore.plans.find(p => p.name === 'Accounts – Acme Fab').tasks.find(x => x.id === '{oldt['id']}')")
    check(mac.query_selector(".accask") is None and cnt() == 5 and u2 == u and mac.evaluate(f"DASH.app.state.projStore.plans.find(p => p.name === 'Accounts – Acme Fab').tasks.some(x => x.title === '{SENTS[6]} follow up again')"), "New task: a new task is made and the old one is left alone")
    imp(rw2); check(cnt() == 5 and mac.query_selector(".accask") is None, "re-import after the choice: no prompt, no new task")
    # RC1: a repeated loop (exact match) whose task is completed and whose date is later asks Same task (reopen) / New task
    TQ = "DASH.app.state.projStore.plans.find(p => p.name === 'Accounts – Acme Fab').tasks.find(x => x.title.startsWith('Spacing review notes'))"
    def complete(): mac.evaluate(f"(() => {{ const t = {TQ}; t.status = 'completed'; t.percent = 100; t.completedOn = '2026-10-19'; }})()")
    complete(); rc = TMP / "rc" / "example-account.md"; rc.parent.mkdir(exist_ok=True); rc.write_text(rw2.read_text().replace("next_date: 2026-10-21", "next_date: 2026-11-04")); imp(rc)
    rq = mac.query_selector(".accrecur")
    check(rq is not None and "Same task (reopen)" in rq.inner_text() and "New task" in rq.inner_text() and "2026-11-04" in rq.inner_text() and cnt() == 5 and mac.evaluate(TQ + ".status") == "completed" and "repeated loop: waiting for your choice" in mac.inner_text(".accmain"), "RC1: a later-dated repeat of a completed task shows the Repeated loop prompt; nothing linked or made")
    mac.screenshot(path=str(SHOTS / "30h-repeated-loop-prompt.png"), full_page=True)
    imp(rc); check(cnt() == 5 and mac.eval_on_selector_all(".accrecur .askrow", "e => e.length") == 1, "RC1: re-import while unanswered keeps one prompt and adds no task")
    mac.click(".tab[data-view=focus]"); mac.wait_for_timeout(200)
    pe = mac.query_selector(".accfocus .accpend")
    check(pe is not None and "1 import prompt waiting for your choice" in pe.inner_text(), "N1: Daily Focus 🤝 Account touches shows the count of prompts waiting")
    mac.screenshot(path=str(SHOTS / "30i-focus-pending-prompts.png"), full_page=True)
    mac.click(".accfocus .accpend [data-accgo]"); mac.wait_for_timeout(200)
    mac.click(".accrecur [data-ch=same]"); mac.evaluate("DASH.app.flush()"); mac.wait_for_timeout(200)
    check(mac.query_selector(".accrecur") is None and cnt() == 5 and mac.evaluate(TQ + ".status") == "notStarted" and mac.evaluate(TQ + ".due") == "2026-11-04", "RC1 Same task: the completed task is reopened with the loop's new date")
    imp(rc); check(cnt() == 5 and mac.query_selector(".accask") is None, "RC1: re-import after Same task adds nothing and asks nothing")
    complete(); rc2 = TMP / "rc2" / "example-account.md"; rc2.parent.mkdir(exist_ok=True); rc2.write_text(rc.read_text().replace("next_date: 2026-11-04", "next_date: 2026-11-18")); imp(rc2)
    check(mac.query_selector(".accrecur") is not None, "RC1: a later repeat asks again")
    mac.click(".accrecur [data-ch=new]"); mac.evaluate("DASH.app.flush()"); mac.wait_for_timeout(200)
    check(mac.query_selector(".accrecur") is None and cnt() == 6 and mac.evaluate(TQ + ".status") == "completed", "RC1 New task: a new task is made; the completed one is left alone")
    imp(rc2); check(cnt() == 6 and mac.query_selector(".accask") is None, "RC1: re-import after New task adds nothing and asks nothing")
    mac.click(".tab[data-view=focus]"); mac.wait_for_timeout(150); check(mac.query_selector(".accfocus .accpend") is None, "N1: the count goes away when no prompt is waiting")
    mac.click(".tab[data-view=accounts]"); mac.wait_for_timeout(150)
    before = {n: (data / n).read_text() for n in ("accounts-store.json.enc", "contacts.json.enc")}
    mac.click('.mtop:has-text("File")'); mac.click('[data-act="encryption"]'); mac.wait_for_selector("[data-v='lock']"); mac.click("[data-v='lock']"); mac.wait_for_timeout(100)
    pick(mac, "importAccounts", [src]); t1 = mac.inner_text("#toast"); pick(mac, "importContacts", [csvf]); t2 = mac.inner_text("#toast"); mac.evaluate("DASH.app.flush()")
    check("needs an encrypted, unlocked" in t1 and "needs an encrypted, unlocked" in t2 and all((data / n).read_text() == v for n, v in before.items()), "locked folder: both imports refused; files unchanged")
    c.close(); b.close()
check(not errors, "no page errors" + (f": {errors[:3]}" if errors else ""))
print("T30", "PASS" if ok else "FAIL"); sys.exit(0 if ok else 1)
