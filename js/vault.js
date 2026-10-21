/* Activity Dashboard: in-browser encryption for the Data folder (00.03). Web Crypto only, no libraries, no network.
   - One random 256-bit data key (DEK) encrypts every Data file with AES-256-GCM (fresh 96-bit IV per write; AAD binds key id + file purpose).
   - The DEK is never stored in the clear. keyring.json (safe to sync) holds it twice, wrapped (AES-GCM key wrap):
     slot "passphrase": key derived from the passphrase with PBKDF2-SHA256 (600,000 iterations, 16-byte random salt);
     slot "recovery":   key derived the same way from a random 160-bit recovery key shown once (32 chars, XXXX-XXXX-… groups).
   - Unlocked keys are non-extractable CryptoKeys: script on the page can use them but can't read the key bytes.
   Works in browsers and in Node >= 19 (globalThis.crypto), so tests and tools/encrypt_file.js share it. */
(function (g) {
  "use strict";
  const C = g.crypto, SUB = C.subtle, TE = new TextEncoder(), TD = new TextDecoder();
  const ITER = 600000, MIN_PASS = 12, VERSION = 1;
  const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";   // Crockford base32: no I, L, O, U
  const b64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return g.btoa(s); };
  const unb64 = s => Uint8Array.from(g.atob(s), c => c.charCodeAt(0));
  const rand = n => C.getRandomValues(new Uint8Array(n));
  function newRecoveryKey() {
    const b = rand(20); let bits = 0, val = 0, out = "";
    for (const x of b) { val = (val << 8) | x; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
    return out.match(/.{4}/g).join("-");
  }
  function normRecovery(s) { return String(s || "").toUpperCase().replace(/[O]/g, "0").replace(/[IL]/g, "1").replace(/[^0-9A-Z]/g, ""); }
  function validRecovery(s) { const n = normRecovery(s); return n.length === 32 && [...n].every(c => B32.includes(c)); }
  function passProblem(p) { if (typeof p !== "string" || p.length < MIN_PASS) return `Use at least ${MIN_PASS} characters.`; if (/^(.)\1+$/.test(p)) return "Don't repeat one character."; return null; }
  async function kek(secret, salt, iter) {
    const base = await SUB.importKey("raw", TE.encode(secret), "PBKDF2", false, ["deriveKey"]);
    return SUB.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base, { name: "AES-GCM", length: 256 }, false, ["wrapKey", "unwrapKey"]);
  }
  const slotAad = (keyId, slot) => TE.encode(`dash-keyring-v1:${keyId}:${slot}`);
  async function makeSlot(dek, keyId, slot, secret, iter) {
    const salt = rand(16), iv = rand(12), k = await kek(secret, salt, iter);
    const w = await SUB.wrapKey("raw", dek, k, { name: "AES-GCM", iv, additionalData: slotAad(keyId, slot) });
    return { kdf: "PBKDF2-SHA256", iter, salt: b64(salt), iv: b64(iv), wrapped: b64(new Uint8Array(w)) };
  }
  async function openSlot(keyring, slot, secret, extractable) {
    const s = keyring && keyring.slots && keyring.slots[slot]; if (!s) throw new Error(`This keyring has no ${slot} slot.`);
    const k = await kek(secret, unb64(s.salt), s.iter);
    try {
      return await SUB.unwrapKey("raw", unb64(s.wrapped), k, { name: "AES-GCM", iv: unb64(s.iv), additionalData: slotAad(keyring.keyId, slot) },
        { name: "AES-GCM", length: 256 }, !!extractable, ["encrypt", "decrypt"]);
    } catch (e) { throw new Error(slot === "recovery" ? "That recovery key doesn't open this keyring." : "Wrong passphrase."); }
  }
  function validKeyring(o) {
    return !!(o && o.kind === "dash-keyring" && o.version === VERSION && typeof o.keyId === "string" && o.slots && o.slots.passphrase && o.slots.recovery
      && ["passphrase", "recovery"].every(n => { const s = o.slots[n]; return s.kdf === "PBKDF2-SHA256" && Number.isInteger(s.iter) && s.iter >= 100000 && s.salt && s.iv && s.wrapped; }));
  }
  function parseKeyring(text) { let o; try { o = JSON.parse(text); } catch (e) { throw new Error("keyring.json is not valid JSON."); } if (!validKeyring(o)) throw new Error("keyring.json is not an Activity Dashboard keyring."); return o; }
  // opts.iter is for tests only (fast); the app always uses ITER.
  async function createKeyring(passphrase, opts) {
    const pp = passProblem(passphrase); if (pp) throw new Error(pp);
    const iter = (opts && opts.iter) || ITER, keyId = b64(rand(9)).replace(/[+/=]/g, "x");
    const dek = await SUB.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const recoveryKey = newRecoveryKey();
    const keyring = { app: "activity-dashboard", kind: "dash-keyring", version: VERSION, keyId, created: new Date().toISOString(),
      note: "Wrapped data key only. Safe to sync. Useless without the passphrase or the recovery key.",
      slots: { passphrase: await makeSlot(dek, keyId, "passphrase", passphrase, iter), recovery: await makeSlot(dek, keyId, "recovery", normRecovery(recoveryKey), iter) } };
    return { keyring, recoveryKey, key: await openSlot(keyring, "passphrase", passphrase, false) };
  }
  const unlock = (keyring, passphrase) => openSlot(keyring, "passphrase", passphrase, false);
  const unlockWithRecovery = (keyring, rk) => openSlot(keyring, "recovery", normRecovery(rk), false);
  // New passphrase, opened with either the current passphrase or the recovery key. The data key and every file stay the same.
  async function changePassphrase(keyring, secret, usingRecovery, newPass, opts) {
    const pp = passProblem(newPass); if (pp) throw new Error(pp);
    const dek = await openSlot(keyring, usingRecovery ? "recovery" : "passphrase", usingRecovery ? normRecovery(secret) : secret, true);
    const kr = JSON.parse(JSON.stringify(keyring)); kr.slots.passphrase = await makeSlot(dek, kr.keyId, "passphrase", newPass, (opts && opts.iter) || ITER); kr.changed = new Date().toISOString();
    return kr;
  }
  // Replace the recovery key (e.g. the old one was exposed). Needs the passphrase.
  async function replaceRecovery(keyring, passphrase, opts) {
    const dek = await openSlot(keyring, "passphrase", passphrase, true), recoveryKey = newRecoveryKey();
    const kr = JSON.parse(JSON.stringify(keyring)); kr.slots.recovery = await makeSlot(dek, kr.keyId, "recovery", normRecovery(recoveryKey), (opts && opts.iter) || ITER); kr.changed = new Date().toISOString();
    return { keyring: kr, recoveryKey };
  }
  const fileAad = (keyId, purpose) => TE.encode(`dash-file-v1:${keyId}:${purpose}`);
  function isEnvelope(text) { try { const o = JSON.parse(text); return !!(o && o.kind === "dash-encrypted"); } catch (e) { return false; } }
  async function encrypt(key, keyring, purpose, text) {
    const iv = rand(12), ct = await SUB.encrypt({ name: "AES-GCM", iv, additionalData: fileAad(keyring.keyId, purpose) }, key, TE.encode(text));
    return JSON.stringify({ app: "activity-dashboard", kind: "dash-encrypted", version: VERSION, alg: "AES-256-GCM", keyId: keyring.keyId, purpose, iv: b64(iv), ct: b64(new Uint8Array(ct)) }) + "\n";
  }
  async function decrypt(key, keyring, text, purpose) {
    let o; try { o = JSON.parse(text); } catch (e) { throw new Error("not an encrypted file"); }
    if (!o || o.kind !== "dash-encrypted" || o.version !== VERSION || o.alg !== "AES-256-GCM") throw new Error("not an encrypted file");
    if (o.keyId !== keyring.keyId) throw new Error("encrypted with a different keyring");
    if (purpose && o.purpose !== purpose) throw new Error(`holds ${o.purpose} data, expected ${purpose}`);
    try { return TD.decode(await SUB.decrypt({ name: "AES-GCM", iv: unb64(o.iv), additionalData: fileAad(keyring.keyId, o.purpose) }, key, unb64(o.ct))); }
    catch (e) { throw new Error("can't be decrypted (damaged or changed)"); }
  }
  const api = { ITER, MIN_PASS, createKeyring, unlock, unlockWithRecovery, changePassphrase, replaceRecovery, encrypt, decrypt, isEnvelope, parseKeyring, validKeyring, passProblem, validRecovery, normRecovery, newRecoveryKey };
  g.DASH = g.DASH || {}; g.DASH.vault = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
