const VERSION = "__SZ_BUILD_REVISION__";
const SHELL_CACHE = `sz-pwa-shell-${VERSION}`;
const ART_CACHE = `sz-pwa-card-art-${VERSION}`;
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

async function cacheCardArt(urls) {
  const cache = await caches.open(ART_CACHE);
  let cached = 0;
  for (const url of urls) {
    const href = new URL(url, self.registration.scope).href;
    if (!CARD_ART_HREFS.has(href) || await cache.match(href)) continue;
    try {
      const response = await fetch(href);
      if (response.ok) {
        await cache.put(href, response);
        cached += 1;
      }
    } catch {
      // 表示中画像の取得失敗はshell更新を巻き戻さない。
    }
  }
  return cached;
}

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
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const data = event.data ?? {};
  if (data.type === "ENABLE_PWA_CACHE") event.waitUntil((async () => {
    try {
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
    const cached = await cacheCardArt(Array.isArray(data.urls) ? data.urls : []);
    reply(event, { ok: true, type: data.type, cached });
  })());
  if (data.type === "GET_PWA_CACHE_STATUS") event.waitUntil((async () => {
    reply(event, { ok: true, type: data.type, enabled: await enabled() });
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
      try {
        const response = await fetch(request);
        if (!response.ok) throw new Error(`navigation failed with ${response.status}`);
        (await caches.open(SHELL_CACHE)).put(request, response.clone());
        return response;
      } catch {
        return (await caches.match(request, { ignoreVary: true })) ?? (await caches.match(new URL("./", self.registration.scope).href, { ignoreVary: true })) ?? Response.error();
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
