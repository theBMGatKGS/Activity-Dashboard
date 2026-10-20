"""T19: tools/make_log_js.py keeps only '- [log]' lines, drops '@' persons, never modifies the .md, refuses unsafe outputs."""
import hashlib, os, pathlib, shutil, subprocess, sys, tempfile, json, re
HERE = pathlib.Path(__file__).resolve().parent; TOOL = HERE.parent / "tools" / "make_log_js.py"; ok = True
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
tmp = pathlib.Path(tempfile.mkdtemp()); md = tmp / "notebook-log.md"; shutil.copy(HERE / "fixtures/example-notebook-log.md", md)
os.utime(md, (1700000000, 1700000000)); before = (hashlib.sha256(md.read_bytes()).hexdigest(), md.stat().st_mtime, md.stat().st_size)
out = tmp / "Data" / "notebook-log.js"
r = subprocess.run([sys.executable, str(TOOL), str(md), str(out)], capture_output=True, text=True)
check(r.returncode == 0, f"runs ({r.stdout.strip() or r.stderr.strip()})")
after = (hashlib.sha256(md.read_bytes()).hexdigest(), md.stat().st_mtime, md.stat().st_size)
check(before == after, "notebook-log.md unchanged (hash, mtime, size)")
js = out.read_text(); m = re.match(r"/\*.*?\*/\nwindow\.DASH_NOTEBOOK_LOG = ([\s\S]*);\n$", js)
check(bool(m), "output is window.DASH_NOTEBOOK_LOG = {...};")
data = json.loads(m.group(1)); lines = data["lines"]
check(len(lines) == 9 and all(l.startswith("- [log]") for l in lines), f"only '- [log]' lines kept ({len(lines)})")
check(not any("@" in l for l in lines), "'@' person and note lines dropped"); check("dropped" in r.stdout, "drop reported")
check(not any("Met with the team" in l or "[ ]" in l for l in lines), "other lines removed")
check(not list(out.parent.glob("*.tmp")), "no temp files left (atomic write)")
r2 = subprocess.run([sys.executable, str(TOOL), str(md), str(md)], capture_output=True, text=True)
check(r2.returncode != 0 and hashlib.sha256(md.read_bytes()).hexdigest() == before[0], "refuses to write over the .md")
r3 = subprocess.run([sys.executable, str(TOOL), str(md), str(tmp / "x.md")], capture_output=True, text=True)
check(r3.returncode != 0 and not (tmp / "x.md").exists(), "refuses non-.js output")
shutil.rmtree(tmp); print("T19", "PASS" if ok else "FAIL"); raise SystemExit(0 if ok else 1)
