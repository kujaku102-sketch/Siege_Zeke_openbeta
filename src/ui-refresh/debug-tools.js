// The debug window's version and its 保存したファイルを消して読み直す (文豪, 2026-11-04).

// The release this page runs: release-manifest.json read once as the page starts (with the shell cache on, the copy
// cached with the running files). A dev server or a plain vite build has none.
export async function loadBuildRevision(fetchImpl = globalThis.fetch, url = '/release-manifest.json') {
  try {
    const response = await fetchImpl(url, { cache: 'no-cache' });
    const revision = response.ok ? (await response.json())?.release?.buildRevision : null;
    return typeof revision === 'string' && revision ? { revision } : { revision: null };
  } catch { return { revision: null }; }
}

// Unregisters every service worker of this site and deletes every cache; saved settings and logs (localStorage) stay.
export async function clearSavedFiles(workers = globalThis.navigator?.serviceWorker, cacheStorage = globalThis.caches) {
  const registrations = workers?.getRegistrations ? await workers.getRegistrations() : [];
  for (const registration of registrations) await registration.unregister();
  const names = cacheStorage ? await cacheStorage.keys() : [];
  for (const name of names) await cacheStorage.delete(name);
  return { workers: registrations.length, caches: names.length };
}

const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
// The page's words, shared with the CRT menu's drawing of it.
export const BUILD_TEXT = Object.freeze({ loading: '読み込み中…', none: '読めない（release-manifest.json がない、または読めなかった）', note: 'このページを開いたときに読んだ release-manifest.json の値。',
  clear: '保存したファイルを消して読み直す', clearNote: 'service worker の登録を外し、キャッシュ（caches）を消してから読み直す。設定や対戦ログなど、このブラウザに保存した値は消さない。押すと確認が1回出る。' });
// build: undefined while the manifest is read, else { revision } (null when there is none).
export function buildHtml(build) {
  const value = build === undefined ? BUILD_TEXT.loading : build.revision ? `<code data-build-revision>${esc(build.revision)}</code>` : BUILD_TEXT.none;
  return `<section class="r2-debug-part" data-debug-build aria-label="版"><h3>版</h3><p>buildRevision：${value}</p><p>${BUILD_TEXT.note}</p><button data-debug-clear-reload>${BUILD_TEXT.clear}</button><p>${BUILD_TEXT.clearNote}</p></section>`;
}
