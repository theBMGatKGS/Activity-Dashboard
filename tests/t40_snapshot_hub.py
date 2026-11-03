"""T40 (00.11.002): File → Open snapshot… saves the opened snapshot encrypted as inbox-snapshot.json.enc, so it syncs to other
computers (Data folder, or the hub when the hub is the store: the same writeVerified path t23 covers).  Newer generated_at wins; an
older or equal one writes nothing; a future-dated one is refused with a problem line; locked → "Unlock first"; never plaintext.
Two computers share one encrypted Data folder stand-in.  Placeholder data only."""
import sys, pathlib, json, os
from playwright.sync_api import sync_playwright
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent)); import nbharness as NH
ok = True; errors = []
def check(c, m):
    global ok; print(("PASS " if c else "FAIL ") + m); ok = ok and c
env = NH.Env(snap_at="2026-11-03T07:30:00-06:00")
Q = lambda m: f"?now=2026-11-03T10:00:00-06:00&machine={m}&view=dashboard"
ENC = env.data / "inbox-snapshot.json.enc"
DEC = "(async () => { const f = await (await window.DASH_TEST_FS.getFileHandle('inbox-snapshot.json.enc')).getFile(); return JSON.parse(await DASH.vault.decrypt(DASH.app.state.vault.key, DASH.app.state.vault.kr, await f.text(), 'snapshot')).generated_at; })()"
def snap(at): s = json.loads(json.dumps(env.snap)); s["generated_at"] = at; return s
with sync_playwright() as p:
    b = p.chromium.launch()
    cA = env.context(b); A = env.page(cA, Q("desk1"), errors); NH.encrypt(A); NH.sync(A)
    check(ENC.exists() and not (env.data / "inbox-snapshot.json").exists() and A.evaluate(DEC) == "2026-11-03T07:30:00-06:00", "setup: the folder holds the encrypted 07:30 snapshot only")
    cB = env.context(b); B = env.page(cB, Q("laptop1"), errors); NH.unlock(B); NH.sync(B)
    check(B.evaluate("DASH.app.state.snap.raw_generated_at") == "2026-11-03T07:30:00-06:00", "computer B starts on 07:30")
    # (a) A opens a newer snapshot through the real menu → encrypted file updated → B picks it up on sync
    newer = env.tmp / "opened-snapshot.json"; newer.write_text(json.dumps(snap("2026-11-03T09:45:00-06:00")))
    A.click('.mtop:has-text("File")')
    with A.expect_file_chooser() as fc: A.click('[data-act="open"]')
    fc.value.set_files(str(newer)); A.wait_for_function("() => document.querySelector('#toast').textContent.includes('Saved encrypted')", timeout=30000); A.evaluate("DASH.app.flush()")
    check(A.evaluate(DEC) == "2026-11-03T09:45:00-06:00", "(a) the opened, newer snapshot is saved encrypted as inbox-snapshot.json.enc")
    check("2026-11-03T09:45" in A.inner_text("#toast") and "opened-snapshot.json" in A.inner_text("#toast"), "toast shows only the file name and generated_at")
    for _ in range(40):
        NH.sync(B); B.wait_for_timeout(300)
        if B.evaluate("DASH.app.state.snap && DASH.app.state.snap.raw_generated_at") == "2026-11-03T09:45:00-06:00": break
    check(B.evaluate("DASH.app.state.snap.raw_generated_at") == "2026-11-03T09:45:00-06:00", "(a) computer B shows the opened snapshot after sync")
    # (b) an older one writes nothing
    m0 = ENC.stat().st_mtime_ns; r = A.evaluate(f"DASH.app.nbOps.openSnapshotFile('older.json', {json.dumps(snap('2026-11-03T08:00:00-06:00'))})"); A.evaluate("DASH.app.flush()")
    check(ENC.stat().st_mtime_ns == m0 and A.evaluate(DEC) == "2026-11-03T09:45:00-06:00" and "kept" in A.inner_text("#toast"), "(b) an older opened snapshot is not written; the synced newer one is kept")
    m0 = ENC.stat().st_mtime_ns; A.evaluate(f"DASH.app.nbOps.openSnapshotFile('same.json', {json.dumps(snap('2026-11-03T09:45:00-06:00'))})"); A.evaluate("DASH.app.flush()")
    check(ENC.stat().st_mtime_ns == m0, "(b) the same generated_at writes nothing")
    # (c) future-dated → refused
    m0 = ENC.stat().st_mtime_ns; r = A.evaluate(f"DASH.app.nbOps.openSnapshotFile('future.json', {json.dumps(snap('2026-11-04T12:00:00-06:00'))})")
    check(r is False and ENC.stat().st_mtime_ns == m0 and "future" in A.inner_text("#banner") and any("future.json" in x for x in A.evaluate("DASH.app.state.problems")), "(c) a future-dated snapshot is refused with a problem line")
    check(A.evaluate("DASH.app.state.snap.raw_generated_at") == "2026-11-03T09:45:00-06:00", "(c) the screen keeps the current snapshot")
    # (d) locked → Unlock first
    A.click('.mtop:has-text("File")'); A.click('[data-act="encryption"]'); A.click('[data-v="lock"]'); A.wait_for_function("() => DASH.app.state.vault.locked", timeout=30000)
    m0 = ENC.stat().st_mtime_ns; r = A.evaluate(f"DASH.app.nbOps.openSnapshotFile('locked.json', {json.dumps(snap('2026-11-03T09:55:00-06:00'))})")
    check(r is False and "Unlock first" in A.inner_text("#banner") and ENC.stat().st_mtime_ns == m0, "(d) locked: refused with Unlock first, nothing written")
    # (e) never plaintext
    names = os.listdir(env.data); txt = env.folder_text()
    check("inbox-snapshot.json" not in names and not any(n.endswith(".json") and not n.endswith(".enc") and n != "keyring.json" for n in names) and '"generated_at"' not in txt, "(e) no plaintext snapshot anywhere in the folder")
    cA.close(); cB.close()
    # unencrypted folder: today's behavior plus a hint
    env2 = NH.Env(); c2 = env2.context(b); P2 = env2.page(c2, Q("desk2"), errors)
    P2.evaluate(f"DASH.app.nbOps.openSnapshotFile('plain.json', {json.dumps(snap('2026-11-03T09:00:00-06:00'))})")
    check("Encrypt the Data folder to sync opened snapshots" in P2.inner_text("#toast") and not (env2.data / "inbox-snapshot.json.enc").exists(), "unencrypted folder: kept on this computer, toast says to encrypt to sync")
    c2.close(); b.close()
check(not errors, f"no page errors {errors[:3]}")
print("T40 PASS" if ok else "T40 FAIL"); sys.exit(0 if ok else 1)
