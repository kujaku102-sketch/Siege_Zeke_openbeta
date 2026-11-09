const VERSION = "__SZ_BUILD_REVISION__";
const SHELL_CACHE = `sz-pwa-shell-${VERSION}`;
// The card art is kept across builds: its files are named by their content's hash, so a picture that did not change
// keeps its name and is not fetched again; one that changed gets a new name and the old one is dropped (PWA, 2026-11-09).
const ART_CACHE = "sz-pwa-card-art";
const META_CACHE = "sz-pwa-meta";
const ENABLED_REQUEST = new Request(new URL("__pwa_enabled__", self.registration.scope));
const SHELL_URLS = __SZ_SHELL_URLS__;
const CARD_ART_URLS = __SZ_CARD_ART_URLS__;
const SHELL_HREFS = new Set(SHELL_URLS.map((url) => new URL(url, self.registration.scope).href));
const CARD_ART_HREFS = new Set(CARD_ART_URLS.map((url) => new URL(url, self.registration.scope).href));

async function enabled() {
  return Boolean(await caches.match(ENABLED_REQUEST, { cacheName: META_CACHE }));
}

async function enabledRevision() {
  const response = await caches.match(ENABLED_REQUEST, { cacheName: META_CACHE });
  return response ? response.text() : null;
}

async function shellReady() {
  const cache = await caches.open(SHELL_CACHE);
  const cached = new Set((await cache.keys()).map((request) => request.url));
  return [...SHELL_HREFS].every((href) => cached.has(href));
}

async function seedShell() {
  await caches.delete(SHELL_CACHE);
  const cache = await caches.open(SHELL_CACHE);
  try {
    await cache.addAll([...SHELL_HREFS].map((href) => new Request(href, { cache: "reload" })));
  } catch (error) {
    await caches.delete(SHELL_CACHE);
    throw error;
  }
}

// Pictures of this build's list only: one no longer listed (its art changed or went) is dropped.
async function pruneCardArt() {
  const cache = await caches.open(ART_CACHE);
  for (const request of await cache.keys()) if (!CARD_ART_HREFS.has(request.url)) await cache.delete(request);
}

async function cacheCardArt(urls) {
  const cache = await caches.open(ART_CACHE);
  let cached = 0, failed = 0;
  for (const url of urls) {
    const href = new URL(url, self.registration.scope).href;
    if (!CARD_ART_HREFS.has(href) || await cache.match(href)) continue;
    try {
      const response = await fetch(href);
      if (response.ok) {
        await cache.put(href, response);
        cached += 1;
      } else failed += 1;
    } catch {
      // A picture that fails is fetched again next time; it never undoes the shell.
      failed += 1;
    }
  }
  return { cached, failed };
}

// A page's address as one entry: its query and hash dropped (?e2e=1 and the like were each kept apart, with no end).
const pageKey = (url) => { const key = new URL(url); key.search = ""; key.hash = ""; return key.href; };

function reply(event, body) {
  event.ports?.[0]?.postMessage({ revision: VERSION, ...body });
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    if (await enabled()) await seedShell();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("sz-pwa-") && ![SHELL_CACHE, ART_CACHE, META_CACHE].includes(name)) await caches.delete(name);
    }
    await pruneCardArt();
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const data = event.data ?? {};
  if (data.type === "ENABLE_PWA_CACHE") event.waitUntil((async () => {
    try {
      // A page the old worker still served while this one took over may have put an old build's shell back.
      for (const name of await caches.keys()) if (name.startsWith("sz-pwa-shell-") && name !== SHELL_CACHE) await caches.delete(name);
      if (await enabledRevision() === VERSION && await shellReady()) {
        reply(event, { ok: true, type: data.type, reused: true });
        return;
      }
      await seedShell();
      const meta = await caches.open(META_CACHE);
      await meta.put(ENABLED_REQUEST, new Response(VERSION));
      reply(event, { ok: true, type: data.type });
    } catch (error) {
      reply(event, { ok: false, type: data.type, error: String(error?.message ?? error) });
    }
  })());
  if (data.type === "CACHE_CARD_ART") event.waitUntil((async () => {
    const result = await cacheCardArt(Array.isArray(data.urls) ? data.urls : []);
    reply(event, { ok: true, type: data.type, ...result });
  })());
  // Every card's art of this build (the page asks once the shell is in).
  if (data.type === "CACHE_ALL_CARD_ART") event.waitUntil((async () => {
    await pruneCardArt();
    const result = await cacheCardArt([...CARD_ART_HREFS]);
    reply(event, { ok: true, type: data.type, total: CARD_ART_HREFS.size, ...result });
  })());
  if (data.type === "GET_PWA_CACHE_STATUS") event.waitUntil((async () => {
    const art = (await (await caches.open(ART_CACHE)).keys()).length;
    reply(event, { ok: true, type: data.type, enabled: await enabled(), art, artTotal: CARD_ART_HREFS.size });
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cachedShellResponse = await caches.match(request, { cacheName: SHELL_CACHE, ignoreVary: true });
    const cachedArtResponse = await caches.match(request, { cacheName: ART_CACHE, ignoreVary: true });
    const pwaEnabled = await enabled();
    if (!pwaEnabled && !cachedShellResponse && !cachedArtResponse) return fetch(request);
    if (request.mode === "navigate") {
      // The entry pages (/, /pc/, /mobile/) are kept under their address without its query, one each; any other page
      // is fetched as it is. Offline, the page's own entry, else the title.
      const key = pageKey(request.url);
      try {
        const response = await fetch(request);
        if (!response.ok) throw new Error(`navigation failed with ${response.status}`);
        if (SHELL_HREFS.has(key)) (await caches.open(SHELL_CACHE)).put(key, response.clone());
        return response;
      } catch {
        return (await caches.match(key, { cacheName: SHELL_CACHE, ignoreVary: true })) ?? (await caches.match(new URL("./", self.registration.scope).href, { cacheName: SHELL_CACHE, ignoreVary: true })) ?? Response.error();
      }
    }
    if (CARD_ART_HREFS.has(request.url)) {
      if (cachedArtResponse) return cachedArtResponse;
      const response = await fetch(request);
      if (response.ok) (await caches.open(ART_CACHE)).put(request, response.clone());
      return response;
    }
    if (cachedShellResponse) {
      return cachedShellResponse;
    }
    if (SHELL_HREFS.has(request.url)) {
      return fetch(request).then(async (response) => {
        if (response.ok) (await caches.open(SHELL_CACHE)).put(request, response.clone());
        return response;
      }).catch(() => Response.error());
    }
    return fetch(request);
  })());
});
