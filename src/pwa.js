// The offline copy (PWA, 文豪 2026-11-09: 「推奨案で」): every way the page is opened (a browser tab, an installed app,
// an Android shortcut) puts the shell in the cache (HTML, JS with the card data, CSS, fonts, UI pictures, manifests), then
// every card's art, and asks the browser to keep the storage (navigator.storage.persist). The art is cached by its
// content-hashed name, so a new build fetches only the pictures that changed (sw.js).

function post(registration, type, urls = [], timeoutMs = 5000) {
  const worker = registration.active ?? registration.waiting ?? registration.installing;
  if (!worker) return Promise.resolve({ ok: false, error: "worker unavailable" });
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => resolve({ ok: false, error: "worker response timeout" }), timeoutMs);
    channel.port1.onmessage = (event) => {
      clearTimeout(timeout);
      resolve(event.data ?? { ok: false });
    };
    worker.postMessage({ type, urls }, [channel.port2]);
  });
}

function showUpdateNotice() {
  if (document.querySelector("[data-pwa-update-notice]")) return;
  const notice = document.createElement("aside");
  notice.className = "pwa-update-notice";
  notice.dataset.pwaUpdateNotice = "";
  notice.innerHTML = "<b>更新版を適用できる</b><span>対戦を区切って再読み込みして。</span><button type=\"button\">再読み込み</button>";
  notice.querySelector("button").addEventListener("click", () => location.reload());
  document.body.append(notice);
}

// Storage the browser may clear under pressure unless it is marked to keep. Chrome grants it to an installed or
// often used site without asking; Safari decides by its own rules. The answer is noted, never asked again here.
async function askPersist() {
  try {
    if (!navigator.storage?.persist) return "unsupported";
    if (await navigator.storage.persisted()) return "granted";
    return await navigator.storage.persist() ? "granted" : "denied";
  } catch { return "failed"; }
}

// After the page has loaded, so the first screen's own downloads go first.
const afterLoad = () => new Promise((resolve) => (document.readyState === "complete" ? resolve() : window.addEventListener("load", () => resolve(), { once: true })));

export async function registerPwa() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  try {
    const hadController = Boolean(navigator.serviceWorker.controller);
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) showUpdateNotice();
    }, { once: true });
    await afterLoad();
    await navigator.serviceWorker.ready;
    const enabled = await post(registration, "ENABLE_PWA_CACHE", [], 60000);
    document.documentElement.dataset.pwaCache = enabled.ok ? "ready" : "failed";
    if (!enabled.ok) return;
    document.documentElement.dataset.pwaPersist = await askPersist();
    // Every card's art, once: the worker skips what it already holds.
    document.documentElement.dataset.pwaArt = "loading";
    const art = await post(registration, "CACHE_ALL_CARD_ART", [], 600000);
    document.documentElement.dataset.pwaArt = art.ok && !art.failed ? "ready" : "partial";
  } catch (error) {
    document.documentElement.dataset.pwaCache = "failed";
    console.warn("PWA cache setup failed", error);
  }
}
