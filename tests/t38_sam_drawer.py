"""T38 (00.11.002): separate encrypted notebook token and the SAM bullets side drawer.  Fake notebook repo (tests/nbharness.py),
placeholder data only.  Token: stored only as a vault envelope, never plaintext at rest, in the DOM, console or exports; Lock clears it
and the cached bullets; classic tokens refused.  Drawer: Approved (Copy on), Draft (Copy off), month rule (before the 20th = last
month), not found, no access (no token: zero GitHub requests; 403), rate limited (reset time in CT), offline, one GET per month then
memory, Links sources default unchanged, example mode makes no requests.  argv[1]: shots dir."""
import sys, pathlib, tempfile, json
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent)); import nbharness as NH
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else pathlib.Path(tempfile.mkdtemp(prefix="dash-t38-")); SHOTS.mkdir(parents=True, exist_ok=True)
ok = True; errors = []; logs = []
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
FIX = (NH.SRC / "tests/fixtures/example-sam-accounts-2026-10.md").read_text(); DRAFT = (NH.SRC / "tests/fixtures/example-sam-accounts-draft.md").read_text()
env = NH.Env(); env.put("reports/sam-activity/2026-10.md", FIX); env.put("reports/sam-activity/2026-09.md", DRAFT.replace("2026-10", "2026-09"))
Q = lambda d="2026-11-03", t="10:00": f"?now={d}T{t}:00-06:00&machine=desk1&view=dashboard"
gh = lambda: [c for c in env.calls if c["method"] != "OPTIONS"]
def drawer_state(pg): pg.wait_for_function("() => { const d = document.querySelector('#samdrawer'); return d && !d.querySelector('.sdskel'); }", timeout=30000)
with sync_playwright() as p:
    b = p.chromium.launch(); c = env.context(b); c.grant_permissions(["clipboard-read", "clipboard-write"])
    pg = env.page(c, Q(), errors, logs); NH.encrypt(pg); NH.sync(pg)
    # (d) no token: No access with all three fallbacks, zero requests
    pg.evaluate("DASH.app.nbOps.openSamDrawer()"); drawer_state(pg)
    txt = pg.inner_text("#samdrawer")
    check("No access" in txt and "Add notebook token" in txt and "Import report" in txt and not gh(), "(d) no token: No access state, Add token / Import report fallbacks, zero GitHub requests")
    check(pg.get_attribute("#samdrawer", "aria-label") == "SAM bullets" and pg.get_attribute("#samdrawer", "role") == "dialog", "drawer is a labelled dialog")
    pg.keyboard.press("Escape"); check(not pg.query_selector("#samdrawer"), "Esc closes the drawer")
    # token dialog
    NH.links(pg)
    pg.click('.mtop:has-text("File")'); pg.click('[data-act="notebook"]'); pg.wait_for_selector("#nbdlg")
    dl = pg.inner_text("#nbdlg"); check("Contents: Read and write" in dl and "90 days" in dl and "dashboard/inbox" in dl and NH.REPO in dl, "token dialog: steps, repo from Links, the dashboard/inbox branch")
    pg.fill("#nb-token", "ghp_" + "C" * 36); pg.click("#nb-ok"); pg.wait_for_function("() => document.querySelector('#nb-err').textContent", timeout=10000)
    check("classic" in pg.inner_text("#nb-err") and pg.input_value("#nb-token") == "", "classic ghp_ token refused and the field cleared")
    pg.click("#nb-cancel")
    NH.token(pg); check(not pg.query_selector("#nbdlg"), "fine-grained token saved")
    cfg = pg.evaluate("(async () => JSON.stringify(await (async () => { const r = await new Promise(res => { const o = indexedDB.open('activity-dashboard'); o.onsuccess = () => { const q = o.result.transaction('kv').objectStore('kv').get('nbCfg'); q.onsuccess = () => res(q.result); }; }); return r; })()))()")
    check(json.loads(cfg)["tokenEnv"].find("dash-encrypted") >= 0, "nbCfg.tokenEnv is a dash-encrypted envelope")
    rest = NH.at_rest(pg); check(NH.NB_TOKEN not in rest, "the token is in no IndexedDB or localStorage value")
    exp = json.dumps(pg.evaluate("DASH.db.exportAll()")); check(NH.NB_TOKEN not in exp and "nbCfg" not in exp, "Export local data holds no notebook token or nbCfg")
    check(NH.NB_TOKEN not in pg.content(), "the token is not in the DOM")
    # (a) approved
    pg.evaluate("DASH.app.nbOps.openSamDrawer()"); drawer_state(pg)
    check(pg.inner_text("#sd-status") == "APPROVED" or pg.inner_text("#sd-status").lower() == "approved", "(a) Approved chip")
    check("October 2026" in pg.inner_text("#sd-month"), "(c) Nov 3 opens October (before the 20th = last month)")
    btns = pg.query_selector_all("[data-sdcopy]"); check(len(btns) == 3 and all(not x.is_disabled() for x in btns), "(a) two account Copy buttons and Copy all, enabled")
    pg.click('[data-sdcopy="all"]'); clip = pg.evaluate("navigator.clipboard.readText()")
    check(clip == "Example Account A\n- Oct 3: Placeholder design review.  Next step set.\n- Oct 14: Placeholder site walk.\n\nNorthwind Example\n- Oct 9: Placeholder training.  Follow-up booked.", "(a) Copy all = plain text, two spaces kept")
    pg.click('[data-sdcopy="1"]'); check(pg.evaluate("navigator.clipboard.readText()").startswith("Northwind Example\n- Oct 9"), "per-account Copy")
    check(pg.query_selector("#sd-gh") is not None and "2026-10.md" in pg.get_attribute("#sd-gh", "href") and "Loaded" in pg.inner_text("#sd-at") and "CT" in pg.inner_text("#sd-at"), "footer: Open on GitHub for the month and Loaded HH:MM CT")
    check(pg.is_disabled('[data-sd="next"]') is False, "next month allowed up to the current month")
    pg.screenshot(path=str(SHOTS / "sam-drawer-approved.png"))
    # (g) one GET per month, then memory
    n0 = len([x for x in gh() if "/contents/reports/" in x["url"]])
    pg.click('[data-sd="prev"]'); drawer_state(pg)
    check("draft" in pg.inner_text("#samdrawer").lower() and all(x.is_disabled() for x in pg.query_selector_all("[data-sdcopy]")), "(b) Draft chip, every Copy disabled")
    check(pg.get_attribute('[data-sdcopy="all"]', "title").startswith("Draft: copy turns on"), "(b) Draft tooltip")
    pg.screenshot(path=str(SHOTS / "sam-drawer-draft.png"))
    pg.click('[data-sd="next"]'); drawer_state(pg); pg.click('[data-sd="prev"]'); drawer_state(pg); pg.click('[data-sd="next"]'); drawer_state(pg)
    n1 = len([x for x in gh() if "/contents/reports/" in x["url"]]); check(n1 - n0 == 1, f"(g) one GET per month, second visits from memory ({n1 - n0})")
    pg.click('[data-sd="refresh"]'); drawer_state(pg); check(len([x for x in gh() if "/contents/reports/" in x["url"]]) == n1 + 1, "↻ re-fetches")
    pg.click('[data-sd="next"]'); drawer_state(pg); check("No bullets for November 2026 yet" in pg.inner_text("#samdrawer") and pg.is_disabled('[data-sd="next"]'), "not found state; next disabled past the current month")
    check(all(x["method"] == "GET" for x in gh()), "the drawer only ever GETs")
    check(all("ref=main" in x["url"] for x in gh() if "/contents/" in x["url"]), "bullets are read from the Links branch (main)")
    # (e) 403, (f) 429, offline
    env.forced["reports/sam-activity/2026-08.md"] = (403, 1); pg.click('[data-sd="prev"]'); pg.click('[data-sd="prev"]'); pg.click('[data-sd="prev"]'); drawer_state(pg)
    check("August 2026" in pg.inner_text("#sd-month") and "No access" in pg.inner_text("#samdrawer") and "Update notebook token" in pg.inner_text("#samdrawer"), "(e) 403 → No access with fallbacks")
    pg.screenshot(path=str(SHOTS / "sam-drawer-noaccess.png"))
    env.forced["reports/sam-activity/2026-07.md"] = (429, 1); pg.click('[data-sd="prev"]'); drawer_state(pg)
    check("limiting requests until 13:40 CT" in pg.inner_text("#samdrawer"), "(f) 429 → Rate limited until the reset time in CT (" + pg.inner_text("#sd-msg") + ")")
    env.offline = True; pg.click('[data-sd="prev"]'); drawer_state(pg); check("Offline" in pg.inner_text("#samdrawer") and "Import report" in pg.inner_text("#samdrawer"), "offline state with fallbacks"); env.offline = False
    # (h) Lock clears the token and the cache
    check(pg.evaluate("Object.keys(DASH.app.state.samCache).length") >= 2, "bullets cached in memory")
    pg.keyboard.press("Escape")
    pg.click('.mtop:has-text("File")'); pg.click('[data-act="encryption"]'); pg.click('[data-v="lock"]'); pg.wait_for_function("() => DASH.app.state.vault.locked && DASH.app.state.nb === null", timeout=30000)
    check(pg.evaluate("DASH.app.state.nb === null && Object.keys(DASH.app.state.samCache).length === 0"), "(h) Lock: notebook client and bullets cache cleared")
    n2 = len(gh()); pg.evaluate("DASH.app.nbOps.openSamDrawer()"); drawer_state(pg)
    check("Unlock" in pg.inner_text("#samdrawer") and len(gh()) == n2, "locked: No access (unlock), no request")
    pg.keyboard.press("Escape"); c.close()
    # (c) from the 20th: this month; (i) Links default sources
    c = env.context(b); pg = env.page(c, Q("2026-11-20"), errors, logs); NH.unlock(pg); NH.sync(pg)
    pg.evaluate("DASH.app.nbOps.openSamDrawer()"); drawer_state(pg); check("November 2026" in pg.inner_text("#sd-month"), "(c) Nov 20 opens November")
    check("crm/outbox/sam-report/2026-11/sources.md" in pg.inner_text("#samdrawer"), "(i) sources default crm/outbox/sam-report/{month}/sources.md")
    pg.keyboard.press("Escape"); pg.click('.mtop:has-text("File")'); pg.click('[data-act="links"]'); pg.wait_for_selector("#linksdlg")
    check(pg.input_value("#lk-src") == "crm/outbox/sam-report/{month}/sources.md", "(i) Links dialog keeps the sources default"); pg.click("#lk-cancel")
    NH.token(pg); check(pg.evaluate("DASH.app.state.nbState.k") == "ok", "a second browser adds its own token (one token per computer, never synced)")
    pg.click('.mtop:has-text("File")'); pg.click('[data-act="notebook"]'); pg.wait_for_selector("#nbdlg"); pg.click("#nb-off"); pg.wait_for_function("() => DASH.app.state.nb === null && !document.querySelector('#nbdlg')", timeout=30000)
    check(pg.evaluate("DASH.app.state.nb === null"), "Forget on this computer drops the client")
    c.close()
    # H1: a New York browser still shows CT times in the drawer
    cN = env.context(b, "America/New_York"); pn = env.page(cN, Q(), errors, logs); NH.unlock(pn); NH.sync(pn); NH.token(pn)
    env.forced["reports/sam-activity/2026-07.md"] = (429, 1); pn.evaluate("DASH.app.nbOps.openSamDrawer('2026-07')"); drawer_state(pn)
    check("limiting requests until 13:40 CT" in pn.inner_text("#samdrawer"), "H1: New York browser: reset time in CT (" + pn.inner_text("#sd-msg") + ")")
    pn.evaluate("DASH.app.nbOps.openSamDrawer('2026-10')"); drawer_state(pn)
    check(pn.inner_text("#sd-at") == "Loaded 10:00 CT", "H1: New York browser: Loaded time in CT (" + pn.inner_text("#sd-at") + ")")
    cN.close()
    # example mode: no requests
    env2 = NH.Env(); (env2.data / "inbox-snapshot.json").unlink(); c = env2.context(b); pg = env2.page(c, Q(), errors, logs)
    pg.evaluate("DASH.app.nbOps.openSamDrawer()"); drawer_state(pg)
    check("EXAMPLE" in pg.inner_text("#samdrawer") and "northwind example" in pg.inner_text("#samdrawer").lower() and not env2.calls, "example mode: placeholder bullets, no requests")
    c.close(); b.close()
check(not any(NH.NB_TOKEN in m for m in logs), "(j) the token never appears in the console")
check(not errors, f"no page errors {errors[:3]}")
print("T38 PASS" if ok else "T38 FAIL"); sys.exit(0 if ok else 1)
