"""T32 (00.09.001): FileSystemFileHandle.move() onto an existing file replaces it in Chromium (the engine Edge uses).
Runs in the origin-private file system over http://127.0.0.1 (a real local folder picker can't be automated). The app's
writeVerified() relies on this; if move() is missing or throws, it falls back to a checked in-place write (covered in T31)."""
import http.server, threading, functools, pathlib, sys
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Q, directory=str(SRC))
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); pg.goto(f"http://127.0.0.1:{srv.server_address[1]}/README.md")
    r = pg.evaluate("""(async () => { const d = await navigator.storage.getDirectory();
      const w = async (n, t) => { const h = await d.getFileHandle(n, { create: true }); const x = await h.createWritable(); await x.write(t); await x.close(); return h; };
      await w('inbox-snapshot.json.enc', 'OLD-CIPHERTEXT'); const t = await w('inbox-snapshot.json.enc.tmp', 'NEW-CIPHERTEXT');
      let err = null; try { await t.move('inbox-snapshot.json.enc'); } catch (e) { err = e.name; }
      const names = []; for await (const [n] of d.entries()) names.push(n);
      const txt = await (await (await d.getFileHandle('inbox-snapshot.json.enc')).getFile()).text();
      return { hasMove: typeof t.move, err, names: names.sort(), txt }; })()""")
    check(r["hasMove"] == "function", f"Chromium {b.version}: FileSystemFileHandle.move exists")
    check(r["err"] is None and r["txt"] == "NEW-CIPHERTEXT", f"move() onto an existing .enc replaces it ({r})")
    check(r["names"] == ["inbox-snapshot.json.enc"], f"no .tmp left after the move ({r['names']})")
    b.close()
srv.shutdown(); print("T32 " + ("OK" if ok else "FAIL")); sys.exit(0 if ok else 1)
