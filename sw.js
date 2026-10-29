/* Activity Dashboard service worker (00.03; 00.04: GitHub API calls are cross-origin and never touched or cached). Caches the app shell only, so the installed app opens offline.
   Never caches data: anything under Data/, config.local.js, keyring or .enc files always goes to the network (and data
   normally comes through the folder picker, which doesn't use fetch at all). Network first, so a new release shows on the next load. */
const REV = "00.09.000_261029", CACHE = "dash-shell-" + REV;
const SHELL = ["./", "index.html", "app.css", "config.js", "manifest.webmanifest", "js/frame.js", "js/vault.js", "js/hub.js", "js/rules.js", "js/accounts.js", "js/sync.js", "js/db.js", "js/app.js",
  "assets/fonts/SpaceGrotesk-var-latin.woff2", "assets/fonts/IBMPlexMono-400-latin.woff2", "assets/fonts/IBMPlexMono-500-latin.woff2",
  "assets/avatar.png", "assets/icon-64.png", "assets/icon-192.png", "assets/icon-512.png", "assets/icon-maskable-512.png",
  "examples/example-snapshot.js", "examples/example-calendar.js", "examples/example-projects.js", "examples/example-accounts.js", "docs/QUICK_START.md"];
const NEVER = /(^|\/)(Data|data)\/|config\.local\.js|keyring\.json|\.enc(\?|$)|\/repos\/|\/contents\//;
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("dash-shell-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== self.location.origin) return;   // api.github.com and anything else off-site: browser default, never cached
  if (NEVER.test(u.pathname)) return;                     // browser default: network only, not cached
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && r.type === "basic") { const copy = r.clone(); u.search = ""; caches.open(CACHE).then(c => c.put(u.href, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(m => m || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});
