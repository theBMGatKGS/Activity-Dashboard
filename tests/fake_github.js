// Test-only in-memory stand-in for the GitHub REST Contents API (repo metadata, list, read, put, delete, blobs, ETag).
// Synthetic data only. Used by hub.test.js; t23_hub.py serves the same logic to the browser through page.route.
"use strict";
const crypto = require("crypto");
function gitSha(buf) { return crypto.createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest("hex"); }
function fakeGitHub(opts) {
  const o = Object.assign({ owner: "owner", repo: "activity-data-hub", private: true, tokens: ["github_pat_" + "A".repeat(40)], bigLimit: 1024 * 1024 }, opts || {});
  const files = new Map(), log = []; let commits = 0;
  const etag = () => `"${commits}"`;
  function res(status, body, headers) { const h = new Map(Object.entries(headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    return { ok: status >= 200 && status < 300, status, headers: { get: k => h.get(k.toLowerCase()) || null }, json: async () => body, text: async () => JSON.stringify(body) }; }
  async function fetch(url, init) {
    init = init || {}; const method = init.method || "GET", headers = init.headers || {}; const body = init.body ? JSON.parse(init.body) : null;
    log.push({ method, url, headers, body, init });
    if (o.offline) throw new TypeError("Failed to fetch");
    const auth = headers.Authorization || ""; if (!o.tokens.some(t => auth === "Bearer " + t)) return res(401, { message: "Bad credentials" });
    if (o.failNext) { const s = o.failNext; o.failNext = null; return res(s, { message: s === 403 ? "API rate limit exceeded" : "err" }); }
    const u = new URL(url); const base = `/repos/${o.owner}/${o.repo}`;
    if (!u.pathname.startsWith(base)) return res(404, { message: "Not Found" });
    const rest = u.pathname.slice(base.length);
    if (rest === "" && method === "GET") return res(200, { full_name: `${o.owner}/${o.repo}`, private: o.private });
    if (rest.startsWith("/git/blobs/")) { const sha = rest.split("/").pop(); for (const f of files.values()) if (f.sha === sha) return res(200, { sha, encoding: "base64", content: f.buf.toString("base64") }); return res(404, { message: "Not Found" }); }
    if (rest === "/contents/" && method === "GET") {
      if (!files.size) return res(404, { message: "This repository is empty." });
      if (headers["If-None-Match"] === etag()) return res(304, null, { ETag: etag() });
      return res(200, [...files.entries()].map(([name, f]) => ({ type: "file", name, sha: f.sha, size: f.buf.length })), { ETag: etag() });
    }
    const name = decodeURIComponent(rest.replace(/^\/contents\//, ""));
    if (method === "GET") { const f = files.get(name); if (!f) return res(404, { message: "Not Found" });
      const big = f.buf.length > o.bigLimit; return res(200, { type: "file", name, sha: f.sha, size: f.buf.length, encoding: big ? "none" : "base64", content: big ? "" : f.buf.toString("base64").replace(/(.{60})/g, "$1\n") }); }
    if (method === "PUT") {
      const f = files.get(name); if (f && body.sha !== f.sha) return res(409, { message: "sha does not match" }); if (!f && body.sha) return res(422, { message: "sha wasn't supplied" });
      if (o.conflictOnce && o.conflictOnce.includes(name)) { o.conflictOnce = o.conflictOnce.filter(x => x !== name); const b0 = Buffer.from("{}\n"); files.set(name, { buf: b0, sha: gitSha(b0) }); commits++; return res(409, { message: "conflict" }); }
      const buf = Buffer.from(body.content, "base64"), sha = gitSha(buf); files.set(name, { buf, sha }); commits++;
      return res(f ? 200 : 201, { content: { name, sha, size: buf.length } });
    }
    if (method === "DELETE") { const f = files.get(name); if (!f) return res(404, { message: "Not Found" }); if (body.sha !== f.sha) return res(409, { message: "sha" }); files.delete(name); commits++; return res(200, {}); }
    return res(405, { message: "nope" });
  }
  return { fetch, files, log, opts: o, put: (n, t) => { const buf = Buffer.from(t); files.set(n, { buf, sha: gitSha(buf) }); commits++; }, text: n => files.has(n) ? files.get(n).buf.toString() : null };
}
module.exports = { fakeGitHub, gitSha };

// 00.11.002: test-only stand-in for the private notebook repo (paths with "/", branches, git refs, rate headers, forced statuses,
// conflictOnce(path, extra) = another computer appends between our read and our PUT).  Placeholder data only.
function fakeNotebook(opts) {
  const o = Object.assign({ owner: "owner", repo: "notebook", tokens: ["github_pat_" + "N".repeat(40)], remaining: 4999, reset: 1793734800 }, opts || {});
  const br = new Map([["main", new Map()]]), log = [], forced = new Map(), conflicts = new Map(); let commits = 0;
  const res = (status, body) => { const h = new Map([["x-ratelimit-remaining", String(o.remaining)], ["x-ratelimit-reset", String(o.reset)]]);
    return { ok: status >= 200 && status < 300, status, headers: { get: k => h.get(k.toLowerCase()) || null }, json: async () => body, text: async () => JSON.stringify(body) }; };
  const head = b => "c" + b + "-" + commits;
  async function fetch(url, init) {
    init = init || {}; const method = init.method || "GET", headers = init.headers || {}, body = init.body ? JSON.parse(init.body) : null, u = new URL(url);
    log.push({ method, url, path: u.pathname, ref: u.searchParams.get("ref"), body });
    if (o.offline) throw new TypeError("Failed to fetch");
    if (!o.tokens.some(t => (headers.Authorization || "") === "Bearer " + t)) return res(401, { message: "Bad credentials" });
    const base = `/repos/${o.owner}/${o.repo}`; if (!u.pathname.startsWith(base)) return res(404, { message: "Not Found" });
    const rest = u.pathname.slice(base.length);
    if (rest.startsWith("/git/ref/heads/") && method === "GET") { const b = decodeURIComponent(rest.slice(15)); return br.has(b) ? res(200, { ref: "refs/heads/" + b, object: { sha: head(b) } }) : res(404, { message: "Not Found" }); }
    if (rest === "/git/refs" && method === "POST") { const b = body.ref.replace(/^refs\/heads\//, ""); if (br.has(b)) return res(422, { message: "Reference already exists" });
      const from = [...br.entries()].find(([k]) => head(k) === body.sha); if (!from) return res(422, { message: "Object does not exist" }); br.set(b, new Map(from[1])); commits++; return res(201, { ref: body.ref }); }
    if (!rest.startsWith("/contents/")) return res(405, { message: "nope" });
    const p = rest.slice(10).split("/").map(decodeURIComponent).join("/");
    if (forced.has(p)) { const s = forced.get(p); if (s.once) forced.delete(p); return res(s.code, { message: s.code === 429 || s.code === 403 && s.rate ? "API rate limit exceeded" : "err " + s.code }); }
    const b = method === "GET" ? (u.searchParams.get("ref") || "main") : (body.branch || "main"); if (!br.has(b)) return res(404, { message: "No commit found for the ref " + b });
    const files = br.get(b);
    if (method === "GET") { const f = files.get(p); if (!f) return res(404, { message: "Not Found" }); return res(200, { type: "file", path: p, sha: f.sha, encoding: "base64", content: f.buf.toString("base64").replace(/(.{60})/g, "$1\n") }); }
    if (method === "PUT") {
      const f = files.get(p);
      if (conflicts.has(p) && f) { const extra = conflicts.get(p); conflicts.delete(p); const nb = Buffer.concat([f.buf, Buffer.from(extra)]); files.set(p, { buf: nb, sha: gitSha(nb) }); commits++; return res(409, { message: "is at x but expected y" }); }
      if (f && body.sha !== f.sha) return res(409, { message: "sha mismatch" }); if (!f && body.sha) return res(422, { message: "sha wasn't supplied" }); if (f && !body.sha) return res(422, { message: "\"sha\" wasn't supplied" });
      const buf = Buffer.from(body.content, "base64"), sha = gitSha(buf); files.set(p, { buf, sha }); commits++;
      return res(f ? 200 : 201, { content: { path: p, sha }, commit: { sha: "k" + commits, html_url: `https://github.com/${o.owner}/${o.repo}/commit/k${commits}` } });
    }
    return res(405, { message: "nope" });
  }
  const files = b => { if (!br.has(b)) br.set(b, new Map()); return br.get(b); };
  return { fetch, log, opts: o, branches: br,
    put: (p, t, b) => { const buf = Buffer.from(t); files(b || "main").set(p, { buf, sha: gitSha(buf) }); commits++; },
    get: (p, b) => { const m = br.get(b || "main"); return m && m.has(p) ? m.get(p).buf.toString() : null; },
    status: (p, code, once, rate) => forced.set(p, { code, once, rate }), conflictOnce: (p, extra) => conflicts.set(p, extra) };
}
module.exports.fakeNotebook = fakeNotebook;
