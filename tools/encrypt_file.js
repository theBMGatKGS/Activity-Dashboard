#!/usr/bin/env node
/* Encrypt one plaintext data file for an encrypted Data folder, using the same format as the app (js/vault.js).
   For a pipeline that writes the snapshot or notebook log: encrypt BEFORE the file is copied into the synced folder.
   Usage: DASH_PASSPHRASE=… node tools/encrypt_file.js <keyring.json> <snapshot|log|time> <in-file> <out-file.enc>
   The passphrase is read from the environment only (never an argument, so it isn't in shell history or the process list). */
"use strict";
const fs = require("fs"), path = require("path"), V = require(path.join(__dirname, "../js/vault.js"));
(async () => {
  const [kr, purpose, inp, out] = process.argv.slice(2);
  if (!out || !["snapshot", "log", "time"].includes(purpose)) { console.error("usage: DASH_PASSPHRASE=… node tools/encrypt_file.js <keyring.json> <snapshot|log|time> <in> <out.enc>"); process.exit(2); }
  const pass = process.env.DASH_PASSPHRASE; if (!pass) { console.error("set DASH_PASSPHRASE"); process.exit(2); }
  const keyring = V.parseKeyring(fs.readFileSync(kr, "utf8")), key = await V.unlock(keyring, pass);
  let text = fs.readFileSync(inp, "utf8");
  if (purpose === "snapshot") { const m = text.match(/window\.[A-Z][A-Z0-9_]*SNAPSHOT\s*=\s*([\s\S]*?);?\s*$/); text = JSON.stringify(JSON.parse(m ? m[1] : text)); }
  const ct = await V.encrypt(key, keyring, purpose, text);
  if (await V.decrypt(key, keyring, ct, purpose) !== text) throw new Error("read-back check failed");
  fs.writeFileSync(out + ".tmp", ct); fs.renameSync(out + ".tmp", out); console.log("encrypted " + path.basename(inp) + " -> " + path.basename(out));
})().catch(e => { console.error(e.message || e); process.exit(1); });
