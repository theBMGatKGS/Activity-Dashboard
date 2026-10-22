/* Activity Dashboard — frame-busting (00.04, QA note). The CSP frame-ancestors directive is ignored in a <meta> tag and
   GitHub Pages can't send headers, so this check runs first: inside someone else's frame the page hides itself, tries to
   take over the top window, and app.js refuses to start (no unlock dialog, no token prompt can be shown in a frame). */
(function (g) {
  "use strict";
  let framed = false; try { framed = g.self !== g.top; } catch (e) { framed = true; }
  g.DASH = g.DASH || {}; g.DASH.framed = framed;
  if (!framed) return;
  document.documentElement.style.display = "none";
  try { g.top.location.replace(g.self.location.href); } catch (e) { /* cross-origin parent: stay hidden */ }
})(window);
