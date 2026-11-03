"""T39 (00.11.002): notebook write-back Outbox (option 1, daily inbox file).  Brent's answers: 1C both kinds (typed notes checked,
automatic lines unchecked), 2B writes only to the dashboard/inbox branch (never main), 3A unsent notes kept until sent or discarded.
Fake notebook repo (tests/nbharness.py), placeholder data only.  Checks: queue from Daily Focus Done and the task editor; send the
checked ones only; every PUT is inbox/dashboard/2026-11-03.md on dashboard/inbox; the branch is created once from main; existing
bytes kept; 409 re-read keeps the other computer's line; 5xx retries at 5 s then 15 s (fake clock: the retry is fired by the test)
and lands once; a reload during a retry restores the note from the pending envelope and sends it once; 403 → read-only, no retries;
no token → token-missing banner; commit link; no plaintext note text at rest."""
import sys, pathlib, json
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent)); import nbharness as NH
ok = True; errors = []; logs = []
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
DAY = "inbox/dashboard/2026-11-03.md"; BR = "dashboard/inbox"
env = NH.Env(); env.put("Home.md", "# Home (placeholder)\n")
Q = "?now=2026-11-03T10:00:00-06:00&machine=desk1&view=dashboard"
OB = lambda pg: pg.evaluate("JSON.parse(JSON.stringify(DASH.app.state.outbox))")
def send_ui(pg):
    pg.evaluate("DASH.app.nbOps.openOutbox()"); pg.wait_for_selector("#ob-send"); pg.click("#ob-send")
    pg.evaluate("DASH.app.nbOps.sendOutbox([])"); pg.evaluate("DASH.app.flush()")   # resolves once the send in flight settles
def close(pg):
    if pg.query_selector("#samdrawer"): pg.keyboard.press("Escape")
with sync_playwright() as p:
    b = p.chromium.launch(); c = env.context(b)
    pg = env.page(c, Q, errors, logs); NH.encrypt(pg); NH.sync(pg); NH.links(pg)
    # (a) Daily Focus Done → automatic line (unchecked); the undo bar's Note… → typed note (checked)
    tid = pg.evaluate("DASH.app.state.snap.items.find(i => !i.done && i.kind !== 'waiting' || true).id")
    pg.evaluate(f"DASH.app.nbOps.focusDone({json.dumps(tid)})"); pg.wait_for_selector("#undo-note"); pg.click("#undo-note"); pg.wait_for_selector("#nbnote-text")
    pg.fill("#nbnote-text", "Placeholder follow-up booked.  Next step set."); pg.click("#nbnote-ok"); pg.evaluate("DASH.app.flush()")
    o = OB(pg); check(len(o["notes"]) == 2 and [n["checked"] for n in o["notes"]] == [False, True] and o["notes"][0]["auto"], "(a) 1C: automatic line unchecked, typed note checked")
    check("Outbox · 2" in pg.inner_text("#outboxchip"), "(a) Outbox chip counts 2")
    # (i) no token → token-missing banner, Send disabled
    pg.evaluate("DASH.app.nbOps.openOutbox()"); pg.wait_for_selector("#ob-ro")
    check("No notebook token" in pg.inner_text("#ob-ro") and "Add notebook token" in pg.inner_text("#ob-ro") and pg.is_disabled("#ob-send"), "(i) no token: token-missing banner, Send disabled")
    check(BR in pg.inner_text("#samdrawer") and DAY in pg.inner_text("#ob-target"), "target day file and branch shown")
    check("Placeholder follow-up booked.  Next step set." in pg.inner_text("#ob-preview") and "done" not in pg.inner_text("#ob-preview").split("·")[-1][:5], "preview shows only checked notes")
    close(pg); NH.token(pg)
    # (b) send 1 of 2
    send_ui(pg)
    f = env.get(DAY, BR); check(f is not None and f.startswith("# Dashboard inbox 2026-11-03\n\n- ") and "Placeholder follow-up booked.  Next step set." in f and f.count("<!-- dash:") == 1, "(b) one note appended to a new day file")
    check(env.get(DAY, "main") is None and env.get("Home.md", BR) == "# Home (placeholder)\n", "2B: nothing written to main; the branch was made from main")
    o = OB(pg); check(len(o["notes"]) == 1 and o["notes"][0]["auto"] and not o["notes"][0]["checked"], "(b) the unchecked automatic line stays (3A)")
    # (j) commit link
    href = pg.get_attribute("#ob-commit", "href"); check(href and href.startswith("https://github.com/" + NH.REPO + "/commit/k"), "(j) Sent · View commit link from the commit")
    close(pg)
    # (d) existing bytes kept; (e) 409 once keeps the other computer's line
    before = env.get(DAY, BR)
    pg.evaluate("DASH.app.nbOps.queueNote({kind: 'project', ref: 'Example plan › Example task', text: 'Placeholder update two.', auto: false})")
    env.conflict[DAY] = "- 10:01 CT · Note · from another computer  <!-- dash:n-other1 -->\n"
    send_ui(pg); after = env.get(DAY, BR)
    check(after.startswith(before), "(d) existing file content is a byte-prefix of the result")
    check(after.endswith("<!-- dash:n-other1 -->\n" + after.split("<!-- dash:n-other1 -->\n")[1]) and "Placeholder update two." in after.split("n-other1")[1], "(e) 409 → re-read; the other computer's line kept, ours after it")
    close(pg)
    # (f) 500 twice → retry at 5 s then 15 s, lands once
    pg.evaluate("DASH.app.state.retryLog.length = 0")
    pg.evaluate("DASH.app.nbOps.queueNote({kind: 'todo', ref: 'Example retry', text: 'Placeholder retry note.', auto: false})")
    env.forced[DAY] = (500, 2); send_ui(pg)
    check(pg.evaluate("DASH.app.state.outbox.sending.length") == 1 and pg.evaluate("DASH.app.state.retryLog") == [5], "(f) a 5xx keeps the note as sending and schedules a retry at 5 s")
    check(pg.evaluate("!!localStorage.getItem('dash-pending-v1')"), "(f) the owed send is parked in the encrypted pending envelope")
    pg.evaluate("DASH.app.nbOps.runRetry()"); pg.wait_for_timeout(300); check(pg.evaluate("DASH.app.state.retryLog") == [5, 15], "(f) second failure → next retry at 15 s")
    pg.evaluate("DASH.app.nbOps.runRetry()"); pg.wait_for_timeout(500)
    check(env.get(DAY, BR).count("Placeholder retry note.") == 1 and pg.evaluate("DASH.app.state.outbox.sending.length") == 0, "(f) the retry lands once")
    check(pg.evaluate("localStorage.getItem('dash-pending-v1')") is None, "(f) the queue clears after the send")
    # (g) reload during a retry: restored from the pending envelope and sent once
    pg.evaluate("DASH.app.nbOps.queueNote({kind: 'todo', ref: 'Example reload', text: 'Placeholder reload note.', auto: false})")
    env.forced[DAY] = (503, 1); send_ui(pg); check(pg.evaluate("DASH.app.state.outbox.sending.length") == 1, "(g) send owed before the reload")
    pg.reload(); pg.wait_for_function("() => window.DASH && DASH.app && (DASH.app.state.snap || document.querySelector('#vaultunlock'))", timeout=60000); NH.unlock(pg)
    pg.wait_for_function("() => DASH.app.state.outbox.sending && DASH.app.state.outbox.sending.length === 0 && DASH.app.state.outbox.sent.some(x => x.text.includes('Placeholder reload note.'))", timeout=30000)
    check(env.get(DAY, BR).count("Placeholder reload note.") == 1, "(g) after the reload the note is sent once")
    check(any(n["auto"] for n in OB(pg)["notes"]), "3A: the unsent automatic line is still there after the reload")
    # (h) 403 → read-only, no retries
    pg.evaluate("DASH.app.state.retryLog.length = 0")
    pg.evaluate("DASH.app.nbOps.queueNote({kind: 'todo', ref: 'Example denied', text: 'Placeholder denied note.', auto: false})")
    env.forced[DAY] = (403, 1); send_ui(pg)
    check(pg.query_selector("#ob-ro") and "can't write" in pg.inner_text("#ob-ro") and "Update notebook token" in pg.inner_text("#ob-ro"), "(h) 403 → Read-only banner with Update notebook token…")
    check(pg.evaluate("DASH.app.state.retryLog") == [] and pg.evaluate("DASH.app.state.outbox.sending.length") == 0 and any("denied" in n["text"] for n in OB(pg)["notes"]), "(h) no retry scheduled; the note stays in the Outbox")
    close(pg)
    # discard
    nid = [n["id"] for n in OB(pg)["notes"] if "denied" in n["text"]][0]
    pg.evaluate("DASH.app.nbOps.openOutbox()"); pg.click(f'[data-ob="discard"][data-id="{nid}"]'); pg.evaluate("DASH.app.flush()")
    check(not any(n["id"] == nid for n in OB(pg)["notes"]), "Discard removes a note"); close(pg)
    # task editor: typed note (checked) + automatic status line (unchecked)
    pg.evaluate("(() => { const o = DASH.app.projOps; o.addPlan('Example plan'); const S = DASH.app.state, pl = S.projStore.plans[0]; o.saveTask(pl.id, { id: 'T-ex1', title: 'Example task', bucketId: pl.buckets[0].id, assignees: [], status: 'notStarted', percent: 0, start: null, due: null, priority: 'medium', labels: [], notes: '', account: null, checklist: [] }); })()")
    pg.evaluate("document.querySelector('[data-act=vProjects]').click()"); pg.wait_for_selector("[data-pedit='T-ex1']"); pg.click("[data-pedit='T-ex1']"); pg.wait_for_selector("#pd-nbnote")
    n0 = len(OB(pg)["notes"]); pg.select_option("#pd-status", "completed"); pg.fill("#pd-nbnote", "Placeholder wrap-up note."); pg.click("#pd-save"); pg.evaluate("DASH.app.flush()")
    new = OB(pg)["notes"][n0:]
    check(len(new) == 2 and new[0]["auto"] and not new[0]["checked"] and "Completed" in new[0]["text"] and not new[1]["auto"] and new[1]["checked"] and new[1]["text"] == "Placeholder wrap-up note." and new[1]["ref"] == "Example plan › Example task", "task editor: automatic status line unchecked, typed note checked (1C)")
    # (c) only the inbox day file is ever written, only on dashboard/inbox
    w = env.puts(); puts = [x for x in w if x["method"] == "PUT"]; posts = [x for x in w if x["method"] == "POST"]
    check({x["url"].split("/contents/")[1] for x in puts} == {DAY} and all(json.loads(x["body"])["branch"] == BR for x in puts), "(c) every PUT is inbox/dashboard/2026-11-03.md on dashboard/inbox")
    check(len(posts) == 1 and json.loads(posts[0]["body"])["ref"] == "refs/heads/dashboard/inbox", "(c) the only other write: creating refs/heads/dashboard/inbox once")
    check(not [x for x in w if x["method"] in ("DELETE", "PATCH")], "(c) no DELETE or PATCH")
    # (k) nothing plaintext at rest
    rest = NH.at_rest(pg) + env.folder_text()
    check(not any(t in rest for t in ("Placeholder follow-up booked", "Placeholder update two", "Placeholder retry note", "Placeholder reload note", "Example retry", "Placeholder wrap-up note")), "(k) no plaintext note text in IndexedDB, localStorage or the Data folder")
    exp = json.dumps(pg.evaluate("DASH.db.exportAll()")); check("outbox" not in exp and "Placeholder" not in exp, "the Outbox is not in Export local data")
    # locked: Send disabled
    pg.click('.mtop:has-text("File")'); pg.click('[data-act="encryption"]'); pg.click('[data-v="lock"]'); pg.wait_for_function("() => DASH.app.state.vault.locked && DASH.app.state.nb === null", timeout=30000)
    check(pg.evaluate("DASH.app.state.nb === null"), "Lock clears the notebook client")
    c.close(); b.close()
check(not any(NH.NB_TOKEN in m for m in logs), "the token never appears in the console")
check(not errors, f"no page errors {errors[:3]}")
print("T39 PASS" if ok else "T39 FAIL"); sys.exit(0 if ok else 1)
