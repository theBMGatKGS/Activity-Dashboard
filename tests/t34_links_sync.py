"""T34 (00.10.000 rev 3): File → Links… syncs across computers as links.json.enc.  Fictional data only.
Two computers share one encrypted Data folder: the newest change to each link wins and the others are kept; the iPad can change Links;
nothing is plaintext in the folder; Links are never exported; a plain links.json is never adopted; a locked computer reads and writes
nothing; EXAMPLE DATA writes nothing; the 00.10.000 per-computer cache is migrated once.  argv[1]: shots dir."""
import pathlib, shutil, tempfile, json, os, sys, time
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True; errors = []
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(tempfile.mkdtemp(prefix="dash-t34-")); SHOTS.mkdir(parents=True, exist_ok=True)
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
Q = lambda m, t="09:20": f"?now=2026-10-19T{t}:00-05:00&machine={m}&view=events"
PASS = "correct horse battery 10000"; REPO = "https://github.com/example-owner/example-notebook"
FS_JS = (SRC / "tests/t21_vault.py").read_text().split('FS_JS = """', 1)[1].split('"""', 1)[0]
tmp = pathlib.Path(tempfile.mkdtemp()); app = tmp / "Dashboard"; shutil.copytree(SRC, app, ignore=shutil.ignore_patterns("tests", ".git"))
snap = json.loads((app / "examples/example-snapshot.json").read_text()); snap.pop("example")
data = tmp / "Data"; data.mkdir(); (data / "inbox-snapshot.json").write_text(json.dumps(snap))
HIDE = set()   # names hidden from the folder stand-in (simulates a computer that hasn't synced yet)
def fs(op, name, text):
    if name in HIDE and op == "read": return None
    if op == "list": return sorted(x for x in os.listdir(data) if not x.endswith(".crswap") and x not in HIDE)
    pth = data / name
    if op == "read":
        if not pth.exists(): return None
        s2 = pth.stat(); return {"m": int(s2.st_mtime_ns // 1_000_000), "size": s2.st_size, "text": pth.read_text()}
    if op == "write": t3 = data / f"{name}.{os.getpid()}-{time.time_ns()}.crswap"; t3.write_text(text); os.replace(t3, pth); return True
    if op == "remove": pth.unlink(missing_ok=True); return True
DEC = "(async () => { const f = await (await window.DASH_TEST_FS.getFileHandle('links.json.enc')).getFile(); return JSON.parse(await DASH.vault.decrypt(DASH.app.state.vault.key, DASH.app.state.vault.kr, await f.text(), 'links')); })()"
def folder_text(): return "".join((data / n).read_text(errors="ignore") for n in os.listdir(data) if (data / n).is_file())
import time
def sync(pg): pg.evaluate("DASH.app.syncNow()"); pg.evaluate("DASH.app.flush()")
def until(pg, pred, what="condition", limit=60):   # B1: condition waits, not fixed sleeps: sync and flush until the condition holds (or fail after 60 s)
    t0 = time.time()
    while True:
        sync(pg)
        try:
            if pred(): return True
        except Exception: pass
        if time.time() - t0 > limit: print("WAIT TIMEOUT " + what); return False
        pg.wait_for_function("() => new Promise(r => requestAnimationFrame(() => r(true)))")
def dec(pg):
    try: return pg.evaluate(DEC)
    except Exception: return None
def link(pg, k):
    d = dec(pg); return d and d["links"].get(k, {}).get("v")
def stamp(pg, js): pg.evaluate("(() => { const S = DASH.app.state; S.linksStore = DASH.events.setLinks(S.linksStore, " + js + "); S.linksDirty = true; })()")
def save_dialog(pg): pg.click("#lk-save"); pg.wait_for_selector("#linksdlg", state="detached", timeout=60000); pg.evaluate("DASH.app.flush()")
def links_dialog(pg, **kv):
    pg.click('.mtop:has-text("File")'); pg.click('[data-act="links"]'); pg.wait_for_selector("#linksdlg")
    for k, v in kv.items(): pg.fill("#lk-" + k, v)
    return pg
import re
BAD = []
for f in [SRC / "index.html", SRC / "README.md", SRC / "RELEASE_NOTES.md", SRC / "CHANGELOG.md"] + sorted((SRC / "js").glob("*.js")) + sorted((SRC / "docs").glob("*.md")):
    for i, line in enumerate(f.read_text().split("\n"), 1):
        for sent in re.split(r"(?<=[.!?;])\s+|<p>|<h3", line):
            if re.search(r"\b(on|for) this computer\b", sent, re.I) and re.search(r"\bLinks\b|links\.json|linksdlg|\blinks\b", sent): BAD.append(f"{f.name}:{i}")
check(not BAD, f"no 'on/for this computer' wording about Links in the app or docs ({BAD[:5]})")
with sync_playwright() as p:
    b = p.chromium.launch()
    def computer(m, t="09:20", w=1440, h=900):
        c = b.new_context(viewport={"width": w, "height": h}); c.expose_function("__fs", fs); c.add_init_script(FS_JS)
        pg = c.new_page(); pg.on("pageerror", lambda e: errors.append(f"{m}: {e}")); pg.on("dialog", lambda d: d.accept()); pg.goto((app / "index.html").as_uri() + Q(m, t)); return c, pg
    # 1. desk1 encrypts the folder and sets Links
    c1, mac = computer("desk1"); mac.wait_for_selector("#view-events"); sync(mac)
    mac.click('.mtop:has-text("File")'); mac.click('[data-act="encryption"]'); mac.wait_for_selector("#vaultsetup"); mac.fill("#vp1", PASS); mac.fill("#vp2", PASS); mac.click("#vs-ok")
    mac.wait_for_selector("#rk-value", timeout=60000); mac.check("#rk-done"); mac.click("#rk-ok"); mac.wait_for_function("() => document.querySelector('#toast').textContent.startsWith('Data folder encrypted')", timeout=60000)
    links_dialog(mac, vault="Example Vault", repo=REPO); save_dialog(mac); until(mac, lambda: (data / "links.json.enc").exists(), "desk1 file")
    names = sorted(os.listdir(data))
    check("links.json.enc" in names and "links.json" not in names, f"Links are saved to the folder as links.json.enc only ({[n for n in names if n.startswith('links')]})")
    check("example-owner" not in folder_text() and "Example Vault" not in folder_text(), "no Links value is plaintext anywhere in the folder")
    d = mac.evaluate(DEC); check(d["links"]["vault"]["v"] == "Example Vault" and d["links"]["vault"]["by"] == "desk1", "control: the decrypted file holds the link, stamped with time and computer")
    # 2. the iPad (narrow) unlocks, reads them, and changes the branch
    c2, ipad = computer("ipad1", "09:22", 820, 1180); ipad.wait_for_selector("#vaultunlock", timeout=60000); ipad.fill("#vault-pass", PASS); ipad.click("#vault-ok")   # clocks within FUTURE_MS of each other
    ipad.wait_for_function("() => DASH.app.state.vault.key", timeout=60000); until(ipad, lambda: ipad.evaluate("DASH.app.state.links && DASH.app.state.links.vault") == "Example Vault", "ipad read")
    check(ipad.evaluate("DASH.app.state.links && DASH.app.state.links.vault") == "Example Vault", "the iPad reads Links from links.json.enc")
    links_dialog(ipad, branch="dev"); ipad.wait_for_selector("#lk-sync")
    check(ipad.inner_text("#linksdlg .vt") == "🔗 Links (synced, encrypted)", "the Links dialog title says they are synced and encrypted")
    check("desk1" in ipad.inner_text("#lk-sync"), "the Links dialog shows when and where each link last changed")
    ipad.screenshot(path=str(SHOTS / "34c-links-sync-ipad.png")); save_dialog(ipad); until(ipad, lambda: link(ipad, "branch") == "dev", "ipad branch")
    d = ipad.evaluate(DEC); check(d["links"]["branch"]["v"] == "dev" and d["links"]["branch"]["by"] == "ipad1" and d["links"]["vault"]["by"] == "desk1", "the iPad can change Links; its change is stamped ipad1, the others kept")
    # 2b. desk1, which hasn't synced since, edits the repo through the real dialog: Save merges the folder copy first
    HIDE.add("links.json.enc"); mac.goto((app / "index.html").as_uri() + Q("desk1", "09:24")); mac.wait_for_function("() => DASH.app.state.vault.key", timeout=60000); until(mac, lambda: mac.evaluate("DASH.app.state.linksLoaded") is True, "desk1 cache")   # desk1, a few minutes later, before it syncs Links
    check(mac.evaluate("DASH.app.state.links && DASH.app.state.links.repo") == REPO and mac.evaluate("DASH.app.state.links.branch") != "dev", "precondition: desk1 has not seen the iPad's branch yet")
    links_dialog(mac, repo=REPO + "-two"); HIDE.clear(); save_dialog(mac)
    d = dec(mac); check(d["links"]["repo"]["v"] == REPO + "-two" and d["links"]["branch"]["v"] == "dev", f"dialog edits on two computers: both kept ({d['links']['repo']['v'][-4:]}, {d['links']['branch']['v']})")
    # 3. desk1 changes the vault name before it has seen the iPad's change: per-link merge keeps both
    stamp(mac, "{ vault: 'Other Vault' }, '2026-10-19T09:21:00-05:00', 'desk1'")
    until(mac, lambda: link(mac, "vault") == "Other Vault", "mac vault"); d = dec(mac)
    check(d["links"]["vault"]["v"] == "Other Vault" and d["links"]["branch"]["v"] == "dev", f"newest change per link wins and the others are kept ({d['links']['vault']['v']}, {d['links']['branch']['v']})")
    until(ipad, lambda: ipad.evaluate("[DASH.app.state.links.vault, DASH.app.state.links.branch]") == ["Other Vault", "dev"], "ipad merged"); check(ipad.evaluate("[DASH.app.state.links.vault, DASH.app.state.links.branch]") == ["Other Vault", "dev"], "the iPad picks up the merged Links")
    # 4. an older change never wins over a newer one
    stamp(mac, "{ branch: 'old' }, '2026-10-19T09:00:00-05:00', 'desk1'"); until(mac, lambda: mac.evaluate("DASH.app.state.linksDirty") is False and link(mac, "branch") is not None, "older")
    check(mac.evaluate(DEC)["links"]["branch"]["v"] == "dev", "an older change to a link loses to the newer one")
    # 4b. delete versus edit: a clear is a dated change; the newer of clear and edit wins, either way round
    stamp(ipad, "{ sources: '' }, '2026-10-19T09:21:40-05:00', 'ipad1'"); until(ipad, lambda: link(ipad, "sources") == "", "ipad clear")
    stamp(mac, "{ sources: 'crm/other/{month}.md' }, '2026-10-19T09:21:20-05:00', 'desk1'"); until(mac, lambda: mac.evaluate("DASH.app.state.linksDirty") is False and mac.evaluate("DASH.app.state.linksStore.links.sources.v") == "", "older edit")
    check(link(mac, "sources") == "", "delete vs edit: a newer clear beats an older edit")
    stamp(mac, "{ sources: 'crm/other/{month}.md' }, '2026-10-19T09:21:50-05:00', 'desk1'"); until(mac, lambda: link(mac, "sources") == "crm/other/{month}.md", "newer edit")
    until(ipad, lambda: ipad.evaluate("DASH.app.state.linksStore.links.sources.v") == "crm/other/{month}.md", "ipad edit")
    check(link(mac, "sources") == "crm/other/{month}.md" and ipad.evaluate("DASH.app.state.linksStore.links.sources.v") == "crm/other/{month}.md", "delete vs edit: a newer edit beats an older clear, on both computers")
    # 4c. exact tie (same stamp, same updated_at): the alphabetically first computer wins, whichever syncs first
    T = "'2026-10-19T09:24:30-05:00'"
    mac.evaluate("(() => { const S = DASH.app.state; S.linksStore = DASH.events.setLinks(S.linksStore, { branch: 'tie-desk' }, " + T + ", 'desk1'); S.linksStore.updated_at = " + T + "; S.linksDirty = true; })()")
    ipad.evaluate("(() => { const S = DASH.app.state; S.linksStore = DASH.events.setLinks(S.linksStore, { branch: 'tie-ipad' }, " + T + ", 'ipad1'); S.linksStore.updated_at = " + T + "; S.linksDirty = true; })()")
    same = lambda: mac.evaluate("DASH.app.state.linksStore.links.branch.v") == ipad.evaluate("DASH.app.state.linksStore.links.branch.v") == link(mac, "branch")
    until(ipad, lambda: ipad.evaluate("DASH.app.state.linksDirty") is False, "ipad tie"); until(mac, lambda: mac.evaluate("DASH.app.state.linksDirty") is False, "mac tie")
    for _ in range(3): until(ipad, same, "tie ipad"); until(mac, same, "tie mac")
    w = link(mac, "branch"); exp = mac.evaluate("(() => { const E = DASH.events, a = { schema_version: 1, updated_at: '2026-10-19T09:22:00-05:00', links: { branch: { v: 'tie-desk', at: " + T + ", by: 'desk1' } } }, b = { schema_version: 1, updated_at: '2026-10-19T09:22:00-05:00', links: { branch: { v: 'tie-ipad', at: " + T + ", by: 'ipad1' } } }; return [E.mergeLinks(a, b).links.branch.v, E.mergeLinks(b, a).links.branch.v]; })()")
    check(same() and w in ("tie-desk", "tie-ipad") and exp == ["tie-desk", "tie-desk"], f"exact tie: both computers and the file settle on one winner ({w}); with equal store stamps desk1 (alphabetically first) wins either way")
    # 4d. a future stamp (a computer whose clock is ahead) is refused with a problem line and can't win over a later real edit
    fut = mac.evaluate("""(async () => { const S = DASH.app.state; const st = JSON.parse(JSON.stringify(S.linksStore)); st.links.vault = { v: 'Future Vault', at: '2027-01-01T00:00:00-06:00', by: 'pc9' }; st.updated_at = '2027-01-01T00:00:00-06:00';
      return DASH.vault.encrypt(S.vault.key, S.vault.kr, 'links', JSON.stringify(st)); })()""")
    (data / "links.json.enc").write_text(fut)
    until(mac, lambda: "dated in the future" in " ".join(mac.evaluate("DASH.app.state.problems")) and link(mac, "vault") == "Other Vault", "future refused")
    check(mac.evaluate("DASH.app.state.links.vault") == "Other Vault" and link(mac, "vault") == "Other Vault" and "2027" not in json.dumps(dec(mac)), "future stamp: refused, the file is written back without it")
    check(any("links.json.enc" in x and "dated in the future" in x for x in mac.evaluate("DASH.app.state.problems")), "future stamp: a problem line names links.json.enc")
    links_dialog(ipad, vault="Later Vault"); save_dialog(ipad); check(link(ipad, "vault") == "Later Vault", "future stamp: a later real edit (iPad dialog) still wins")
    until(mac, lambda: mac.evaluate("DASH.app.state.links.vault") == "Later Vault", "mac later")
    # 5. never exported; IndexedDB holds an envelope only
    exp = mac.evaluate("DASH.db.exportAll().then(x => JSON.stringify(x))"); check("example-owner" not in exp and "links" not in json.loads(exp), "Links are never in File → Export local data")
    raw = mac.evaluate("DASH.db.getRaw('links')"); check(raw and raw.get("dashCache") == 1 and "example-owner" not in json.dumps(raw), "IndexedDB: Links are an encrypted envelope")
    # 6. a plain links.json is never adopted
    (data / "links.json").write_text(json.dumps({"schema_version": 1, "updated_at": "2026-10-19T23:00:00-05:00", "links": {"vault": {"v": "Plain Vault", "at": "2026-10-19T23:00:00-05:00", "by": "x"}}}))
    PL = lambda: any("links.json: plaintext" in x for x in mac.evaluate("DASH.app.state.problems"))
    until(mac, PL, "plain problem")
    check(mac.evaluate("DASH.app.state.links.vault") == "Later Vault" and PL(), "a plain links.json is ignored, with a problem line")
    (data / "links.json").unlink()
    c1.close(); c2.close()
    # 7. locked: nothing read, nothing written
    before = (data / "links.json.enc").read_text()
    c3, lk = computer("pc3", "10:00"); lk.wait_for_selector("#vaultunlock", timeout=60000); lk.evaluate("DASH.app.flush()")
    check(lk.evaluate("DASH.app.state.links") is None and (data / "links.json.enc").read_text() == before, "locked: Links are not read and nothing is written")
    c3.close()
    # 8. migration of the 00.10.000 per-computer cache (plain object) into the synced store, once
    c4, mg = computer("mig1", "10:00"); mg.wait_for_selector("#vaultunlock", timeout=60000); mg.fill("#vault-pass", PASS); mg.click("#vault-ok"); mg.wait_for_function("() => DASH.app.state.vault.key", timeout=60000); until(mg, lambda: mg.evaluate("DASH.app.state.links && DASH.app.state.links.vault") == "Later Vault", "mig read")
    mg.evaluate("DASH.db.set('links', { vault: 'Example Vault', repo: '" + REPO + "', branch: 'legacy', sources: 'crm/outbox/sam-report/{month}/sources.md' })"); mg.evaluate("DASH.app.flush()")
    mg.reload(); mg.wait_for_function("() => DASH.app.state.vault.key", timeout=60000); until(mg, lambda: link(mg, "branch") == "legacy", "migration")
    d = dec(mg); check(d["links"]["branch"]["v"] == "legacy" and d["links"]["branch"]["by"] == "mig1" and d["schema_version"] == 1, "the old per-computer Links cache is migrated into links.json.enc")
    c4.close()
    # 9. EXAMPLE DATA: the dialog refuses and nothing is cached or written
    c5 = b.new_context(viewport={"width": 1440, "height": 900}); ex = c5.new_page(); ex.on("pageerror", lambda e: errors.append(f"ex: {e}"))
    ex.goto((SRC / "index.html").as_uri() + Q("example")); ex.wait_for_selector("#view-events"); ex.click('.mtop:has-text("File")'); ex.click('[data-act="links"]'); ex.wait_for_function("() => document.querySelector('#toast').textContent.includes('EXAMPLE DATA')", timeout=60000)
    check(ex.query_selector("#linksdlg") is None and "EXAMPLE DATA" in ex.inner_text("#toast") and ex.evaluate("DASH.db.getRaw('links')") is None, "EXAMPLE DATA: Links refuse and nothing is cached")
    c5.close(); b.close()
check(not errors, f"no page errors ({errors[:3]})")
print("T34 links sync:", "PASS" if ok else "FAIL"); sys.exit(0 if ok else 1)
