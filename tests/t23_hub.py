"""T23 (00.04): GitHub encrypted data hub, end to end in Chromium. The GitHub API is mocked with page.route (no network,
no real repo, no real token). Synthetic/fictional example data only.
Machines: "workpc" with a Data folder (test stand-in, as T21) that mirrors to the hub; "ipad" with NO folder support
(showDirectoryPicker removed, like iPad Safari) that uses the hub as its store.
Checks: menu → GitHub sync dialog has the token steps; plaintext never reaches the hub; iPad connects with repo + token +
passphrase; same totals; edits flow both ways with the 00.02 rules; token stored only as an envelope (raw IndexedDB scan);
reload reconnects; offline is reported and recovers; public repo refused; classic token refused; CSP allows only
api.github.com; frame-busting; service worker never caches API responses (route-level)."""
import pathlib, shutil, tempfile, json, os, sys, base64, hashlib, re
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
FS_JS = (SRC / "tests/t21_vault.py").read_text().split('FS_JS = """', 1)[1].split('"""', 1)[0]
tmp = pathlib.Path(tempfile.mkdtemp()); app = tmp / "Dashboard"; shutil.copytree(SRC, app, ignore=shutil.ignore_patterns("tests", ".git"))
snap = json.loads((app / "examples/example-snapshot.json").read_text()); snap.pop("example")
data = tmp / "Data"; data.mkdir(); (data / "inbox-snapshot.json").write_text(json.dumps(snap))
SECRETS = sorted({i.get(k) for lst in ("tasks", "calendar", "accounts") for i in snap.get(lst, []) for k in ("person", "title", "account", "name") if isinstance(i.get(k), str) and len(i.get(k)) > 4} | {"Account A", "Account D"})
def fs(op, name, text):
    if op == "list": return sorted(x for x in os.listdir(data) if not x.endswith(".crswap"))
    p = data / name
    if op == "read":
        if not p.exists(): return None
        st = p.stat(); return {"m": int(st.st_mtime_ns // 1_000_000), "size": st.st_size, "text": p.read_text()}
    if op == "write": t = data / (name + ".crswap"); t.write_text(text); os.replace(t, p); return True
    if op == "remove": p.unlink(); return True
# ---- fake GitHub (shared by all contexts) ----
TOK = {"workpc": "github_pat_" + "W" * 50, "ipad": "github_pat_" + "I" * 50}; REPO = "owner/activity-data-hub"
HUB = {}; STATE = {"commits": 0, "private": True, "offline": False}; CALLS = []
def gsha(b): return hashlib.sha1(b"blob %d\0" % len(b) + b).hexdigest()
CORS = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-GitHub-Api-Version, If-None-Match, Accept",
        "Access-Control-Allow-Methods": "GET, PUT, DELETE", "Access-Control-Expose-Headers": "ETag"}
def handle(route):
    r = route.request; CALLS.append((r.method, r.url, r.headers.get("authorization", "")))
    def reply(s, body=None, extra=None): route.fulfill(status=s, headers=dict(CORS, **(extra or {}), **{"Content-Type": "application/json"}), body=json.dumps(body) if body is not None else "")
    if r.method == "OPTIONS": return reply(204)
    if STATE["offline"]: return route.abort("internetdisconnected")
    if r.headers.get("authorization") not in {"Bearer " + t for t in TOK.values()}: return reply(401, {"message": "Bad credentials"})
    path = re.sub(r"\?.*$", "", r.url.split("api.github.com", 1)[1]); base = "/repos/" + REPO
    if not path.startswith(base): return reply(404, {"message": "Not Found"})
    rest = path[len(base):]; et = '"%d"' % STATE["commits"]
    if rest == "": return reply(200, {"private": STATE["private"]})
    if rest == "/contents/":
        if not HUB: return reply(404, {"message": "This repository is empty."})
        if r.headers.get("if-none-match") == et: return reply(304, None, {"ETag": et})
        return reply(200, [{"type": "file", "name": n, "sha": gsha(b), "size": len(b)} for n, b in sorted(HUB.items())], {"ETag": et})
    name = rest.replace("/contents/", "")
    if r.method == "GET":
        if name not in HUB: return reply(404, {"message": "Not Found"})
        b = HUB[name]; return reply(200, {"type": "file", "name": name, "sha": gsha(b), "size": len(b), "encoding": "base64", "content": base64.b64encode(b).decode()})
    body = json.loads(r.post_data or "{}")
    if r.method == "PUT":
        if name in HUB and body.get("sha") != gsha(HUB[name]): return reply(409, {"message": "sha mismatch"})
        HUB[name] = base64.b64decode(body["content"]); STATE["commits"] += 1; return reply(201, {"content": {"name": name, "sha": gsha(HUB[name]), "size": len(HUB[name])}})
    if r.method == "DELETE": HUB.pop(name, None); STATE["commits"] += 1; return reply(200, {})
    reply(405, {})
Q = "?now=2026-10-19T08:00:00-05:00&machine="
TOT = "JSON.stringify(DASH.app.state.entries.map(e => [e.id, e.minutes]).sort())"
RAW = """new Promise(res => { const r = indexedDB.open('activity-dashboard'); r.onsuccess = () => { const out = {}, t = r.result.transaction('kv'), c = t.objectStore('kv').openCursor();
  c.onsuccess = () => { const x = c.result; if (x) { out[x.key] = x.value; x.continue(); } };
  t.oncomplete = () => res(JSON.stringify(out, (k, v) => (v && typeof v === 'object' && (v.constructor.name === 'CryptoKey' || v.kind === 'directory')) ? '[obj]' : v)); }; })"""
PASS1 = "synthetic hub test passphrase"
errors = []; dialogs = []
def hub_clean():
    blob = b"".join(HUB.values()).decode()
    return all(n == "keyring.json" or n.endswith(".enc") for n in HUB) and not any(s in blob for s in SECRETS) and "Owner/operator" not in blob and '"events"' not in blob and not any(t in blob for t in TOK.values())
with sync_playwright() as p:
    b = p.chromium.launch()
    def page(m, folder):
        ctx = b.new_context(viewport={"width": 1280, "height": 860}); ctx.route("https://api.github.com/**", handle)
        if folder: ctx.expose_function("__fs", fs); ctx.add_init_script(FS_JS)
        else: ctx.add_init_script("delete window.showDirectoryPicker; window.showDirectoryPicker = undefined;")
        pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(f"{m}: {e}")); pg.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))
        pg.on("console", lambda msg: errors.append(f"{m} CSP: {msg.text}") if "Content Security Policy" in msg.text else None)
        pg.goto((app / "index.html").as_uri() + Q + m); return pg
    def ready(pg): pg.wait_for_selector(".tile"); pg.evaluate("DASH.app.syncNow()"); pg.evaluate("DASH.app.flush()")
    def menu(pg, act): pg.click('.mtop:has-text("File")'); pg.click(f'[data-act="{act}"]')
    # --- work PC: folder, encryption on, then GitHub sync from the menu
    pc = page("workpc", True); ready(pc)
    menu(pc, "encryption"); pc.wait_for_selector("#vaultsetup"); pc.fill("#vp1", PASS1); pc.fill("#vp2", PASS1); pc.click("#vs-ok")
    pc.wait_for_selector("#rk-value", timeout=20000); pc.check("#rk-done"); pc.click("#rk-ok"); pc.wait_for_function("() => document.querySelector('#toast').textContent.startsWith('Data folder encrypted')", timeout=20000); pc.evaluate("DASH.app.flush()")
    pc_tot = pc.evaluate(TOT)
    menu(pc, "hub"); pc.wait_for_selector("#hubdlg")
    steps = pc.inner_text("#hubdlg")
    check(all(s in steps for s in ["Fine-grained tokens", "Only select repositories", "Contents: Read and write", "one year", "private"]), "dialog: in-app steps for the per-machine fine-grained token (one repo, Contents R/W, 1 year)")
    pc.fill("#hub-repo", REPO); pc.fill("#hub-token", "ghp_" + "C" * 36); pc.click("#hub-ok"); pc.wait_for_function("() => /classic/.test(document.querySelector('#hub-err').textContent)")
    check(not HUB, "dialog: a classic token is refused; nothing sent")
    STATE["private"] = False; pc.fill("#hub-token", TOK["workpc"]); pc.click("#hub-ok"); pc.wait_for_function("() => /PRIVATE/.test(document.querySelector('#hub-err').textContent)", timeout=10000)
    check(not HUB, "dialog: a public repo is refused; nothing sent"); STATE["private"] = True
    pc.click("#hub-ok"); pc.wait_for_function("() => !document.querySelector('#hubdlg')", timeout=20000); pc.evaluate("DASH.app.flush()"); pc.evaluate("DASH.app.syncNow()")
    check(sorted(HUB) == ["inbox-snapshot.json.enc", "keyring.json", "time-workpc.json.enc"], f"PC connect: hub holds keyring + encrypted files only ({sorted(HUB)})")
    check(hub_clean(), "PC connect: nothing readable (names, labels, event JSON, token) in the hub")
    check("☁" in pc.inner_text("#sync"), "sync chip shows the GitHub cloud mark")
    raw = pc.evaluate(RAW); cfg = json.loads(raw)["hubCfg"]
    check(TOK["workpc"] not in raw and json.loads(cfg["tokenEnv"])["kind"] == "dash-encrypted" and json.loads(cfg["tokenEnv"])["purpose"] == "token", "PC: token stored only as an encrypted envelope (raw IndexedDB scan)")
    check(pc.evaluate("JSON.stringify(localStorage)").find("github_pat_") < 0, "PC: token not in localStorage")
    # --- iPad: no folder support, GitHub is the store
    ipad = page("ipad", False); ipad.wait_for_selector(".tile")
    check("Set up GitHub sync" in ipad.inner_text("#sync"), "iPad: sync chip offers GitHub sync when folders aren't supported")
    ipad.click("#sync"); ipad.wait_for_selector("#hubdlg"); ipad.fill("#hub-repo", REPO); ipad.fill("#hub-token", TOK["ipad"]); ipad.click("#hub-ok")
    ipad.wait_for_selector("#vaultunlock", timeout=20000); ipad.fill("#vault-pass", "wrong passphrase here"); ipad.click("#vault-ok")
    ipad.wait_for_function("() => document.querySelector('#vault-err').textContent.includes('Wrong')", timeout=20000)
    ipad.fill("#vault-pass", PASS1); ipad.click("#vault-ok"); ipad.wait_for_function("() => !document.querySelector('#hubdlg')", timeout=30000); ready(ipad)
    check(ipad.evaluate(TOT) == pc_tot and ipad.evaluate("!DASH.app.state.snap.example"), "iPad: unlocks with the passphrase, reads the snapshot and shows the same totals")
    check("time-ipad.json.enc" in HUB and hub_clean(), "iPad: writes only its own encrypted time file to the hub")
    ipad.evaluate("""(() => { const S = DASH.app.state; S.entries.push({ id: 'i-ipad-1', taskId: 'EX-2', eventId: null, date: '2026-10-19', minutes: 35, audience: 'Integrator/partner', subject: 'Training/education', account: 'Account D', source: 'manual', confirmed: true }); return DASH.app.commit(); })()""")
    ipad.evaluate("DASH.app.flush()"); check(hub_clean(), "iPad edit: hub still holds nothing readable")
    pc.evaluate("DASH.app.syncNow()"); pc.evaluate("DASH.app.syncNow()")
    check(pc.evaluate("DASH.app.state.entries.some(e => e.id === 'i-ipad-1' && e.minutes === 35)") and (data / "time-ipad.json.enc").exists(), "sync: iPad edit reaches the PC through GitHub and lands in the local backup folder (encrypted)")
    pc.evaluate("(() => { const S = DASH.app.state; S.entries = S.entries.filter(e => e.id !== 'i-ipad-1'); return DASH.app.commit(); })()"); pc.evaluate("DASH.app.flush()")
    ipad.evaluate("DASH.app.syncNow()")
    check(ipad.evaluate("!DASH.app.state.entries.some(e => e.id === 'i-ipad-1')"), "sync: removal on the PC wins on the iPad (rules unchanged)")
    check(sorted(x for x in os.listdir(data) if not x.endswith(".crswap")) == sorted(HUB), "backup: the PC folder holds the same encrypted files as the hub")
    raw = ipad.evaluate(RAW)
    check(TOK["ipad"] not in raw and not any(s in raw for s in SECRETS) and "Owner/operator" not in raw, "iPad: no token or readable data in the browser's storage")
    # reload: reconnects with the remembered key and the encrypted token
    ipad.reload(); ready(ipad); check(ipad.evaluate("DASH.app.state.hubOnly === true") and ipad.evaluate(TOT) == pc.evaluate(TOT), "iPad reload: reconnects to GitHub by itself (remembered key, encrypted token)")
    # offline then back
    STATE["offline"] = True; ipad.evaluate("""(() => { const S = DASH.app.state; S.entries.push({ id: 'i-ipad-off', taskId: 'EX-2', eventId: null, date: '2026-10-19', minutes: 15, audience: 'Integrator/partner', subject: 'Training/education', account: 'Account D', source: 'manual', confirmed: true }); return DASH.app.commit(); })()""")
    ipad.evaluate("DASH.app.flush()"); ipad.evaluate("DASH.app.syncNow()")
    check("⚠" in ipad.inner_text("#sync") and "GitHub" in ipad.get_attribute("#sync", "title"), "offline: the sync chip warns (GitHub unreachable), the edit stays in the encrypted local cache")
    STATE["offline"] = False; ipad.evaluate("DASH.app.syncNow()"); ipad.evaluate("DASH.app.flush()"); pc.evaluate("DASH.app.syncNow()"); pc.evaluate("DASH.app.syncNow()")
    check(pc.evaluate("DASH.app.state.entries.some(e => e.id === 'i-ipad-off')"), "back online: the queued edit is sent and reaches the PC")
    check(all(a.startswith("Bearer github_pat_") for _, u, a in CALLS if not a == "") and not any("github_pat_" in u for _, u, _ in CALLS), "every API call uses the Authorization header; no token in any URL")
    # disconnect
    menu(ipad, "hub"); ipad.wait_for_selector("#hub-off"); ipad.click("#hub-off"); ipad.wait_for_function("() => !document.querySelector('#hubdlg')")
    check("hubCfg" not in json.loads(ipad.evaluate(RAW)) or json.loads(ipad.evaluate(RAW)).get("hubCfg") is None, "disconnect: this device forgets its token")
    # frame-busting
    (app / "outer.html").write_text('<!doctype html><title>outer</title><iframe src="index.html' + Q + 'framed" width="800" height="600"></iframe>')
    ctx = b.new_context(); fr = ctx.new_page(); fr.goto((app / "outer.html").as_uri())
    fr.wait_for_url(re.compile(r".*index\.html.*"), timeout=10000)
    check("index.html" in fr.url, "frame-busting: inside a frame the app takes over the top window")
    (app / "outer2.html").write_text('<!doctype html><title>outer</title><iframe sandbox="allow-scripts allow-same-origin" src="index.html' + Q + 'framed" width="800" height="600"></iframe>')
    ctx2 = b.new_context(); f2 = ctx2.new_page(); f2.goto((app / "outer2.html").as_uri()); f2.wait_for_timeout(2000); frame = f2.frames[1]
    check("outer2.html" in f2.url, "frame-busting: a sandboxed frame can't navigate the top window (outer page unchanged)")
    check(frame.evaluate("document.documentElement.style.display") == "none" and frame.evaluate("!(window.DASH && DASH.app)"), "frame-busting: when it can't take over, it stays hidden and the app doesn't start")
    csp = (app / "index.html").read_text().split('Content-Security-Policy" content="')[1].split('"')[0]
    check("connect-src 'self' https://api.github.com;" in csp and csp.count("https://") == 1 and "script-src 'self';" in csp, "CSP: connect-src adds only https://api.github.com; scripts still self only")
    sw = (app / "sw.js").read_text()
    check("u.origin !== self.location.origin) return" in sw and '"js/hub.js"' in sw and '"js/frame.js"' in sw, "service worker: off-site (API) requests are never handled or cached; hub/frame scripts in the shell")
    m = json.loads((app / "manifest.webmanifest").read_text()); check(m["name"] == "Activity Dashboard" and m["short_name"] == "Activity Dashboard", "manifest: installed name is Activity Dashboard")
    b.close()
check(not errors, "no page errors or CSP violations" + (f": {errors[:3]}" if errors else ""))
print("T23 PASS" if ok else "T23 FAIL"); sys.exit(0 if ok else 1)
