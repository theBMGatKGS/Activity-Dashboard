/* 00.11.002: the notebook client.  A second, separate GitHub client for the private notebook repo with its own fine-grained
   token (never the hub token).  Hard allowlist: READ reports/sam-activity/YYYY-MM.md, the Links sources file, and the inbox day
   file; WRITE only create-or-append to inbox/dashboard/YYYY-MM-DD.md on the branch dashboard/inbox (2B: Notebook merges it; the
   dashboard never writes to main).  The only other write is creating refs/heads/dashboard/inbox from the read branch when it is
   missing.  No DELETE, no PATCH, no other method exists here.  Errors never carry the token. */
(function (g) {
  "use strict";
  const API = "https://api.github.com", VER = "2022-11-28", WRITE_BRANCH = "dashboard/inbox";
  const H = () => g.DASH.hub, NI = () => g.DASH.nbinbox;
  const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/, BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,99}$/;
  const BULLETS = /^reports\/sam-activity\/\d{4}-(0[1-9]|1[0-2])\.md$/;
  const INBOX = /^inbox\/dashboard\/\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\.md$/;
  const SAFE = p => typeof p === "string" && !p.includes("..") && !p.includes("\\") && !p.startsWith("/") && /^[A-Za-z0-9._\/-]{1,200}$/.test(p);
  function pathKind(p, sources) {
    if (!SAFE(p)) return null;
    if (BULLETS.test(p)) return "bullets";
    if (INBOX.test(p)) return "inbox";
    if (sources && SAFE(sources.replace("{month}", "2000-01"))) {
      const re = new RegExp("^" + sources.split("{month}").map(s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\d{4}-(0[1-9]|1[0-2])") + "$");
      if (sources.includes("{month}") && re.test(p)) return "sources";
    }
    return null;
  }
  class NBError extends Error { constructor(msg, status, code, reset) { super(msg); this.name = code || "NBError"; this.status = status; if (reset) this.reset = reset; } }
  function explain(status, body, rate) {
    const m = (body && body.message) || "";
    if (status === 401) return new NBError("GitHub refused the notebook token (expired or revoked).  Add it again: File → Notebook access….", 401, "AuthError");
    if (status === 429 || (status === 403 && (/rate limit/i.test(m) || rate.remaining === 0))) return new NBError("GitHub is limiting requests for now.", status, "RateLimit", rate.reset);
    if (status === 403) return new NBError("The notebook token can't do this.  It needs only the notebook repo, Contents: Read and write.", 403, "AuthError");
    if (status === 404) return new NBError("not found", 404, "NotFoundError");
    if (status === 409 || status === 422) return new NBError("changed on GitHub meanwhile", status, "Conflict");
    return new NBError(`GitHub error ${status}`, status);
  }
  function client(opts) {
    const repo = String(opts.repo || ""), token = opts.token, sources = opts.sources || null, f = opts.fetch || (typeof fetch !== "undefined" ? fetch.bind(g) : null);
    const ref = opts.branch || "main", wref = opts.writeBranch || WRITE_BRANCH, rate = { remaining: null, reset: null };
    const bad = () => { if (!REPO_RE.test(repo)) return "Use owner/repo for the notebook repo."; if (!token) return "No notebook token."; if (!BRANCH_RE.test(ref) || ref.includes("..")) return "Bad branch name."; return null; };
    const enc = p => p.split("/").map(encodeURIComponent).join("/");
    async function call(method, path, body) {
      let r; try { r = await f(`${API}/repos/${repo}${path}`, { method, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error",
        headers: Object.assign({ Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": VER }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined }); }
      catch (e) { throw new NBError("Can't reach GitHub (offline, or blocked by a network filter).", 0, "NetworkError"); }
      const rem = r.headers.get("x-ratelimit-remaining"), rs = r.headers.get("x-ratelimit-reset");
      if (rem != null) rate.remaining = +rem; if (rs != null) rate.reset = +rs; return r;
    }
    const j = async r => { try { return await r.json(); } catch (e) { return null; } };
    async function read(p, branch) {
      const b0 = bad(); if (b0) throw new NBError(b0, 0, "Refused");
      if (!pathKind(p, sources)) throw new NBError(`${p}: not a notebook file the dashboard reads`, 0, "Refused");
      const r = await call("GET", "/contents/" + enc(p) + "?ref=" + encodeURIComponent(branch || ref));
      if (r.status === 404) { const o = await j(r); if (branch && /No commit found/i.test(o && o.message || "")) throw new NBError("branch missing", 404, "NoBranch"); return null; }
      if (!r.ok) throw explain(r.status, await j(r), rate);
      const o = await j(r); if (!o || o.type !== "file" || o.encoding !== "base64") throw new NBError(`${p}: too large or not a file`, 0, "TooLarge");
      return { text: H().b64decode(o.content || ""), sha: o.sha };
    }
    async function ensureBranch() {
      const r = await call("GET", "/git/ref/heads/" + enc(wref)); if (r.ok) return;
      if (r.status !== 404) throw explain(r.status, await j(r), rate);
      const m = await call("GET", "/git/ref/heads/" + enc(ref)); if (!m.ok) throw explain(m.status, await j(m), rate);
      const sha = ((await j(m)) || {}).object; const c = await call("POST", "/git/refs", { ref: "refs/heads/" + wref, sha: sha && sha.sha });
      if (!c.ok && c.status !== 422) throw explain(c.status, await j(c), rate);
    }
    async function append(p, add, message) {
      const b0 = bad(); if (b0) throw new NBError(b0, 0, "Refused");
      if (pathKind(p) !== "inbox") throw new NBError(`${p}: Refused; the dashboard only writes inbox/dashboard/YYYY-MM-DD.md`, 0, "Refused");
      if (wref !== WRITE_BRANCH) throw new NBError(`Refused: the dashboard writes only to ${WRITE_BRANCH}, never main or another branch`, 0, "Refused");
      await ensureBranch();
      for (let attempt = 0; attempt < 3; attempt++) {
        const cur = await read(p, wref), text = NI().appendTo(cur && cur.text, p, add);
        if (cur && text === cur.text) return { sha: cur.sha, commitUrl: null, unchanged: true };
        const body = { message: message || "dashboard: notes", content: H().b64encode(text), branch: wref }; if (cur) body.sha = cur.sha;
        const r = await call("PUT", "/contents/" + enc(p), body);
        if (r.ok) { const o = await j(r) || {}; return { sha: o.content && o.content.sha, commitUrl: o.commit && o.commit.html_url || null }; }
        if (r.status !== 409 && r.status !== 422) throw explain(r.status, await j(r), rate);
      }
      throw new NBError(`${p}: kept changing on GitHub; your notes stay in the Outbox and retry`, 409, "Conflict");
    }
    return { read, append, rate, repo, branch: ref, writeBranch: wref };
  }
  g.DASH = g.DASH || {}; g.DASH.notebook = { client, pathKind, WRITE_BRANCH, NBError };
})(typeof window !== "undefined" ? window : globalThis);
