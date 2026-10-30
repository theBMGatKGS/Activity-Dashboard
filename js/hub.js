/* Activity Dashboard — encrypted data hub on GitHub (00.04). A private repo holds ONLY keyring.json and *.enc files
   (AES-256-GCM envelopes from js/vault.js). The browser talks to the GitHub REST Contents API with a per-machine,
   fine-grained token (one repo, Contents read/write). Every write is checked here: a plaintext file is refused before
   any request is made, so nothing readable can reach GitHub even if a caller gets it wrong.
   Hub.dir(client) looks like the folder handle the app already uses (entries / getFileHandle / createWritable /
   removeEntry), so the existing merge rules (auto-fill < adjustment < removed; newest stamp, then machine) apply unchanged.
   Hub.mirror(local, hub, own) copies encrypted files between a connected local folder (the backup) and the hub. */
(function (g) {
  "use strict";
  const API = "https://api.github.com", VER = "2022-11-28";
  const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
  const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
  const KEYRING = "keyring.json";
  const TOKEN_RE = /^(github_pat_[A-Za-z0-9_]{20,255}|gh[pousr]_[A-Za-z0-9]{20,255})$/;
  const V = () => (g.DASH && g.DASH.vault) || null;

  function b64encode(text) { const b = new TextEncoder().encode(text); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
  function b64decode(s) { const bin = atob(String(s || "").replace(/\s+/g, "")); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return new TextDecoder().decode(b); }
  function tokenProblem(t) {
    if (!t) return "Paste the access token.";
    if (/^ghp_/.test(t)) return "That's a classic token (ghp_…). Make a fine-grained token (github_pat_…) limited to the one data repo.";
    if (!/^github_pat_/.test(t) || !TOKEN_RE.test(t)) return "That doesn't look like a fine-grained token (it starts with github_pat_).";
    return null;
  }
  function repoProblem(r) { return REPO_RE.test(String(r || "")) ? null : "Use owner/repo, for example your-account/activity-data-hub."; }
  // Only a valid keyring or an encrypted envelope may be written. Anything else is refused here, before the network.
  function writeProblem(name, text) {
    if (!NAME_RE.test(name)) return `${name}: not an allowed file name`;
    if (name === KEYRING) { try { const o = JSON.parse(text), v = V(); if (v ? v.validKeyring(o) : (o && o.kind === "dash-keyring")) return null; } catch (e) { /* fall through */ } return `${name}: not a valid keyring`; }
    if (!/\.enc$/i.test(name)) return `${name}: only encrypted (.enc) files and keyring.json go to the hub`;
    let o; try { o = JSON.parse(text); } catch (e) { return `${name}: not an encrypted envelope`; }
    if (!o || o.kind !== "dash-encrypted" || o.alg !== "AES-256-GCM" || typeof o.ct !== "string" || typeof o.iv !== "string") return `${name}: not an encrypted envelope`;
    const extra = Object.keys(o).filter(k => !["app", "kind", "version", "alg", "keyId", "purpose", "iv", "ct"].includes(k));
    if (extra.length) return `${name}: unexpected fields in the envelope (${extra.join(", ")})`;
    return null;
  }
  const hubName = n => n === KEYRING || /\.enc$/i.test(n);
  const DATA_RE = /^(time-[A-Za-z0-9][A-Za-z0-9_-]*\.json|inbox-snapshot\.json|notebook-log\.js|calendar-snapshot\.json|trips\.json|projects\.json|projects-store\.json|accounts-store\.json|contacts\.json|events-store\.json|links\.json)\.enc$/;
  const dataName = n => DATA_RE.test(n) && !/\.prev\.enc$/i.test(n);

  class HubError extends Error { constructor(msg, status, code) { super(msg); this.name = code || "HubError"; this.status = status; } }
  function explain(status, body, what) {
    const m = (body && body.message) || "";
    if (status === 401) return new HubError("GitHub refused the access token (expired or revoked). Make a new one: File → GitHub sync….", 401, "AuthError");
    if (status === 403 && /rate limit/i.test(m)) return new HubError("GitHub rate limit reached; sync resumes automatically.", 403, "RateLimit");
    if (status === 403) return new HubError("The token can't write to this repo. It needs Repository access: only the data repo, and Contents: Read and write.", 403, "AuthError");
    if (status === 404 && what === "repo") return new HubError("Repo not found, or the token has no access to it.", 404, "NotFoundError");
    if (status === 404) return new HubError("not found", 404, "NotFoundError");
    if (status === 409 || status === 422) return new HubError("changed on GitHub meanwhile", status, "Conflict");
    return new HubError(`GitHub error ${status}${m ? ": " + m : ""}`, status);
  }

  function client(opts) {
    const repo = opts.repo, token = opts.token, f = opts.fetch || (typeof fetch !== "undefined" ? fetch.bind(g) : null), branch = opts.branch || null;
    if (repoProblem(repo)) throw new HubError(repoProblem(repo));
    if (!token) throw new HubError("No access token.");
    const shas = new Map(); let etag = null, listCache = null, repoChecked = false;
    const base = `${API}/repos/${repo}`;
    async function call(method, path, body, extra) {
      const headers = Object.assign({ Accept: "application/vnd.github+json", Authorization: "Bearer " + token, "X-GitHub-Api-Version": VER }, extra || {});
      if (body) headers["Content-Type"] = "application/json";
      let r; try { r = await f(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" }); }
      catch (e) { throw new HubError("Can't reach GitHub (offline, or blocked by a network filter).", 0, "NetworkError"); }
      return r;
    }
    async function json(r) { try { return await r.json(); } catch (e) { return null; } }
    async function checkRepo() {
      if (repoChecked) return; const r = await call("GET", "");
      if (!r.ok) throw explain(r.status, await json(r), "repo");
      const o = await json(r);
      if (!o || o.private !== true) throw new HubError("This repo is public. The data hub must be a PRIVATE repo; nothing was sent.", 0, "PublicRepo");
      repoChecked = true;
    }
    async function list() {
      await checkRepo();
      const r = await call("GET", "/contents/" + (branch ? "?ref=" + encodeURIComponent(branch) : ""), null, etag ? { "If-None-Match": etag } : null);
      if (r.status === 304 && listCache) return listCache.slice();
      if (r.status === 404) { shas.clear(); listCache = []; etag = null; return []; }  // empty repo (no commits yet)
      if (!r.ok) throw explain(r.status, await json(r));
      const arr = await json(r); if (!Array.isArray(arr)) throw new HubError("Unexpected reply listing the repo.");
      shas.clear(); listCache = arr.filter(x => x.type === "file").map(x => ({ name: x.name, sha: x.sha, size: x.size }));
      listCache.forEach(x => shas.set(x.name, x.sha)); etag = r.headers.get("ETag") || r.headers.get("etag") || null;
      return listCache.slice();
    }
    async function read(name) {
      if (!NAME_RE.test(name)) throw new HubError(`${name}: not an allowed file name`);
      await checkRepo();
      const r = await call("GET", "/contents/" + encodeURIComponent(name) + (branch ? "?ref=" + encodeURIComponent(branch) : ""));
      if (!r.ok) throw explain(r.status, await json(r));
      const o = await json(r); if (!o || o.type !== "file") throw new HubError(`${name}: not a file`);
      shas.set(name, o.sha);
      let text;
      if (o.encoding === "base64" && o.content) text = b64decode(o.content);
      else {  // files over 1 MB come back without content: read the blob
        const rb = await call("GET", "/git/blobs/" + o.sha); if (!rb.ok) throw explain(rb.status, await json(rb));
        const b = await json(rb); text = b64decode(b.content);
      }
      return { text, sha: o.sha, size: o.size };
    }
    async function write(name, text, message) {
      const p = writeProblem(name, text); if (p) throw new HubError(p, 0, "Refused");
      await checkRepo();
      for (let attempt = 0; attempt < 3; attempt++) {
        const body = { message: message || "sync", content: b64encode(text) }, sha = shas.get(name);
        if (sha) body.sha = sha; if (branch) body.branch = branch;
        const r = await call("PUT", "/contents/" + encodeURIComponent(name), body);
        if (r.ok) { const o = await json(r); const ns = o && o.content && o.content.sha; if (ns) shas.set(name, ns); etag = null; return { sha: ns, size: o && o.content ? o.content.size : text.length }; }
        const e = explain(r.status, await json(r));
        if (e.name !== "Conflict") throw e;
        // someone changed it: learn the current sha and try again (each machine only writes its own time file, so last write is ours)
        etag = null; try { await list(); } catch (x) { /* retry anyway */ }
      }
      throw new HubError(`${name}: kept changing on GitHub; will retry on the next sync`, 409, "Conflict");
    }
    async function remove(name, message) {
      if (!hubName(name)) throw new HubError(`${name}: not a hub file`, 0, "Refused");
      const sha = shas.get(name); if (!sha) return false;
      const r = await call("DELETE", "/contents/" + encodeURIComponent(name), { message: message || "sync", sha });
      if (!r.ok && r.status !== 404) throw explain(r.status, await json(r));
      shas.delete(name); etag = null; return true;
    }
    async function test() { await checkRepo(); return list(); }
    return { repo, list, read, write, remove, test, shaOf: n => shas.get(n) || null };
  }

  // ---------- 00.04 N3: opaque hub names ----------
  // Every data file sits on the hub as blob-<32 hex>.enc: an HMAC-SHA256 of the real name under a name key derived from the data
  // key, so paths reveal neither file types nor machine names. keyring.json keeps its name (it holds no data).
  // The hub copy is a second envelope (purpose "hub") around {name, text}; text is the local .enc envelope, unchanged.
  // The name key: SHA-256 of one fixed AES-GCM encryption (fixed IV, fixed plaintext, AAD bound to the keyring id). Only that one
  // fixed plaintext ever uses the fixed IV; every data write uses a fresh random IV.
  const BLOB_RE = /^blob-[0-9a-f]{32}\.enc$/;
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
  async function codec(key, keyring) {
    const SUB = g.crypto.subtle, TE = new TextEncoder(), v = V();
    const ct = await SUB.encrypt({ name: "AES-GCM", iv: TE.encode("hubnames-v01"), additionalData: TE.encode("dash-hub-names:" + keyring.keyId) }, key, TE.encode("activity-dashboard opaque hub names v1"));
    const hk = await SUB.importKey("raw", await SUB.digest("SHA-256", ct), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const names = new Map();
    return { keyId: keyring.keyId,
      async nameOf(real) { if (real === KEYRING) return KEYRING; if (!names.has(real)) names.set(real, "blob-" + hex(await SUB.sign("HMAC", hk, TE.encode(real))).slice(0, 32) + ".enc"); return names.get(real); },
      wrap: (real, text, mtime) => v.encrypt(key, keyring, "hub", JSON.stringify({ name: real, text, mtime: typeof mtime === "number" ? mtime : Date.now() })),   // 00.04.001: mtime = when the local copy last changed (authenticated)
      async unwrap(t) { const o = JSON.parse(await v.decrypt(key, keyring, t, "hub")); if (!o || typeof o.name !== "string" || typeof o.text !== "string") throw new Error("not a hub file"); return o; } };
  }
  // Same interface as client(), with real names. getCodec() returns the codec (throws while locked); only keyring.json works without it.
  function opaque(c, getCodec) {
    const cache = new Map(); let problems = [];   // raw sha → { name, text, sha: inner git sha }
    async function entry(x, cd) {
      if (cache.has(x.sha)) return cache.get(x.sha);
      const o = await cd.unwrap((await c.read(x.name)).text);
      if (await cd.nameOf(o.name) !== x.name) throw new Error("name doesn't match its contents");
      const e = { name: o.name, text: o.text, sha: await gitSha(o.text), raw: x.name, mtime: typeof o.mtime === "number" ? o.mtime : 0 }; cache.set(x.sha, e); return e;
    }
    let byName = new Map();
    async function list() {
      const raw = await c.list(), out = [], cd = await getCodec(); problems = []; byName = new Map();
      for (const x of raw) {
        if (x.name === KEYRING) { out.push(x); continue; }
        if (!BLOB_RE.test(x.name)) { problems.push(`hub ${x.name}: not an opaque hub file; ignored`); continue; }
        try { const e = await entry(x, cd); byName.set(e.name, e); out.push({ name: e.name, sha: e.sha, size: e.text.length }); }
        catch (err) { problems.push(`hub ${x.name}: can't be opened (${err.message || err}); ignored`); }
      }
      return out;
    }
    async function read(name) {
      if (name === KEYRING) return c.read(name);
      if (!byName.has(name)) await list();
      const e = byName.get(name); if (!e) { const er = new Error("not found"); er.name = "NotFoundError"; throw er; }
      return { text: e.text, sha: e.sha, size: e.text.length };
    }
    async function write(name, text, message, meta) {
      if (name === KEYRING) return c.write(name, text, message);
      const p = writeProblem(name, text); if (p) throw new HubError(p, 0, "Refused");
      const mtime = meta && typeof meta.mtime === "number" ? meta.mtime : Date.now();
      const cd = await getCodec(), raw = await cd.nameOf(name), r = await c.write(raw, await cd.wrap(name, text, mtime), message);
      const e = { name, text, sha: await gitSha(text), raw, mtime }; if (r && r.sha) cache.set(r.sha, e); byName.set(name, e);
      return { sha: e.sha, size: text.length };
    }
    async function remove(name, message) { if (name === KEYRING) return c.remove(name, message); const cd = await getCodec(); await c.list(); return c.remove(await cd.nameOf(name), message); }
    return { repo: c.repo, opaque: true, list, read, write, remove, test: () => c.test(), problems: () => problems.slice(),
      shaOf: n => n === KEYRING ? c.shaOf(n) : (byName.get(n) ? byName.get(n).sha : null), mtimeOf: n => (byName.get(n) ? byName.get(n).mtime : 0) };
  }

  // A folder-handle look-alike over the hub (for iPad / no local folder). File "lastModified" is the git blob sha,
  // so the app's change detection (lastModified + ":" + size) works as is.
  function dir(c, opts) {
    const msg = (opts && opts.message) || "sync";
    const fh = (name, meta) => ({ kind: "file", name,
      async getFile() { const r = await c.read(name); return { lastModified: r.sha, size: r.size, text: async () => r.text }; },
      async createWritable() { let buf = ""; return { write: async t => { buf += t; }, close: async () => { await c.write(name, buf, msg); } }; } });
    return { kind: "directory", name: "Data", isHub: true, client: c,
      async queryPermission() { return "granted"; }, async requestPermission() { return "granted"; },
      async *entries() { for (const x of await c.list()) yield [x.name, Object.assign(fh(x.name), { kind: "file" })]; },
      async getFileHandle(name, o) { const l = await c.list(); if (!l.some(x => x.name === name) && !(o && o.create)) { const e = new Error("not found"); e.name = "NotFoundError"; throw e; } return fh(name); },
      async removeEntry(name) { await c.list(); return c.remove(name, msg); } };
  }

  // git's blob id for a text, so an unchanged file is recognised from the listing alone (saves API calls)
  async function gitSha(text) {
    const body = new TextEncoder().encode(text), head = new TextEncoder().encode(`blob ${body.length}\0`), all = new Uint8Array(head.length + body.length);
    all.set(head); all.set(body, head.length);
    const d = new Uint8Array(await g.crypto.subtle.digest("SHA-1", all)); return [...d].map(x => x.toString(16).padStart(2, "0")).join("");
  }
  // Two-way copy of encrypted files between the local folder (backup) and the hub.
  //  - keyring.json: hub wins if present; local is uploaded only when the hub has none. Different keyrings → stop, report.
  //  - this machine's own time file: local wins (only this machine writes it).
  //  - every other .enc file: hub wins when both exist and differ; a file missing on either side is copied over.
  //  - plaintext is never uploaded (writeProblem); a hub file that isn't an envelope is never copied down.
  async function mirror(local, c, opts) {
    const own = opts && opts.ownFile, msg = (opts && opts.message) || "sync", out = { up: [], down: [], problems: [] };
    const readLocal = async n => { try { const h = await local.getFileHandle(n); const f = await h.getFile(); return await f.text(); } catch (e) { return null; } };
    const writeLocal = async (n, t) => { const h = await local.getFileHandle(n, { create: true }); const w = await h.createWritable(); await w.write(t); await w.close(); };
    const isPrev = n => /\.prev\.enc$/i.test(n), prevName = n => n.replace(/\.enc$/i, "") + ".prev.enc";
    // 00.04 N1 / 00.04.001: both copies are decrypted and checked (opts.inspect → { ok, stamp, why }). A copy that fails is never
    // uploaded and never replaces anything. When both pass, the NEWER one wins: by its content stamp (snapshot generated_at, time
    // file updated_at), else by when the file last changed (local file time vs the mtime inside the hub envelope). The own time
    // file always goes up. Whatever the local folder loses is kept as <name>.prev.enc (local only, never uploaded).
    const inspect = (opts && opts.inspect) || (opts && opts.verify ? async (n, t) => { try { await opts.verify(n, t); return { ok: true, stamp: null }; } catch (e) { return { ok: false, why: e.message || String(e) }; } } : null);
    const readLocalF = async n => { try { const h = await local.getFileHandle(n); const f = await h.getFile(); return { text: await f.text(), mtime: Number(f.lastModified) || 0 }; } catch (e) { return null; } };
    async function check(n, text, side) {
      const p = writeProblem(n, text); if (p) return { ok: false, why: side === "hub" ? "not an encrypted file" : p };
      if (!inspect) return { ok: false, why: "can't be checked here" };   // nothing moves without a decrypt check
      try { return await inspect(n, text); } catch (e) { return { ok: false, why: e.message || String(e) }; }
    }
    const ts = s => { const v = s == null ? NaN : (typeof s === "number" ? s : Date.parse(s)); return isNaN(v) ? null : v; };
    async function pull(n, ht, lt, mtime) { if (lt != null) await writeLocal(prevName(n), lt); await writeLocal(n, ht); out.down.push(n); }
    async function push(n, lt, mtime, repair) { await c.write(n, lt, msg, { mtime }); out.up.push(n); if (repair) (out.repaired = out.repaired || []).push(n); }
    // 00.04.001: only the known data files are mirrored. Any other *.enc (.prev.enc, renamed backups such as
    // inbox-snapshot.json.bad-copy.enc, conflict copies) stays where it is and is never uploaded or downloaded.
    const isData = (opts && opts.isData) || dataName;
    const localNames = []; for await (const [n, h] of local.entries()) if (h.kind === "file" && (n === KEYRING || isData(n))) localNames.push(n);
    const hubList = await c.list(), hubNames = hubList.map(x => x.name).filter(n => n === KEYRING || isData(n));
    const lk = await readLocal(KEYRING); let hk = null;
    if (hubNames.includes(KEYRING)) hk = (lk != null && await gitSha(lk) === c.shaOf(KEYRING)) ? lk : (await c.read(KEYRING)).text;
    const kid = t => { try { return JSON.parse(t).keyId; } catch (e) { return null; } };
    if (lk && hk && kid(lk) !== kid(hk)) { out.problems.push("The GitHub hub and the local Data folder use different keyrings (different passphrase setups). Nothing was copied. See Help → FAQ."); return out; }
    if (!lk && !hk) { out.problems.push("No keyring yet: turn on encryption first (File → Encryption…). Nothing is sent to GitHub unencrypted."); return out; }
    const stamp = t => { try { const o = JSON.parse(t); return o.changed || o.created || ""; } catch (e) { return ""; } };
    if (lk && !hk) { await c.write(KEYRING, lk, msg); out.up.push(KEYRING); }
    else if (hk && !lk) { await writeLocal(KEYRING, hk); out.down.push(KEYRING); }
    else if (lk !== hk) {   // same key, new passphrase or recovery slot on one side: the newer keyring wins
      if (stamp(lk) > stamp(hk)) { await c.write(KEYRING, lk, msg); out.up.push(KEYRING); } else { await writeLocal(KEYRING, hk); out.down.push(KEYRING); } }
    const all = new Set(localNames.concat(hubNames)); all.delete(KEYRING);
    for (const n of all) {
      try {
        const inL = localNames.includes(n), inH = hubNames.includes(n), lf = inL ? await readLocalF(n) : null;
        if (lf && inH && await gitSha(lf.text) === c.shaOf(n)) continue;   // same content: nothing to do, no download
        const ht = inH ? (await c.read(n)).text : null, hm = inH && c.mtimeOf ? c.mtimeOf(n) || 0 : 0;
        const L = lf ? await check(n, lf.text, "local") : null, Hc = ht != null ? await check(n, ht, "hub") : null;
        if (L && !L.ok) out.problems.push(`${n}: local copy failed the check (${L.why}); not uploaded`);
        if (Hc && !Hc.ok) out.problems.push(`hub ${n}: failed the decrypt check (${Hc.why}); ${L && L.ok ? "replaced with the local copy" : "local copy kept, not overwritten"}`);
        const lok = !!(L && L.ok), hok = !!(Hc && Hc.ok);
        if (lok && !hok) { await push(n, lf.text, lf.mtime, inH); continue; }    // hub missing or bad: upload (repair)
        if (!lok && hok) { await pull(n, ht, lf ? lf.text : null); continue; }   // local missing or bad
        if (!lok && !hok) continue;
        if (lf.text === ht) continue;
        if (n === own) { await push(n, lf.text, lf.mtime); continue; }
        const a = ts(L.stamp), b = ts(Hc.stamp);
        const cmp = a != null && b != null && a !== b ? a - b : (a != null && b != null ? 0 : lf.mtime - hm);
        if (cmp > 0) await push(n, lf.text, lf.mtime); else if (cmp < 0) await pull(n, ht, lf.text);
      } catch (e) { out.problems.push(`${n}: ${e.message || e}`); }
    }
    if (c.problems) out.problems.push(...c.problems());
    return out;
  }

  const api = { API, DATA_RE, dataName, gitSha, client, opaque, codec, BLOB_RE, dir, mirror, writeProblem, tokenProblem, repoProblem, b64encode, b64decode, HubError, KEYRING };
  g.DASH = g.DASH || {}; g.DASH.hub = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
