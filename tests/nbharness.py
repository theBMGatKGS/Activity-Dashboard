"""00.11.002 test harness for T38-T40: a copy of the app, an encrypted Data folder stand-in (as T21/T37), and a fake private
notebook repo on api.github.com (page.route; no network, no real repo, no real token).  Placeholder data only."""
import pathlib, shutil, tempfile, json, os, time, base64, hashlib, re
SRC = pathlib.Path(__file__).resolve().parents[1]
PASS = "correct horse battery 10000"
NB_TOKEN = "github_pat_" + "N" * 50
REPO_URL = "https://github.com/example-owner/example-notebook"; REPO = "example-owner/example-notebook"
FS_JS = (SRC / "tests/t21_vault.py").read_text().split('FS_JS = """', 1)[1].split('"""', 1)[0]
def gsha(b): return hashlib.sha1(b"blob %d\0" % len(b) + b).hexdigest()
class Env:
    def __init__(self, snap_at="2026-11-03T07:30:00-06:00"):
        self.tmp = pathlib.Path(tempfile.mkdtemp()); self.app = self.tmp / "Dashboard"
        shutil.copytree(SRC, self.app, ignore=shutil.ignore_patterns("tests", ".git"))
        snap = json.loads((self.app / "examples/example-snapshot.json").read_text()); snap.pop("example"); snap["generated_at"] = snap_at; self.snap = snap
        self.data = self.tmp / "Data"; self.data.mkdir(); (self.data / "inbox-snapshot.json").write_text(json.dumps(snap))
        self.fail_names = set()
        # fake notebook: branch -> {path: bytes}
        self.br = {"main": {}}; self.commits = 0; self.calls = []; self.forced = {}; self.conflict = {}; self.rate = {"remaining": 4999, "reset": 1793734800}; self.offline = False
    # ---- folder stand-in ----
    def fs(self, op, name, text):
        d = self.data
        if op == "list": return sorted(x for x in os.listdir(d) if not x.endswith(".crswap"))
        p = d / name
        if op == "read":
            if not p.exists(): return None
            st = p.stat(); return {"m": int(st.st_mtime_ns // 1_000_000), "size": st.st_size, "text": p.read_text()}
        if op == "write" and any(name.startswith(f) for f in self.fail_names): raise Exception("NoModificationAllowedError: file locked (test)")
        if op == "write": t = d / f"{name}.{os.getpid()}-{time.time_ns()}.crswap"; t.write_text(text); os.replace(t, p); return True
        if op == "remove": p.unlink(missing_ok=True); return True
    def folder_text(self): return "".join((self.data / n).read_text(errors="ignore") for n in os.listdir(self.data) if (self.data / n).is_file())
    # ---- fake notebook ----
    def head(self, b): return "c%s-%d" % (b.replace("/", "_"), self.commits)
    def put(self, path, text, branch="main"): self.br.setdefault(branch, {})[path] = text.encode(); self.commits += 1
    def get(self, path, branch="main"): b = self.br.get(branch, {}).get(path); return b.decode() if b is not None else None
    def handle(self, route):
        r = route.request; url = r.url; self.calls.append({"method": r.method, "url": url, "auth": r.headers.get("authorization", ""), "body": r.post_data})
        H = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-GitHub-Api-Version, Accept", "Access-Control-Allow-Methods": "GET, PUT, POST",
             "Access-Control-Expose-Headers": "x-ratelimit-remaining, x-ratelimit-reset", "Content-Type": "application/json", "x-ratelimit-remaining": str(self.rate["remaining"]), "x-ratelimit-reset": str(self.rate["reset"])}
        def reply(s, body=None): route.fulfill(status=s, headers=H, body=json.dumps(body) if body is not None else "")
        if r.method == "OPTIONS": return reply(204)
        if self.offline: return route.abort("internetdisconnected")
        if r.headers.get("authorization") != "Bearer " + NB_TOKEN: return reply(401, {"message": "Bad credentials"})
        m = re.match(r"https://api\.github\.com/repos/([^/]+/[^/?]+)(/[^?]*)?(\?.*)?$", url)
        if not m or m.group(1) != REPO: return reply(404, {"message": "Not Found"})
        rest = m.group(2) or ""; q = dict(x.split("=", 1) for x in (m.group(3) or "?")[1:].split("&") if "=" in x)
        from urllib.parse import unquote
        if rest.startswith("/git/ref/heads/") and r.method == "GET":
            b = unquote(rest[15:]); return reply(200, {"object": {"sha": self.head(b)}}) if b in self.br else reply(404, {"message": "Not Found"})
        if rest == "/git/refs" and r.method == "POST":
            body = json.loads(r.post_data); b = body["ref"].replace("refs/heads/", "")
            if b in self.br: return reply(422, {"message": "Reference already exists"})
            src = [k for k in self.br if self.head(k) == body["sha"]]
            if not src: return reply(422, {"message": "Object does not exist"})
            self.br[b] = dict(self.br[src[0]]); self.commits += 1; return reply(201, {"ref": body["ref"]})
        if not rest.startswith("/contents/"): return reply(405, {"message": "nope"})
        path = "/".join(unquote(x) for x in rest[10:].split("/"))
        if path in self.forced:
            code, n = self.forced[path]
            if n: self.forced[path] = (code, n - 1) if n > 1 else None
            if self.forced.get(path) is None: self.forced.pop(path, None)
            return reply(code, {"message": "API rate limit exceeded" if code == 429 else "err %d" % code})
        if r.method == "GET":
            b = unquote(q.get("ref", "main"))
            if b not in self.br: return reply(404, {"message": "No commit found for the ref " + b})
            f = self.br[b].get(path)
            if f is None: return reply(404, {"message": "Not Found"})
            return reply(200, {"type": "file", "path": path, "sha": gsha(f), "encoding": "base64", "content": base64.b64encode(f).decode()})
        if r.method == "PUT":
            body = json.loads(r.post_data); b = body.get("branch", "main")
            if b not in self.br: return reply(404, {"message": "Branch not found"})
            f = self.br[b].get(path)
            if path in self.conflict and f is not None: self.br[b][path] = f + self.conflict.pop(path).encode(); self.commits += 1; return reply(409, {"message": "conflict"})
            if (f is not None and body.get("sha") != gsha(f)) or (f is None and body.get("sha")): return reply(409, {"message": "sha mismatch"})
            self.br[b][path] = base64.b64decode(body["content"]); self.commits += 1
            return reply(201 if f is None else 200, {"content": {"path": path, "sha": gsha(self.br[b][path])}, "commit": {"html_url": "https://github.com/%s/commit/k%d" % (REPO, self.commits)}})
        return reply(405, {"message": "nope"})
    def puts(self): return [c for c in self.calls if c["method"] in ("PUT", "POST", "DELETE", "PATCH")]
    # ---- browser ----
    def context(self, b):
        c = b.new_context(viewport={"width": 1440, "height": 900}); c.expose_function("__fs", self.fs); c.add_init_script(FS_JS)
        c.route("https://api.github.com/**", self.handle); return c
    def page(self, c, q, errors, logs=None):
        pg = c.new_page(); pg.on("pageerror", lambda e: errors.append(str(e))); pg.on("dialog", lambda d: d.accept())
        if logs is not None: pg.on("console", lambda m: logs.append(m.text))
        pg.goto((self.app / "index.html").as_uri() + q); pg.wait_for_function("() => window.DASH && DASH.app && (DASH.app.state.snap || document.querySelector('#vaultunlock'))", timeout=60000); return pg
def sync(pg): pg.evaluate("DASH.app.syncNow()"); pg.evaluate("DASH.app.flush()")
def encrypt(pg):
    pg.click('.mtop:has-text("File")'); pg.click('[data-act="encryption"]'); pg.wait_for_selector("#vaultsetup"); pg.fill("#vp1", PASS); pg.fill("#vp2", PASS); pg.click("#vs-ok")
    pg.wait_for_selector("#rk-value", timeout=60000); pg.check("#rk-done"); pg.click("#rk-ok"); pg.wait_for_function("() => document.querySelector('#toast').textContent.startsWith('Data folder encrypted')", timeout=60000)
def unlock(pg):
    pg.wait_for_function("() => document.querySelector('#vaultunlock') || (DASH.app && DASH.app.state.vault && DASH.app.state.vault.key)", timeout=60000)
    if pg.query_selector("#vaultunlock"): pg.fill("#vault-pass", PASS); pg.click("#vault-ok")
    pg.wait_for_function("() => DASH.app.state.vault.key", timeout=60000)
def links(pg, repo=REPO_URL):
    pg.click('.mtop:has-text("File")'); pg.click('[data-act="links"]'); pg.wait_for_selector("#linksdlg"); pg.fill("#lk-repo", repo); pg.fill("#lk-vault", "Example Vault")
    pg.click("#lk-save"); pg.wait_for_selector("#linksdlg", state="detached", timeout=60000); pg.evaluate("DASH.app.flush()")
def token(pg, tok=NB_TOKEN):
    pg.click('.mtop:has-text("File")'); pg.click('[data-act="notebook"]'); pg.wait_for_selector("#nbdlg"); pg.fill("#nb-token", tok); pg.click("#nb-ok")
    pg.wait_for_function("() => !document.querySelector('#nbdlg') || document.querySelector('#nb-err').textContent", timeout=30000)
RAW_IDB = """new Promise(res => { const r = indexedDB.open('activity-dashboard'); r.onsuccess = () => { const out = {}, t = r.result.transaction('kv'), c = t.objectStore('kv').openCursor();
  c.onsuccess = () => { const x = c.result; if (x) { out[x.key] = x.value; x.continue(); } else res(JSON.stringify(out)); }; }; })"""
def at_rest(pg): return pg.evaluate(RAW_IDB) + json.dumps(pg.evaluate("Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]))"))
