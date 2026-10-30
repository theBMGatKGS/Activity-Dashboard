"""T34 (00.10.000 rev 3): File → Links… syncs across computers as links.json.enc.  Fictional data only.
Two computers share one encrypted Data folder: the newest change to each link wins and the others are kept; the iPad can change Links;
nothing is plaintext in the folder; Links are never exported; a plain links.json is never adopted; a locked computer reads and writes
nothing; EXAMPLE DATA writes nothing; the 00.10.000 per-computer cache is migrated once.  argv[1]: shots dir."""
import pathlib, shutil, tempfile, json, os, sys
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
def fs(op, name, text):
    if op == "list": return sorted(x for x in os.listdir(data) if not x.endswith(".crswap"))
    pth = data / name
    if op == "read":
        if not pth.exists(): return None
        s2 = pth.stat(); return {"m": int(s2.st_mtime_ns // 1_000_000), "size": s2.st_size, "text": pth.read_text()}
    if op == "write": t3 = data / (name + ".crswap"); t3.write_text(text); os.replace(t3, pth); return True
    if op == "remove": pth.unlink(missing_ok=True); return True
DEC = "(async () => { const f = await (await window.DASH_TEST_FS.getFileHandle('links.json.enc')).getFile(); return JSON.parse(await DASH.vault.decrypt(DASH.app.state.vault.key, DASH.app.state.vault.kr, await f.text(), 'links')); })()"
def folder_text(): return "".join((data / n).read_text(errors="ignore") for n in os.listdir(data) if (data / n).is_file())
def sync(pg): pg.evaluate("DASH.app.syncNow()"); pg.evaluate("DASH.app.flush()"); pg.wait_for_timeout(400); pg.evaluate("DASH.app.flush()")
def links_dialog(pg, **kv):
    pg.click('.mtop:has-text("File")'); pg.click('[data-act="links"]'); pg.wait_for_selector("#linksdlg")
    for k, v in kv.items(): pg.fill("#lk-" + k, v)
    return pg
with sync_playwright() as p:
    b = p.chromium.launch()
    def computer(m, t="09:20", w=1440, h=900):
        c = b.new_context(viewport={"width": w, "height": h}); c.expose_function("__fs", fs); c.add_init_script(FS_JS)
        pg = c.new_page(); pg.on("pageerror", lambda e: errors.append(f"{m}: {e}")); pg.on("dialog", lambda d: d.accept()); pg.goto((app / "index.html").as_uri() + Q(m, t)); return c, pg
    # 1. desk1 encrypts the folder and sets Links
    c1, mac = computer("desk1"); mac.wait_for_selector("#view-events"); sync(mac)
    mac.click('.mtop:has-text("File")'); mac.click('[data-act="encryption"]'); mac.wait_for_selector("#vaultsetup"); mac.fill("#vp1", PASS); mac.fill("#vp2", PASS); mac.click("#vs-ok")
    mac.wait_for_selector("#rk-value", timeout=60000); mac.check("#rk-done"); mac.click("#rk-ok"); mac.wait_for_function("() => document.querySelector('#toast').textContent.startsWith('Data folder encrypted')", timeout=60000)
    links_dialog(mac, vault="Example Vault", repo=REPO); mac.click("#lk-save"); mac.wait_for_timeout(300); mac.evaluate("DASH.app.flush()")
    names = sorted(os.listdir(data))
    check("links.json.enc" in names and "links.json" not in names, f"Links are saved to the folder as links.json.enc only ({[n for n in names if n.startswith('links')]})")
    check("example-owner" not in folder_text() and "Example Vault" not in folder_text(), "no Links value is plaintext anywhere in the folder")
    d = mac.evaluate(DEC); check(d["links"]["vault"]["v"] == "Example Vault" and d["links"]["vault"]["by"] == "desk1", "control: the decrypted file holds the link, stamped with time and computer")
    # 2. the iPad (narrow) unlocks, reads them, and changes the branch
    c2, ipad = computer("ipad1", "09:30", 820, 1180); ipad.wait_for_selector("#vaultunlock", timeout=60000); ipad.fill("#vault-pass", PASS); ipad.click("#vault-ok")
    ipad.wait_for_function("() => DASH.app.state.vault.key", timeout=60000); sync(ipad)
    check(ipad.evaluate("DASH.app.state.links && DASH.app.state.links.vault") == "Example Vault", "the iPad reads Links from links.json.enc")
    links_dialog(ipad, branch="dev"); ipad.wait_for_selector("#lk-sync")
    check(ipad.inner_text("#linksdlg .vt") == "🔗 Links (synced, encrypted)", "the Links dialog title says they are synced and encrypted")
    check("desk1" in ipad.inner_text("#lk-sync"), "the Links dialog shows when and where each link last changed")
    ipad.screenshot(path=str(SHOTS / "34c-links-sync-ipad.png")); ipad.click("#lk-save"); ipad.wait_for_timeout(300); ipad.evaluate("DASH.app.flush()")
    d = ipad.evaluate(DEC); check(d["links"]["branch"]["v"] == "dev" and d["links"]["branch"]["by"] == "ipad1" and d["links"]["vault"]["by"] == "desk1", "the iPad can change Links; its change is stamped ipad1, the others kept")
    # 3. desk1 changes the vault name before it has seen the iPad's change: per-link merge keeps both
    mac.evaluate("(() => { const S = DASH.app.state; S.linksStore = DASH.events.setLinks(S.linksStore, { vault: 'Other Vault' }, '2026-10-19T09:40:00-05:00', 'desk1'); })()")
    sync(mac); d = mac.evaluate(DEC)
    check(d["links"]["vault"]["v"] == "Other Vault" and d["links"]["branch"]["v"] == "dev", f"newest change per link wins and the others are kept ({d['links']['vault']['v']}, {d['links']['branch']['v']})")
    sync(ipad); check(ipad.evaluate("[DASH.app.state.links.vault, DASH.app.state.links.branch]") == ["Other Vault", "dev"], "the iPad picks up the merged Links")
    # 4. an older change never wins over a newer one
    mac.evaluate("(() => { const S = DASH.app.state; S.linksStore = DASH.events.setLinks(S.linksStore, { branch: 'old' }, '2026-10-19T09:00:00-05:00', 'desk1'); })()"); sync(mac)
    check(mac.evaluate(DEC)["links"]["branch"]["v"] == "dev", "an older change to a link loses to the newer one")
    # 5. never exported; IndexedDB holds an envelope only
    exp = mac.evaluate("DASH.db.exportAll().then(x => JSON.stringify(x))"); check("example-owner" not in exp and "links" not in json.loads(exp), "Links are never in File → Export local data")
    raw = mac.evaluate("DASH.db.getRaw('links')"); check(raw and raw.get("dashCache") == 1 and "example-owner" not in json.dumps(raw), "IndexedDB: Links are an encrypted envelope")
    # 6. a plain links.json is never adopted
    (data / "links.json").write_text(json.dumps({"schema_version": 1, "updated_at": "2026-10-19T23:00:00-05:00", "links": {"vault": {"v": "Plain Vault", "at": "2026-10-19T23:00:00-05:00", "by": "x"}}}))
    sync(mac); check(mac.evaluate("DASH.app.state.links.vault") == "Other Vault" and "links.json" in mac.inner_text("body"), "a plain links.json is ignored, with a problem line")
    (data / "links.json").unlink()
    c1.close(); c2.close()
    # 7. locked: nothing read, nothing written
    before = (data / "links.json.enc").read_text()
    c3, lk = computer("pc3", "10:00"); lk.wait_for_selector("#vaultunlock", timeout=60000); lk.wait_for_timeout(400)
    check(lk.evaluate("DASH.app.state.links") is None and (data / "links.json.enc").read_text() == before, "locked: Links are not read and nothing is written")
    c3.close()
    # 8. migration of the 00.10.000 per-computer cache (plain object) into the synced store, once
    c4, mg = computer("mig1", "10:00"); mg.wait_for_selector("#vaultunlock", timeout=60000); mg.fill("#vault-pass", PASS); mg.click("#vault-ok"); mg.wait_for_function("() => DASH.app.state.vault.key", timeout=60000); sync(mg)
    mg.evaluate("DASH.db.set('links', { vault: 'Example Vault', repo: '" + REPO + "', branch: 'legacy', sources: 'crm/outbox/sam-report/{month}/sources.md' })"); mg.evaluate("DASH.app.flush()")
    mg.reload(); mg.wait_for_function("() => DASH.app.state.vault.key", timeout=60000); sync(mg)
    d = mg.evaluate(DEC); check(d["links"]["branch"]["v"] == "legacy" and d["links"]["branch"]["by"] == "mig1" and d["schema_version"] == 1, "the old per-computer Links cache is migrated into links.json.enc")
    c4.close()
    # 9. EXAMPLE DATA: the dialog refuses and nothing is cached or written
    c5 = b.new_context(viewport={"width": 1440, "height": 900}); ex = c5.new_page(); ex.on("pageerror", lambda e: errors.append(f"ex: {e}"))
    ex.goto((SRC / "index.html").as_uri() + Q("example")); ex.wait_for_selector("#view-events"); ex.click('.mtop:has-text("File")'); ex.click('[data-act="links"]'); ex.wait_for_timeout(200)
    check(ex.query_selector("#linksdlg") is None and "EXAMPLE DATA" in ex.inner_text("#toast") and ex.evaluate("DASH.db.getRaw('links')") is None, "EXAMPLE DATA: Links refuse and nothing is cached")
    c5.close(); b.close()
check(not errors, f"no page errors ({errors[:3]})")
print("T34 links sync:", "PASS" if ok else "FAIL"); sys.exit(0 if ok else 1)
