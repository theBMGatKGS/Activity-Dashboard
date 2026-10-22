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
