"""Plan tests T12 (avatar), T13 (shell), T14 (name and version), T16 (theme). T15 is tests/check_no_real_data.py.
The plan's manifest/icon parts of T12/T14 don't apply: rev 5 dropped the PWA manifest (local-file app)."""
import pathlib, re, shutil, tempfile
from playwright.sync_api import sync_playwright
SRC = pathlib.Path(__file__).resolve().parents[1]; ok = True
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
def lum(rgb):
    def ch(c): c /= 255; return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb; return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
def rgb(s): return tuple(int(x) for x in re.findall(r"\d+", s)[:3])
def contrast(a, b): la, lb = sorted([lum(rgb(a)), lum(rgb(b))], reverse=True); return (la + 0.05) / (lb + 0.05)
Q = "?now=2026-10-19T08:00:00-05:00&machine=test"
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(offline=True, viewport={"width": 1440, "height": 900}); pg = ctx.new_page(); net = []
    pg.on("request", lambda r: not r.url.startswith("file:") and net.append(r.url))
    pg.goto((SRC / "index.html").as_uri() + Q); pg.wait_for_selector(".tile")
    # T12
    check(pg.evaluate("getComputedStyle(document.getElementById('avatar')).borderRadius") == "50%" and pg.evaluate("document.getElementById('avatar').naturalWidth") > 0, "T12 avatar renders, circular crop")
    check(not any("github" in u for u in net) and not net, "T12 no network request (no github.com)")
    tmp = pathlib.Path(tempfile.mkdtemp()) / "d"; shutil.copytree(SRC, tmp, ignore=shutil.ignore_patterns("tests")); (tmp / "assets/avatar.png").unlink()
    p2 = ctx.new_page(); p2.goto((tmp / "index.html").as_uri() + Q); p2.wait_for_selector(".tile"); p2.wait_for_timeout(200)
    check(p2.is_visible("#avatar-fb") and p2.inner_text("#avatar-fb").strip() == "AD" and not p2.is_visible("#avatar"), "T12 missing avatar -> 'AD' initials"); p2.close(); shutil.rmtree(tmp.parent)
    # T13
    pg.focus(".mtop >> text=File"); pg.keyboard.press("Enter")
    check(pg.is_visible("[data-act=open]") and pg.evaluate("document.activeElement.dataset.act") == "open", "T13 keyboard: Enter opens File, focus on first item")
    pg.keyboard.press("Escape"); check(not pg.is_visible("[data-act=open]"), "T13 Esc closes the menu")
    for act, sec in (("hQuick", "help-quick"), ("hHelp", "help-help"), ("hHow", "help-howdoi"), ("hFaq", "help-faq"), ("hRev", "help-rev")):
        pg.click(".mtop >> text=Help"); pg.click(f"[data-act={act}]")
        top = pg.evaluate(f"(()=>{{const s=document.getElementById('{sec}').getBoundingClientRect(),b=document.querySelector('.helpbody').getBoundingClientRect();return s.top-b.top}})()")
        check(pg.is_visible("#help") and abs(top) < 40, f"T13 Help → {sec} opens at that section"); pg.keyboard.press("Escape")
    rev = pg.inner_text("#rev"); check(rev.startswith("Rev 00.02.000_"), f"T13/T14 Revision cell '{rev}'")
    check("00.02.000_261019" in pg.inner_text("#help-rev") and "00.01.000_261019" in pg.inner_text("#help-rev"), "T13 Revision log lists the running revision")
    # T14
    check(pg.title() == "Activity Dashboard" and pg.inner_text(".appname") == "Activity Dashboard", "T14 exact name in title and header")
    texts = "\n".join(f.read_text(errors="ignore") for f in SRC.rglob("*") if f.is_file() and f.suffix in {".html", ".js", ".md", ".css", ".py"} and f.name != "t12_t16.py")
    # Rule: "Hide the Proposed tray in v1"
    body = pg.evaluate("document.body.innerText")
    check(not re.search(r"proposed|confirm\?", body, re.I) and not pg.query_selector("[id*=propos i],[class*=propos i],[data-tray]"), "Proposed tray not visible anywhere in v1")
    # T16
    check(pg.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(11, 14, 18)", "T16 screen background = #0b0e12 token")
    for sel in (".cap", ".tile .d.neu", ".faint", ".row .line"):
        el = pg.query_selector(sel); fg = el.evaluate("e=>getComputedStyle(e).color")
        bg = el.evaluate("e=>{let n=e;while(n){const c=getComputedStyle(n).backgroundColor;if(c&&c!=='rgba(0, 0, 0, 0)')return c;n=n.parentElement}return 'rgb(11,14,18)'}")
        c = contrast(fg, bg); check(c >= 4.5, f"T16 contrast {sel} {c:.2f}:1 ≥ 4.5")
    pg.click("body"); pg.keyboard.press("Tab"); pg.keyboard.press("Tab")
    st = pg.evaluate("(()=>{const s=getComputedStyle(document.activeElement);return [document.activeElement.tagName,s.outlineStyle,s.outlineWidth]})()")
    check(st[1] != "none" and st[2] != "0px", f"T16 visible focus outline on keyboard focus {st}")
    b.close()
print("T12-T16", "PASS" if ok else "FAIL"); raise SystemExit(0 if ok else 1)
