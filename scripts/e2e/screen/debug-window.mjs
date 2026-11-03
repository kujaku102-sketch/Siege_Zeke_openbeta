// Screen check: the debug window. It opens from the options' デバッグ on the title (HTML menu, CRT menu) and on the board, by real clicks (the CRT row by keyboard, as the
// CRT keeps its HTML controls for that); it counts the memory estimate, closes by its button and by Escape; and it checks the build revision, the error list, the render
// scale (saved here, ?renderScale= wins), the effect speed and the clear-and-reload button.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadPlaywright, readArgs } from "../parts/browser.mjs";
import { clickEntryControl } from "../parts/entry.mjs";
const { module, url } = readArgs();
const { chromium } = await loadPlaywright(module);
const base = new URL(url).origin + "/";
const features = new Set(["version", "errors", "scale", "speed"]);
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const browser = await chromium.launch({ channel: "msedge", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [], results = [];
const debugOpen = (page) => page.locator(".r2-debug[role=dialog]").count();
const inside = (page) => page.evaluate(() => { const r = document.querySelector(".r2-debug>section").getBoundingClientRect(); return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; });
async function checkWindow(page, name, extra) {
  await page.locator(".r2-debug [data-memory-estimate] [data-memory-row='total']").waitFor({ timeout: 15000 });
  const r = { name, open: await debugOpen(page) === 1, optionsClosed: await page.locator('[role=dialog][aria-label="オプション"]').count() === 0, inside: await inside(page) };
  r.memoryTotal = await page.locator("[data-memory-row='total'] td").first().textContent();
  if (extra) Object.assign(r, await extra(page));
  await page.locator("[data-debug-close]").click();
  r.closedByButton = await debugOpen(page) === 0;
  return r;
}
const ctxs = {
  pc: { viewport: { width: 1920, height: 1080 } },
  iphone: { viewport: { width: 932, height: 430 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE }
};
async function openPage(ctx, query, init) {
  const context = await browser.newContext(ctxs[ctx]);
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  page.on("pageerror", (e) => { if (!/e2e-probe/.test(e.message)) errors.push(`${ctx}${query}: ${e.message}`); });
  page.on("dialog", (d) => (page.acceptDialog ? d.accept() : d.dismiss()));
  await page.goto(base + query, { waitUntil: "networkidle" });
  await page.locator("#boot-splash").waitFor({ state: "detached", timeout: 15000 });
  return page;
}
const extras = [];
const manifestFile = path.resolve("dist", "release-manifest.json"); // run from the repository root, as the gate does
const expectedRevision = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")).release.buildRevision : null;
if (features.has("errors")) extras.push(async (page) => {
  await page.evaluate(() => { for (let i = 0; i < 53; i += 1) setTimeout(() => { throw new Error(`e2e-probe ${i}`); }, 0); setTimeout(() => { Promise.reject(new Error("e2e-probe rejected")); }, 5); });
  await page.waitForFunction(() => document.querySelectorAll("[data-error-entry]").length === 50, null, { timeout: 5000 }).catch(() => {});
  const list = await page.evaluate(() => ({ shown: document.querySelectorAll("[data-error-entry]").length, head: document.querySelector("[data-debug-errors] h3")?.textContent, first: document.querySelector("[data-error-entry]")?.textContent ?? "", note: document.querySelector("[data-debug-errors] p")?.textContent ?? "" }));
  await page.locator("[data-error-copy]").click();
  const copied = await page.locator("[data-error-copied]").textContent({ timeout: 3000 }).catch(() => null);
  return { errorList: list, copied, ok_errors: list.shown === 50 && /54件/.test(list.head) && /unhandledrejection/.test(list.first) && /メモリ不足でページが落とされたときは残らない/.test(list.note) && copied === "コピーした" };
});
if (features.has("scale")) extras.push(async (page) => {
  const compat = await page.evaluate(() => document.querySelector("[data-debug-render-scale]") && /軽量表示では変わらない/.test(document.querySelector("[data-debug-render-scale]").textContent));
  const mode = await page.evaluate(() => ({ lowGpu: Boolean(document.querySelector(".live-low-gpu")) || /render=compat/.test(location.search) || /iPhone/.test(navigator.userAgent), board: Boolean(document.querySelector(".wf-board-model")) }));
  await page.locator("[data-render-scale=\"2\"]").click();
  const saved = await page.evaluate(() => localStorage.getItem("sz-ui-render-scale"));
  const checked = await page.locator("[data-render-scale=\"2\"]").getAttribute("aria-checked");
  let canvas = null;
  if (mode.board && !mode.lowGpu) {
    await page.locator("[data-debug-close]").click();
    await page.waitForFunction(() => { const c = document.querySelector(".wf-board-model"), r = c?.getBoundingClientRect(); return c && r.width && Math.abs(c.width - Math.round(r.width * 2)) <= 1; }, null, { timeout: 8000 }).catch(() => {});
    canvas = await page.evaluate(() => { const c = document.querySelector(".wf-board-model"), r = c.getBoundingClientRect(); return { buffer: c.width, css: Math.round(r.width), rendered: c.closest(".wire-board-host")?.classList.contains("wf-has-model") }; });
    await page.locator("[data-runtime-menu]").click();
    await page.locator(".runtime-host-options [data-debug-open]").click();
    await page.locator(".r2-debug [data-memory-estimate] [data-memory-row=\"total\"]").waitFor({ timeout: 15000 });
  }
  return { scale: { compatNote: compat, mode, saved, checked, canvas }, ok_scale: saved === "2" && checked === "true" && compat === mode.lowGpu && (!canvas || (canvas.buffer === canvas.css * 2 && canvas.rendered)) };
});
if (features.has("version")) extras.push(async (page) => { const shown = await page.locator("[data-build-revision]").textContent({ timeout: 3000 }).catch(() => null); return { revision: shown, ok_version: Boolean(expectedRevision) && shown === expectedRevision }; });
const extra = async (page) => { const out = {}; for (const fn of extras) Object.assign(out, await fn(page, features)); return out; };
try {
  { // Title, HTML menu (compat iPhone).
    const page = await openPage("iphone", "");
    await page.locator('.r2-utilities [data-live="options"]').click();
    await page.locator(".r2-title-options [data-debug-open]").click();
    results.push(await checkWindow(page, "title html menu (iphone compat)", extra));
    await page.close();
  }
  { // Title, CRT menu (full, effects on).
    const page = await openPage("pc", "?render=full", () => localStorage.setItem("sz-ui-effects", "on"));
    const crt = await page.locator(".r2-entry-crt-ready").count();
    await clickEntryControl(page, '.r2-utilities [data-live="options"]');
    await page.locator(".r2-title-options [data-debug-open]").focus();
    await page.keyboard.press("Enter");
    const r = await checkWindow(page, `title crt menu (pc full, crt ready: ${crt === 1})`, extra);
    r.crt = crt === 1;
    // Escape closes the window too.
    await clickEntryControl(page, '.r2-utilities [data-live="options"]');
    await page.locator(".r2-title-options [data-debug-open]").focus();
    await page.keyboard.press("Enter");
    await page.locator(".r2-debug").waitFor();
    await page.keyboard.press("Escape");
    r.closedByEscape = await debugOpen(page) === 0;
    results.push(r);
    await page.close();
  }
  for (const [ctx, query] of [["pc", "?render=compat"], ["pc", "?render=full"], ["iphone", ""]]) { // The board.
    const page = await openPage(ctx, query);
    await clickEntryControl(page, '[data-mode="ai"]');
    await page.locator('[data-start="ai"]').click();
    await page.locator(".wire-board .slot").first().waitFor({ state: "attached", timeout: 15000 });
    await page.locator("[data-runtime-menu]").click();
    await page.locator(".runtime-host-options [data-debug-open]").click();
    results.push(await checkWindow(page, `board ${ctx}${query}`, extra));
    await page.close();
  }
  if (features.has("scale")) { // ?renderScale= wins over the saved choice and says so.
    const page = await openPage("pc", "?render=full&renderScale=0.5", () => localStorage.setItem("sz-ui-render-scale", "2"));
    await page.locator('.r2-utilities [data-live="options"]').click();
    await page.locator(".r2-title-options [data-debug-open]").click();
    const note = await page.locator("[data-debug-render-scale]").textContent();
    results.push({ name: "render scale url wins", note, open: true, optionsClosed: true, inside: true, closedByButton: true, memoryTotal: "MB", ok_url: /URL の指定（\?renderScale=0\.5）が優先中/.test(note) && !/軽量表示では変わらない/.test(note) });
    await page.close();
  }
  if (features.has("speed")) { // ×2 halves the turn banner's life and runs CSS / WAAPI animations at playbackRate 2; ×1 restores.
    const page = await openPage("pc", "?render=full", () => localStorage.setItem("sz-ui-effects", "on"));
    await page.evaluate(() => { window.__banners = []; new MutationObserver((list) => { for (const m of list) { for (const n of m.addedNodes) if (n.classList?.contains("fx-turn-banner")) window.__banners.push({ n, from: performance.now() }); for (const n of m.removedNodes) { const b = window.__banners.find((x) => x.n === n); if (b) b.life = performance.now() - b.from; } } }).observe(document.body, { childList: true, subtree: true }); });
    await clickEntryControl(page, '[data-mode="ai"]');
    await page.locator('[data-start="ai"]').click();
    await page.locator(".wire-board .slot").first().waitFor({ state: "attached", timeout: 15000 });
    const endTurn = async (n) => { await page.locator("[data-runtime-end-turn]").click(); await page.waitForFunction((t) => { const b = document.querySelector("[data-runtime-end-turn]"); return b?.dataset.turnSide === "mine" && b.dataset.turn === String(t) && !b.disabled; }, n, { timeout: 30000 }); await page.waitForTimeout(3000); };
    const lives = async () => page.evaluate(() => { const l = window.__banners.filter((b) => b.life).map((b) => Math.round(b.life)); window.__banners = []; return l; });
    await endTurn(2); const at1 = await lives();
    await page.locator("[data-runtime-menu]").click();
    await page.locator(".runtime-host-options [data-debug-open]").click();
    await page.locator("[data-fx-speed=\"2\"]").click();
    const rate = await page.evaluate(async () => { const a = document.body.animate([{ opacity: 1 }, { opacity: 1 }], { duration: 10000 }); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const v = a.playbackRate; a.cancel(); return v; });
    const saved = await page.evaluate(() => localStorage.getItem("sz-ui-fx-speed"));
    await page.locator("[data-debug-close]").click();
    await endTurn(3); const at2 = await lives();
    const avg = (l) => l.reduce((s, v) => s + v, 0) / (l.length || 1);
    results.push({ name: "effect speed x2", bannersAt1: at1, bannersAt2: at2, rate, saved, open: true, optionsClosed: true, inside: true, closedByButton: true, memoryTotal: "MB",
      ok_speed: at1.length > 0 && at2.length > 0 && rate === 2 && saved === "2" && avg(at2) / avg(at1) > .4 && avg(at2) / avg(at1) < .65 });
    await page.close();
  }
  if (features.has("version")) { // 保存したファイルを消して読み直す: dismissed does nothing; accepted unregisters and deletes, then reloads.
    const page = await openPage("pc", "?render=compat");
    await page.evaluate(async () => { const probe = "sz-e2e-probe"; await caches.open(probe); const original = ServiceWorkerRegistration.prototype.unregister; ServiceWorkerRegistration.prototype.unregister = function () { sessionStorage.setItem("e2e-unregistered", String(Number(sessionStorage.getItem("e2e-unregistered") ?? 0) + 1)); return original.call(this); }; });
    const workers = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
    await page.locator('.r2-utilities [data-live="options"]').click();
    await page.locator(".r2-title-options [data-debug-open]").click();
    await page.locator("[data-debug-clear-reload]").click();
    await page.waitForTimeout(500);
    const kept = await page.evaluate(async () => ({ cache: await caches.has("sz-e2e-probe"), open: Boolean(document.querySelector(".r2-debug")) }));
    page.acceptDialog = true;
    await Promise.all([page.waitForEvent("load", { timeout: 15000 }), page.locator("[data-debug-clear-reload]").click()]);
    const after = await page.evaluate(async () => ({ cache: await caches.has("sz-e2e-probe"), unregistered: Number(sessionStorage.getItem("e2e-unregistered") ?? 0), debugOpen: Boolean(document.querySelector(".r2-debug")) }));
    results.push({ name: "clear and reload", workersBefore: workers, dismissedKept: kept, after, open: true, optionsClosed: true, inside: true, closedByButton: true, memoryTotal: "MB",
      ok_clear: workers >= 1 && kept.cache && kept.open && !after.cache && after.unregistered === workers && !after.debugOpen });
    await page.close();
  }
} finally { await browser.close(); }
const ok = !errors.length && results.every((r) => r.open && r.optionsClosed && r.inside && r.closedByButton && r.closedByEscape !== false && /MB/.test(r.memoryTotal) && r.crt !== false && Object.entries(r).every(([k, v]) => !k.startsWith("ok_") || v === true));
console.log(JSON.stringify({ suite: "screen/debug-window", features: [...features], results, errors, ok }, null, 1));
process.exit(ok ? 0 : 1);
