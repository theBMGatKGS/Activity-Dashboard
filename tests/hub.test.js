// Unit tests for js/hub.js (00.04 GitHub data hub). The GitHub API is mocked (tests/fake_github.js); no network. Synthetic data only.
"use strict";
const path = require("path"), V = require(path.join(__dirname, "../js/vault.js")); globalThis.DASH = { vault: V };
const H = require(path.join(__dirname, "../js/hub.js")), { fakeGitHub, gitSha } = require(path.join(__dirname, "fake_github.js"));
let pass = 0, fail = 0;
function check(c, msg) { if (c) { pass++; console.log("PASS " + msg); } else { fail++; console.log("FAIL " + msg); } }
async function rejects(p, re) { try { await p; return false; } catch (e) { return re ? re.test(e.message) : true; } }
const TOK = "github_pat_" + "A".repeat(40), REPO = "owner/activity-data-hub";
function memDir(init) { const m = new Map(Object.entries(init || {})); const nf = () => { const e = new Error("nf"); e.name = "NotFoundError"; return e; };
  const fh = n => ({ kind: "file", name: n, async getFile() { if (!m.has(n)) throw nf(); const t = m.get(n); return { lastModified: 1, size: t.length, text: async () => t }; },
    async createWritable() { let b = ""; return { write: async t => { b += t; }, close: async () => { m.set(n, b); } }; } });
  return { m, kind: "directory", async *entries() { for (const n of [...m.keys()]) yield [n, fh(n)]; }, async getFileHandle(n, o) { if (!m.has(n) && !(o && o.create)) throw nf(); return fh(n); }, async removeEntry(n) { m.delete(n); } }; }
(async () => {
  const { keyring, key } = await V.createKeyring("synthetic hub passphrase");
  const KR = JSON.stringify(keyring, null, 1) + "\n", SECRET = JSON.stringify({ synthetic: true, account: "Account A", minutes: 40 });
  const env = await V.encrypt(key, keyring, "time", SECRET);

  // H1–H4: input checks
  check(!H.tokenProblem(TOK) && /classic/.test(H.tokenProblem("ghp_" + "B".repeat(36))) && H.tokenProblem("hello") && H.tokenProblem(""), "H1 only fine-grained tokens (github_pat_) accepted; classic ghp_ refused");
  check(!H.repoProblem(REPO) && H.repoProblem("no-slash") && H.repoProblem("a/b/c") && H.repoProblem("../x"), "H2 repo must be owner/name");
  check(H.writeProblem("time-pc.json", SECRET) && H.writeProblem("time-pc.json.enc", SECRET) && H.writeProblem("notes.txt", "hi") && H.writeProblem("keyring.json", "{}")
    && H.writeProblem("x.enc", JSON.stringify(Object.assign(JSON.parse(env), { plain: SECRET }))) && H.writeProblem("../x.enc", env), "H3 plaintext, bad names, junk keyring and envelopes with extra fields are refused");
  check(!H.writeProblem("time-pc.json.enc", env) && !H.writeProblem("keyring.json", KR), "H4 envelopes and a valid keyring are allowed");

  // H5: a refused write makes NO network request
  let gh = fakeGitHub(); let c = H.client({ repo: REPO, token: TOK, fetch: gh.fetch });
  check(await rejects(c.write("time-pc.json", SECRET), /only encrypted/) && gh.log.length === 0, "H5 plaintext write refused before any request is made");
  // H6: request hygiene
  await c.write("keyring.json", KR); const put = gh.log.find(x => x.method === "PUT");
  check(put.url.startsWith("https://api.github.com/repos/owner/activity-data-hub/contents/") && put.headers.Authorization === "Bearer " + TOK && put.headers["X-GitHub-Api-Version"]
    && put.init.credentials === "omit" && put.init.cache === "no-store" && put.init.redirect === "error" && !gh.log.some(x => x.url.includes(TOK)), "H6 HTTPS api.github.com, Bearer header (never in the URL), no cookies, no cache, no redirects");
  check(put.body.message === "sync" && !put.body.committer && !put.body.author, "H7 generic commit message, no committer details sent");
  // H8: round trip + empty-repo listing
  const g2 = fakeGitHub(), c2 = H.client({ repo: REPO, token: TOK, fetch: g2.fetch });
  check((await c2.list()).length === 0, "H8 an empty repo lists as no files");
  await c2.write("time-pc.json.enc", env); check((await c2.read("time-pc.json.enc")).text === env && g2.text("time-pc.json.enc") === env, "H9 write then read gives the same envelope");
  // H10: ETag
  await c2.list(); const before = g2.log.length; const l2 = await c2.list();
  check(g2.log[g2.log.length - 1].headers["If-None-Match"] && l2.length === 1 && g2.log.length === before + 1, "H10 unchanged listing uses If-None-Match (304, served from memory)");
  // H11: update needs the sha; a conflict is retried
  const env2 = await V.encrypt(key, keyring, "time", SECRET + " "); g2.opts.conflictOnce = ["time-pc.json.enc"];
  await c2.write("time-pc.json.enc", env2); check(g2.text("time-pc.json.enc") === env2, "H11 409 conflict: re-list, retry with the new sha, write lands");
  // H12: public repo refused, nothing sent
  const g3 = fakeGitHub({ private: false }), c3 = H.client({ repo: REPO, token: TOK, fetch: g3.fetch });
  check(await rejects(c3.write("time-pc.json.enc", env), /PRIVATE/) && g3.files.size === 0 && !g3.log.some(x => x.method === "PUT"), "H12 a PUBLIC repo is refused; nothing is written");
  // H13–H16: errors explained
  const g4 = fakeGitHub(), bad = H.client({ repo: REPO, token: "github_pat_" + "Z".repeat(40), fetch: g4.fetch });
  check(await rejects(bad.list(), /expired or revoked/), "H13 401 → token expired/revoked message");
  check(await rejects(H.client({ repo: "owner/other", token: TOK, fetch: g4.fetch }).list(), /Repo not found/), "H14 404 repo → not found / no access message");
  const g5 = fakeGitHub(), c5 = H.client({ repo: REPO, token: TOK, fetch: g5.fetch }); await c5.list(); g5.opts.failNext = 403;
  check(await rejects(c5.list(), /rate limit/), "H15 403 rate limit explained");
  g5.opts.offline = true; check(await rejects(c5.list(), /Can't reach GitHub/), "H16 offline explained (edits stay queued locally)"); g5.opts.offline = false;
  // H17: >1 MB file read via the blobs API
  const g6 = fakeGitHub({ bigLimit: 100 }), c6 = H.client({ repo: REPO, token: TOK, fetch: g6.fetch }); g6.put("inbox-snapshot.json.enc", env);
  check((await c6.read("inbox-snapshot.json.enc")).text === env && g6.log.some(x => x.url.includes("/git/blobs/")), "H17 large file read through git/blobs");
  // H18: gitSha matches git
  check(await H.gitSha(env) === gitSha(Buffer.from(env)) && await H.gitSha("") === "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391", "H18 gitSha equals git's blob id");
  // H19: dir adapter
  const g7 = fakeGitHub(), d7 = H.dir(H.client({ repo: REPO, token: TOK, fetch: g7.fetch }));
  const w = await (await d7.getFileHandle("time-ipad.json.enc", { create: true })).createWritable(); await w.write(env); await w.close();
  const ents = []; for await (const [n, h] of d7.entries()) ents.push([n, (await h.getFile()).lastModified]);
  check(ents.length === 1 && ents[0][1] === g7.files.get("time-ipad.json.enc").sha && await rejects(d7.getFileHandle("nope.enc"), /not found/), "H19 folder-handle adapter: create/write/list (lastModified = blob sha), missing file = NotFoundError");
  const w2 = await (await d7.getFileHandle("time-ipad.json", { create: true })).createWritable(); await w2.write(SECRET);
  check(await rejects(w2.close(), /only encrypted/) && !g7.files.has("time-ipad.json"), "H20 adapter refuses plaintext too");
  // H21–H28: mirror (opaque names, N1 decrypt check)
  const cd = await H.codec(key, keyring), getCd = async () => cd;
  const verify = async (n, text) => { const purpose = /^time-/.test(n) ? "time" : /^inbox-snapshot/.test(n) ? "snapshot" : "log"; JSON.parse(await V.decrypt(key, keyring, text, purpose)); };
  const g8 = fakeGitHub(), raw8 = H.client({ repo: REPO, token: TOK, fetch: g8.fetch }), c8 = H.opaque(raw8, getCd);
  const loc = memDir({ "keyring.json": KR, "time-workpc.json.enc": env, "inbox-snapshot.json.enc": env, "time-workpc.json": SECRET, "notes.txt": "x" });
  let r = await H.mirror(loc, c8, { ownFile: "time-workpc.json.enc", verify });
  check(r.up.sort().join() === "inbox-snapshot.json.enc,keyring.json,time-workpc.json.enc" && [...g8.files.keys()].every(n => n === "keyring.json" || H.BLOB_RE.test(n)), "H21 mirror uploads keyring + .enc only, under opaque names (plaintext and other files stay local)");
  const blob = [...g8.files.values()].map(f => f.buf.toString()).join(""); check(!blob.includes("Account A") && !blob.includes("synthetic"), "H22 nothing readable reached the fake hub");
  const paths = [...g8.files.keys()].join(" ") + " " + g8.log.map(x => x.url).join(" ");
  check(!/time-|workpc|inbox|snapshot|notebook|\.json\.enc/i.test(paths.replace(/keyring\.json/g, "")) && !/"purpose":"(time|snapshot|log)"/.test(blob), "H29 N3: hub paths and request URLs reveal no file types or machine names; outer envelopes all say purpose hub");
  check(await cd.nameOf("time-a.json.enc") !== await cd.nameOf("time-b.json.enc") && await cd.nameOf("time-a.json.enc") === await (await H.codec(key, keyring)).nameOf("time-a.json.enc")
    && await (await H.codec((await V.createKeyring("other synthetic setup")).key, keyring)).nameOf("time-a.json.enc") !== await cd.nameOf("time-a.json.enc"), "H30 N3: names are stable for one key, differ per file and per key");
  await raw8.list(); const envOther = await V.encrypt(key, keyring, "time", SECRET + "   ");
  await raw8.write(await cd.nameOf("time-workpc.json.enc"), await cd.wrap("time-ipad.json.enc", envOther));
  check((await c8.list()).every(x => x.name !== "time-ipad.json.enc") && c8.problems().some(p => /doesn't match/.test(p)), "H31 N3: a blob whose contents claim a different name is ignored and reported");
  g8.files.delete(await cd.nameOf("time-workpc.json.enc")); await c8.write("time-workpc.json.enc", env);
  await c8.write("time-ipad.json.enc", env2); const envMine = await V.encrypt(key, keyring, "time", SECRET + "  "); loc.m.set("time-workpc.json.enc", envMine);
  const snap2 = await V.encrypt(key, keyring, "snapshot", JSON.stringify({ synthetic: true, generated_at: "2026-10-19T07:30:00-05:00" })); await c8.write("inbox-snapshot.json.enc", snap2);
  r = await H.mirror(loc, c8, { ownFile: "time-workpc.json.enc", verify });
  check(loc.m.get("time-ipad.json.enc") === env2 && (await c8.read("time-workpc.json.enc")).text === envMine && loc.m.get("inbox-snapshot.json.enc") === snap2, "H23 others' files come down, own time file goes up, hub wins for shared files");
  check(loc.m.get("inbox-snapshot.json.prev.enc") === env && !loc.m.has("time-ipad.json.prev.enc") && ![...g8.files.keys()].includes(await cd.nameOf("inbox-snapshot.json.prev.enc")), "H32 N1: the replaced local file is kept as <name>.prev.enc, and never uploaded");
  const reads = g8.log.length; r = await H.mirror(loc, c8, { ownFile: "time-workpc.json.enc", verify });
  check(!r.up.length && !r.down.length && !g8.log.slice(reads).some(x => x.method === "GET" && /contents\/./.test(x.url)), "H24 unchanged files aren't downloaded again (cached by blob sha)");
  // N1 tamper: a well-formed envelope on the hub whose ciphertext was changed must not replace the local backup
  const o = JSON.parse(env), bb = Buffer.from(o.ct, "base64"); bb[5] ^= 1; const tampered = JSON.stringify(Object.assign({}, o, { ct: bb.toString("base64") })) + "\n";
  const goodLocal = loc.m.get("inbox-snapshot.json.enc"); await c8.write("inbox-snapshot.json.enc", tampered); loc.m.delete("inbox-snapshot.json.prev.enc");
  r = await H.mirror(loc, c8, { ownFile: "time-workpc.json.enc", verify });
  check(loc.m.get("inbox-snapshot.json.enc") === goodLocal && !loc.m.has("inbox-snapshot.json.prev.enc") && r.problems.some(p => /decrypt check/.test(p)), "H33 N1 tamper: a damaged hub file is refused, the local copy is kept, a warning is raised");
  await c8.write("time-new.json.enc", tampered); r = await H.mirror(loc, c8, { ownFile: "time-workpc.json.enc", verify });
  check(!loc.m.has("time-new.json.enc") && r.problems.some(p => /time-new.*decrypt check/.test(p)), "H34 N1 tamper: a damaged new hub file is not copied down");
  r = await H.mirror(memDir({ "keyring.json": KR, "inbox-snapshot.json.enc": env }), c8, { ownFile: "x" });
  check(!r.down.length && r.problems.some(p => /can't be checked/.test(p)), "H35 N1: without a verify function nothing is copied down");
  g8.put("time-x.json.enc", SECRET); await c8.list();
  check(c8.problems().some(p => /not an opaque hub file/.test(p)), "H25 a readable-named or non-blob file on the hub is ignored and reported");
  const other = await V.createKeyring("a different passphrase setup"), loc2 = memDir({ "keyring.json": JSON.stringify(other.keyring) });
  r = await H.mirror(loc2, c8, { ownFile: "time-mac.json.enc", verify }); check(r.problems.some(p => /different keyrings/.test(p)) && !r.up.length && !r.down.length, "H26 different keyrings: nothing copied, problem reported");
  const kr2 = await V.changePassphrase(keyring, "synthetic hub passphrase", false, "newer synthetic passphrase"); loc.m.set("keyring.json", JSON.stringify(kr2));
  r = await H.mirror(loc, c8, { ownFile: "time-workpc.json.enc", verify }); check(r.up.includes("keyring.json") && JSON.parse(g8.text("keyring.json")).changed === kr2.changed, "H27 newer keyring (passphrase changed here) goes up; an older one never overwrites it");
  r = await H.mirror(memDir({ "time-a.json.enc": env }), H.opaque(H.client({ repo: REPO, token: TOK, fetch: fakeGitHub().fetch }), getCd), { verify });
  check(r.problems.some(p => /No keyring yet/.test(p)) && !r.up.length, "H28 no keyring anywhere: nothing sent");
  const locked = H.opaque(H.client({ repo: REPO, token: TOK, fetch: fakeGitHub().fetch }), async () => { throw new Error("locked"); });
  check(await rejects(locked.write("time-a.json.enc", env), /locked/), "H36 N3: while locked no data file can be written (no codec)");
  console.log(`\n${pass}/${pass + fail} passed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
