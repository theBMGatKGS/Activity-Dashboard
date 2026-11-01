/* 00.10.001: Grok Bot usage tile (Daily Focus).  Pure: read the snapshot's optional "usage" block and build the tile model.
   Only percentages, "Maxed", reset times and an https detail link are ever shown; there are no dollar fields to read, and
   any text that looks like a dollar amount is never rendered.  Every time is shown in America/Chicago with a CT label. */
(function (g) {
  "use strict";
  g.DASH = g.DASH || {};
  const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?([+-]\d\d:\d\d|Z)$/;
  const isIso = v => typeof v === "string" && ISO.test(v) && !isNaN(Date.parse(v));
  const num = v => typeof v === "number" && isFinite(v);
  const STALE_DAYS = 3, WARN_WEEKLY = 80;
  const httpsUrl = v => { if (typeof v !== "string" || v.length > 500 || !/^https:\/\/[^\s<>"'`]+$/.test(v)) return null; try { const u = new URL(v); return u.protocol === "https:" ? u.href : null; } catch (e) { return null; } };
  // usage: null/undefined -> null (no tile data); a bad block -> null and one reject line (never its contents)
  function read(raw, rejects) {
    if (raw === undefined || raw === null) return null;
    const bad = m => { if (rejects) rejects.push("usage: " + m + "; the usage tile shows no data"); return null; };
    if (typeof raw !== "object" || Array.isArray(raw)) return bad("must be an object");
    for (const k of ["as_of", "weekly_resets", "on_demand_resets"]) if (!isIso(raw[k])) return bad(k + " must be a date-time with offset");
    if (!num(raw.weekly_used_pct) || raw.weekly_used_pct < 0) return bad("weekly_used_pct must be a number from 0");
    if (!num(raw.on_demand_pct) || raw.on_demand_pct < 0) return bad("on_demand_pct must be a number from 0");
    if (typeof raw.on_demand_maxed !== "boolean") return bad("on_demand_maxed must be true or false");
    return { as_of: raw.as_of, weekly_used_pct: raw.weekly_used_pct, weekly_resets: raw.weekly_resets, on_demand_pct: Math.min(100, raw.on_demand_pct),
      on_demand_maxed: raw.on_demand_maxed, on_demand_resets: raw.on_demand_resets, detail_url: httpsUrl(raw.detail_url) };
  }
  // Placeholder numbers for EXAMPLE DATA (fictional), dated from the example snapshot's time
  function example(atIso) {
    const t = Date.parse(atIso) || Date.now(), iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
    return { as_of: iso(t), weekly_used_pct: 42, weekly_resets: iso(t + 4 * 864e5), on_demand_pct: 18.5, on_demand_maxed: false, on_demand_resets: iso(t + 2 * 864e5), detail_url: null, example: true };
  }
  const CTF = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
  const ct = iso => { const o = {}; CTF.formatToParts(new Date(iso)).forEach(x => { o[x.type] = x.value; }); return `${o.weekday} ${o.month}/${o.day} ${o.hour}:${o.minute} ${o.dayPeriod} CT`; };   // e.g. "Fri 11/6 5:03 AM CT", whatever the browser's zone
  const pct = n => (Math.round(n * 10) / 10).toFixed(n % 1 ? 1 : 0).replace(/\.0$/, "") + "%";
  const noDollar = s => String(s).replace(/\$\s*\d[\d,]*(\.\d+)?/g, "");   // belt and braces: never render a dollar amount
  function model(u, nowIso) {
    if (!u) return null;
    const over = u.weekly_used_pct > 100, w = Math.min(100, Math.max(0, u.weekly_used_pct)), maxed = !!u.on_demand_maxed;   // 00.10.001b: clamped to 0-100; "100%+" if the source went over
    return { weekly: over ? "100%+" : pct(w), bar: w, onDemand: maxed ? "Maxed" : pct(Math.min(100, u.on_demand_pct)), maxed,
      warn: w > WARN_WEEKLY || maxed, tone: maxed || w >= 100 ? "red" : w > WARN_WEEKLY ? "amber" : "green", weeklyResets: ct(u.weekly_resets), onDemandResets: ct(u.on_demand_resets), asOf: ct(u.as_of),
      stale: Date.parse(nowIso) - Date.parse(u.as_of) > STALE_DAYS * 864e5, url: httpsUrl(u.detail_url), example: !!u.example };
  }
  g.DASH.usage = { read, example, model, ct, pct, httpsUrl, noDollar, STALE_DAYS, WARN_WEEKLY };
})(typeof window !== "undefined" ? window : globalThis);
