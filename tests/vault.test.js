// Unit tests for js/vault.js (00.03 encryption). Synthetic data only. Run: node tests/vault.test.js
"use strict";
const path = require("path"), V = require(path.join(__dirname, "../js/vault.js"));
let pass = 0, fail = 0;
function check(c, msg) { if (c) { pass++; console.log("PASS " + msg); } else { fail++; console.log("FAIL " + msg); } }
async function rejects(p, re) { try { await p; return false; } catch (e) { return re ? re.test(e.message) : true; } }
const FAST = { iter: 100000 }, PASS = "correct horse battery staple", TEXT = JSON.stringify({ synthetic: true, account: "Account A", minutes: 40 });
(async () => {
  const t0 = Date.now(); const real = await V.createKeyring(PASS); const ms = Date.now() - t0;
  check(real.keyring.slots.passphrase.iter === 600000 && real.keyring.slots.recovery.iter === 600000 && V.ITER === 600000, "V1 default PBKDF2-SHA256 iterations are 600,000 on both slots");
  console.log(`   (keyring creation at 600k took ${ms} ms)`);
  const { keyring, recoveryKey, key } = await V.createKeyring(PASS, FAST);
  check(V.validKeyring(keyring) && V.validKeyring(JSON.parse(JSON.stringify(keyring))), "V2 keyring is valid and survives JSON");
  const krText = JSON.stringify(keyring);
  check(!/[0-9a-f]{64}/i.test(krText) && !krText.includes(PASS) && !krText.includes(recoveryKey) && !krText.includes(V.normRecovery(recoveryKey)), "V3 keyring holds no passphrase, recovery key or raw key");
  check(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/.test(recoveryKey) && V.validRecovery(recoveryKey), "V4 recovery key: 32 Crockford base32 chars in 8 groups");
  check(key.extractable === false && key.algorithm.name === "AES-GCM" && key.algorithm.length === 256, "V5 unlocked key is non-extractable AES-256-GCM");
  const ct = await V.encrypt(key, keyring, "time", TEXT);
  check(V.isEnvelope(ct) && !ct.includes("Account A") && !ct.includes("synthetic"), "V6 envelope hides the plaintext");
  check(await V.decrypt(key, keyring, ct, "time") === TEXT, "V7 round trip");
  const ct2 = await V.encrypt(key, keyring, "time", TEXT);
  check(JSON.parse(ct).iv !== JSON.parse(ct2).iv && JSON.parse(ct).ct !== JSON.parse(ct2).ct, "V8 fresh IV every write");
  check(await rejects(V.unlock(keyring, "wrong passphrase here"), /Wrong passphrase/), "V9 wrong passphrase refused");
  const k2 = await V.unlock(keyring, PASS); check(await V.decrypt(k2, keyring, ct, "time") === TEXT, "V10 unlock with the passphrase opens existing files");
  const k3 = await V.unlockWithRecovery(keyring, recoveryKey.toLowerCase().replace(/-/g, " ")); check(await V.decrypt(k3, keyring, ct) === TEXT, "V11 recovery key opens it (case and separators ignored)");
  check(await rejects(V.unlockWithRecovery(keyring, V.newRecoveryKey()), /recovery key/), "V12 a different recovery key is refused");
  const o = JSON.parse(ct), b = Buffer.from(o.ct, "base64"); b[3] ^= 1; const tampered = JSON.stringify(Object.assign({}, o, { ct: b.toString("base64") }));
  check(await rejects(V.decrypt(key, keyring, tampered, "time"), /damaged/), "V13 one flipped bit is detected (GCM tag)");
  check(await rejects(V.decrypt(key, keyring, JSON.stringify(Object.assign({}, o, { purpose: "snapshot" })))), "V14 relabelled purpose fails (AAD bound)");
  check(await rejects(V.decrypt(key, keyring, ct, "snapshot"), /expected snapshot/), "V15 purpose mismatch refused");
  const other = await V.createKeyring("another long passphrase", FAST);
  check(await rejects(V.decrypt(other.key, other.keyring, ct), /different keyring/), "V16 a file from another keyring is refused");
  const kr2 = await V.changePassphrase(keyring, PASS, false, "a brand new passphrase", FAST);
  check(await rejects(V.unlock(kr2, PASS)) && await V.decrypt(await V.unlock(kr2, "a brand new passphrase"), kr2, ct) === TEXT, "V17 change passphrase: old one stops, files still open");
  check(await V.decrypt(await V.unlockWithRecovery(kr2, recoveryKey), kr2, ct) === TEXT, "V18 recovery key still works after a passphrase change");
  const kr3 = await V.changePassphrase(keyring, recoveryKey, true, "set after recovery 1", FAST);
  check(await V.decrypt(await V.unlock(kr3, "set after recovery 1"), kr3, ct) === TEXT, "V19 new passphrase set with the recovery key");
  const r4 = await V.replaceRecovery(keyring, PASS, FAST);
  check(await rejects(V.unlockWithRecovery(r4.keyring, recoveryKey)) && await V.decrypt(await V.unlockWithRecovery(r4.keyring, r4.recoveryKey), r4.keyring, ct) === TEXT, "V20 new recovery key: old one stops, new one works");
  check(await rejects(V.createKeyring("short", FAST), /12 characters/) && V.passProblem("aaaaaaaaaaaaaa") && !V.passProblem(PASS), "V21 passphrase rules (12+ chars, not one repeated char)");
  check(!V.validKeyring(Object.assign({}, keyring, { slots: { passphrase: Object.assign({}, keyring.slots.passphrase, { iter: 1000 }), recovery: keyring.slots.recovery } })), "V22 keyring with weak iterations is rejected");
  let threw = false; try { V.parseKeyring("{}"); } catch (e) { threw = true; } check(threw, "V23 junk keyring.json is rejected");
  { // V24 tools/encrypt_file.js writes files the app's format reads (pipeline route); passphrase only via the environment
    const fs = require("fs"), os = require("os"), cp = require("child_process"), d = fs.mkdtempSync(path.join(os.tmpdir(), "vault-"));
    fs.writeFileSync(path.join(d, "keyring.json"), JSON.stringify(keyring)); fs.writeFileSync(path.join(d, "snap.js"), "window.DASH_SNAPSHOT = " + TEXT + ";\n");
    const tool = path.join(__dirname, "../tools/encrypt_file.js"), args = [tool, path.join(d, "keyring.json"), "snapshot", path.join(d, "snap.js"), path.join(d, "out.enc")];
    const bad = cp.spawnSync("node", args, { env: Object.assign({}, process.env, { DASH_PASSPHRASE: "wrong passphrase!!" }) });
    const good = cp.spawnSync("node", args, { env: Object.assign({}, process.env, { DASH_PASSPHRASE: PASS }) });
    check(bad.status !== 0 && good.status === 0 && await V.decrypt(key, keyring, fs.readFileSync(path.join(d, "out.enc"), "utf8"), "snapshot") === TEXT, "V24 tools/encrypt_file.js output opens in the app format; wrong passphrase refused");
  }
  console.log(`\n${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
