"""T22 (00.03): installable app. Serves the build over http://127.0.0.1 (a secure context, like GitHub Pages' https)
and checks: manifest fields + icon sizes, service worker controls the page, Chromium reports no installability errors,
the app opens offline from the cache, nothing from Data/ or config.local.js is ever cached, and file:// still works
without a service worker. Fictional example data only."""
import pathlib, shutil, tempfile, json, threading, functools, sys, http.server
from PIL import Image
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
tmp = pathlib.Path(tempfile.mkdtemp()); app = tmp / "site"; shutil.copytree(SRC, app, ignore=shutil.ignore_patterns("tests", ".git"))
(app / "Data").mkdir(); (app / "Data/probe.js").write_text("window.PROBE = 1;\n")
m = json.loads((app / "manifest.webmanifest").read_text())
check(m["display"] == "standalone" and m["start_url"] and m["name"] and m["background_color"] == "#0b0e12" and m["theme_color"] == "#0b0e12", "manifest: name, standalone, start_url, dark theme colours")
sizes = {(i["sizes"], i.get("purpose", "any")) for i in m["icons"]}
check(("192x192", "any") in sizes and ("512x512", "any") in sizes and ("512x512", "maskable") in sizes, "manifest: 192, 512 and maskable 512 icons")
for i in m["icons"]:
    w, h = Image.open(app / i["src"]).size; check(f"{w}x{h}" == i["sizes"], f"icon {i['src']} is {i['sizes']}")
sw = (app / "sw.js").read_text(); rev = (app / "js/app.js").read_text().split('const REV = "')[1].split('"')[0]
check(f'REV = "{rev}"' in sw, f"service worker cache is versioned with the app revision ({rev})")
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Q, directory=str(app))); threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{srv.server_address[1]}/index.html?now=2026-10-19T08:00:00-05:00&machine=mac"
errors = []
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1280, "height": 860}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    csp = []; pg.on("console", lambda msg: csp.append("http: " + msg.text) if "Content Security Policy" in msg.text else None)
    pg.goto(url); pg.wait_for_selector(".tile"); pg.evaluate("navigator.serviceWorker.ready.then(() => true)")
    pg.reload(); pg.wait_for_selector(".tile")
    check(pg.evaluate("!!navigator.serviceWorker.controller"), "service worker controls the page")
    cdp = ctx.new_cdp_session(pg); ie = cdp.send("Page.getInstallabilityErrors")["installabilityErrors"]
    check(ie == [], f"Chromium installability errors: {ie or 'none'}")
    mf = cdp.send("Page.getAppManifest"); check(not mf.get("errors"), f"manifest parses without errors ({mf.get('errors')})")
    pg.evaluate("fetch('Data/probe.js?t=1').then(r => r.text())"); pg.evaluate("fetch('config.local.js').catch(() => 0)")
    keys = pg.evaluate("caches.keys().then(ks => Promise.all(ks.map(k => caches.open(k).then(c => c.keys()).then(rs => rs.map(r => r.url))))).then(a => a.flat())")
    check(any(k.endswith("/js/app.js") for k in keys) and any(k.endswith("/index.html") for k in keys), f"app shell cached ({len(keys)} entries)")
    check(not any("/Data/" in k or "config.local" in k or ".enc" in k or "keyring" in k for k in keys), "nothing from Data/, config.local.js, keyring or .enc is cached")
    ctx.set_offline(True); pg.reload(); pg.wait_for_selector(".tile", timeout=10000)
    check(pg.evaluate("DASH.app.REV") == rev and pg.query_selector(".tile") is not None, "offline: the app opens from the cache")
    pol = pg.evaluate("document.querySelector('meta[http-equiv=Content-Security-Policy]').content")
    check(all(x in pol for x in ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'none'", "connect-src 'self'"]) and "unsafe-eval" not in pol and "script-src 'self' 'unsafe-inline'" not in pol, "CSP meta present and strict for scripts")
    check(pg.evaluate("fetch('https://example.com/x').then(() => 'sent').catch(() => 'blocked')") == "blocked", "CSP: connections to other sites are blocked")
    check(pg.evaluate("new Promise(r => { const s = document.createElement('script'); s.textContent = 'window.__inl = 1'; document.head.appendChild(s); setTimeout(() => r(window.__inl === undefined ? 'blocked' : 'ran'), 200); })") == "blocked", "CSP: injected inline script is blocked")
    csp.clear()   # the two refusals above were provoked on purpose
    check(pg.evaluate("fetch('Data/probe.js').then(() => 'net').catch(() => 'blocked')") == "blocked", "offline: Data/ is not served from the cache")
    ctx.set_offline(False)
    c2 = b.new_context(); p2 = c2.new_page(); p2.on("pageerror", lambda e: errors.append("file: " + str(e))); p2.on("console", lambda msg: csp.append("file: " + msg.text) if "Content Security Policy" in msg.text else None)
    p2.goto((app / "index.html").as_uri() + "?now=2026-10-19T08:00:00-05:00&machine=mac"); p2.wait_for_selector(".tile")
    check(p2.evaluate("!navigator.serviceWorker || !navigator.serviceWorker.controller"), "file:// still works (no service worker there)")
    p2.click('.mtop:has-text("Help")'); p2.click('[data-act="hHelp"]'); p2.wait_for_timeout(300)
    check(p2.evaluate("DASH.app.state.snap && document.querySelectorAll('.tile').length > 3"), "file://: example snapshot script loaded and rendered under the CSP")
    check(not [c for c in csp if "violat" in c.lower() or "refused" in c.lower()], f"no CSP violations over http or file:// ({[c[:100] for c in csp if 'refused' in c.lower()][:2]})")
    b.close()
srv.shutdown()
check(not errors, "no page errors" + (f": {errors[:3]}" if errors else ""))
print("T22 PASS" if ok else "T22 FAIL"); sys.exit(0 if ok else 1)
