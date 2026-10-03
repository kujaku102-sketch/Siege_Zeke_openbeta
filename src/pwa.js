const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

function cardArtUrls() {
  return [...new Set([...document.querySelectorAll("img.card-art-image,img.detail-art-image")].map((image) => image.currentSrc || image.src).filter(Boolean))];
}

function post(registration, type, urls = []) {
  const worker = registration.active ?? registration.waiting ?? registration.installing;
  if (!worker) return Promise.resolve({ ok: false, error: "worker unavailable" });
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => resolve({ ok: false, error: "worker response timeout" }), 5000);
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

export async function registerPwa() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  try {
    const hadController = Boolean(navigator.serviceWorker.controller);
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    if (!isStandalone()) return;
    await navigator.serviceWorker.ready;
    const enabled = await post(registration, "ENABLE_PWA_CACHE");
    document.documentElement.dataset.pwaCache = enabled.ok ? "ready" : "failed";
    if (!enabled.ok) return;
    let queued = false;
    const syncArt = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        void post(registration, "CACHE_CARD_ART", cardArtUrls());
      });
    };
    syncArt();
    new MutationObserver(syncArt).observe(document.querySelector("#app"), { childList: true, subtree: true });
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController) showUpdateNotice();
    }, { once: true });
  } catch (error) {
    document.documentElement.dataset.pwaCache = "failed";
    console.warn("PWA cache setup failed", error);
  }
}
