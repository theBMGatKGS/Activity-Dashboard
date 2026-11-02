/* 00.11.000: Agenda tab (design agenda-option-1).  Pure: builds a Week (default), Day or Month model from the snapshot's
   meetings, the Tradeshows & Events list and the travel feed (flight and hotel blocks only when the feed has them).
   Every time is shown in America/Chicago with a CT label; inside the repeated 1-2 AM hour it says CDT or CST. */
(function (g) {
  "use strict";
  g.DASH = g.DASH || {};
  const R = () => g.DASH.rules;
  const ZONE = "America/Chicago";
  const PF = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZoneName: "short" });
  function parts(iso) { const o = {}; PF.formatToParts(new Date(iso)).forEach(x => { o[x.type] = x.value; }); return o; }
  const dayCT = iso => { const o = parts(iso); return `${o.year}-${o.month}-${o.day}`; };
  const hourCT = iso => { const o = parts(iso); return +o.hour + +o.minute / 60; };
  // Ambiguous wall time (DST end): the same clock reading an hour earlier or later.
  function ambiguous(iso) { const t = Date.parse(iso), k = o => `${o.year}${o.month}${o.day}${o.hour}${o.minute}`, me = k(parts(iso)); return k(parts(new Date(t - 3600e3).toISOString())) === me || k(parts(new Date(t + 3600e3).toISOString())) === me; }
  function ctTime(iso) { const o = parts(iso), h = +o.hour, lab = ambiguous(iso) ? (o.timeZoneName === "CDT" ? "CDT" : "CST") : "CT";
    return `${h % 12 || 12}:${o.minute} ${h < 12 ? "AM" : "PM"} ${lab}`; }
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dowOf = day => DOW[(new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7];
  const monday = day => R().addDays(day, -((new Date(day + "T12:00:00Z").getUTCDay() + 6) % 7));
  function itemsFor(day, src) {
    const allDay = [], timed = [];
    (src.events || []).forEach(x => { if (!x.start_date || x.start_date === "?") return; const end = x.end_date && x.end_date !== "?" ? x.end_date : x.start_date;
      if (x.start_date <= day && end >= day) allDay.push({ kind: "event", id: x.id, title: x.title, flag: x.red ? "red" : (x.flags || []).some(f => f.level === "amber" || f.level === "unv") ? "amber" : null, first: x.start_date === day }); });
    (src.trips || []).forEach(tr => (tr.segments || []).forEach(s => {
      if (s.kind === "hotel") { const a = dayCT(s.start), b = dayCT(s.end); if (a <= day && (day < b || (a === b && a === day))) allDay.push({ kind: "hotel", title: "Hotel" + (s.place ? " · " + s.place : s.city ? " · " + s.city : ""), flag: null, first: a === day }); }
      if (s.kind === "flight" && dayCT(s.start) === day) timed.push({ kind: "flight", start: s.start, end: s.end, title: `Flight ${[s.from, s.to].filter(Boolean).join(" to ")}`.trim() + (s.airline || s.number ? ` · ${[s.airline, s.number].filter(Boolean).join(" ")}` : ""), time: ctTime(s.start), h0: hourCT(s.start), h1: dayCT(s.end) === day ? Math.max(hourCT(s.end), hourCT(s.start) + 0.5) : 24 });
    }));
    (src.meetings || []).forEach(m => { if (dayCT(m.start) !== day) return; timed.push({ kind: "meeting", id: m.id, start: m.start, end: m.end, title: m.title, location: m.location || null, time: ctTime(m.start), h0: hourCT(m.start), h1: dayCT(m.end) === day ? Math.max(hourCT(m.end), hourCT(m.start) + 0.25) : 24 }); });
    timed.sort((a, b) => a.h0 - b.h0 || a.title.localeCompare(b.title)); allDay.sort((a, b) => (a.flag === "red" ? 0 : 1) - (b.flag === "red" ? 0 : 1) || a.title.localeCompare(b.title));
    return { allDay, timed };
  }
  // The hour band starts at the first hour with something in it and ends after the last (no empty band); nothing timed -> no band.
  function band(days) { const t = [].concat(...days.map(d => d.timed)); if (!t.length) return null; const a = Math.floor(Math.min(...t.map(x => x.h0))), b = Math.ceil(Math.max(...t.map(x => Math.min(24, x.h1)))); return { from: a, to: Math.max(a + 1, b) }; }
  function model(mode, anchor, today, src) {
    const m = ["day", "week", "month"].includes(mode) ? mode : "week";
    if (m === "month") {
      const first = anchor.slice(0, 8) + "01", start = monday(first), y = +anchor.slice(0, 4), mo = +anchor.slice(5, 7), last = anchor.slice(0, 8) + String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0"), weeks = [];
      for (let w = start; w <= last; w = R().addDays(w, 7)) { const row = []; for (let i = 0; i < 7; i++) { const day = R().addDays(w, i), it = itemsFor(day, src); row.push({ day, inMonth: day.slice(0, 7) === anchor.slice(0, 7), today: day === today, allDay: it.allDay, timed: it.timed, red: it.allDay.some(x => x.flag === "red") }); } weeks.push(row); }
      return { mode: m, from: weeks[0][0].day, to: weeks[weeks.length - 1][6].day, month: anchor.slice(0, 7), weeks };
    }
    const from = m === "day" ? anchor : monday(anchor), n = m === "day" ? 1 : 7, days = [];
    for (let i = 0; i < n; i++) { const day = R().addDays(from, i), it = itemsFor(day, src); days.push({ day, dow: dowOf(day), today: day === today, allDay: it.allDay, timed: it.timed }); }
    return { mode: m, from, to: days[days.length - 1].day, days, band: band(days) };
  }
  function step(mode, anchor, dir) { const r = R(); if (mode === "day") return r.addDays(anchor, dir); if (mode === "week") return r.addDays(anchor, 7 * dir);
    const y = +anchor.slice(0, 4), mo = +anchor.slice(5, 7) - 1 + dir, d = new Date(Date.UTC(y, mo, 1)); return d.toISOString().slice(0, 10); }
  g.DASH.agenda = { model, step, ctTime, ambiguous, dayCT, hourCT, dowOf, monday, ZONE };
})(typeof window !== "undefined" ? window : globalThis);
