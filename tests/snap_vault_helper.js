// Test helper for t31 (00.09.001): make a keyring, encrypt or decrypt one data file with it. Fictional data only.
// Usage: node snap_vault_helper.js keyring <out-keyring>      (DASH_TEST_PASS in the environment)
//        node snap_vault_helper.js enc <keyring> <purpose> <in> <out.enc>
//        node snap_vault_helper.js gen <keyring> <in.enc>      (prints the snapshot's generated_at only, never its contents)
"use strict";
const fs = require("fs"), path = require("path"), V = require(path.join(__dirname, "../js/vault.js"));
(async () => {
  const [op, a, b, c, d] = process.argv.slice(2), pass = process.env.DASH_TEST_PASS;
  if (op === "keyring") { const r = await V.createKeyring(pass); fs.writeFileSync(a, JSON.stringify(r.keyring, null, 1) + "\n"); return; }
  const kr = V.parseKeyring(fs.readFileSync(a, "utf8")), key = await V.unlock(kr, pass);
  if (op === "enc") { fs.writeFileSync(d, await V.encrypt(key, kr, b, fs.readFileSync(c, "utf8"))); return; }
  if (op === "gen") { console.log(JSON.parse(await V.decrypt(key, kr, fs.readFileSync(b, "utf8"), "snapshot")).generated_at); return; }
  throw new Error("unknown op");
})().catch(e => { console.error(e.message || e); process.exit(1); });
