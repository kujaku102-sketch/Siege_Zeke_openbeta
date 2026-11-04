// Proposed e2e for sz-qa (scripts/e2e/screen/tall-window.mjs): a PC window taller than wide (文豪, 2026-11-04, x).
//   title     the title and its menus stay usable: no message
//   tutorial  the tutorial asks for a landscape window (「窓を横長にしてください」) and waits under it (its content inert)
//   back      made landscape again, the message goes and the tutorial goes on from where it was ([次へ] moves the guide)
//   phone     a phone held upright still asks to turn the device, on the title too
import { openBrowser, assertNoErrors } from "../parts/browser.mjs";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const { browser, errors, newPage, pageUrl } = await openBrowser();
const state = (page) => page.evaluate(() => {
  const r = document.querySelector(".r2-rotate"), c = document.querySelector(".r2-content"), shown = (s) => Boolean(r?.querySelector(s)?.getClientRects().length);
  return { prompt: Boolean(r && !r.hidden), window: shown(".r2-rotate-window"), device: shown(".r2-rotate-device"), text: r && !r.hidden ? r.innerText.replace(/\s+/g, " ").trim() : "",
    inert: Boolean(c?.inert), step: document.querySelector(".live-guide")?.dataset.tutorialStep ?? null };
});
const booted = (page) => page.waitForFunction(() => document.body.classList.contains("boot-done") && !document.querySelector("#boot-splash"), null, { timeout: 15000 });
const failures = [];
const expect = (ok, what, seen) => { if (!ok) failures.push(`${what}: ${JSON.stringify(seen)}`); };
try {
  const pc = await newPage({ viewport: { width: 1080, height: 1920 } });
  await booted(pc);
  const title = await state(pc);
  expect(!title.prompt && !title.inert, "title in a tall window: no message", title);
  await pc.evaluate(() => window.__SIMPLE_ZEKE_E2E__.start("tutorial", "basics", 1));
  await pc.waitForFunction(() => !document.querySelector(".r2-rotate")?.hidden, null, { timeout: 5000 }).catch(() => {});
  const tall = await state(pc);
  expect(tall.prompt && tall.window && !tall.device && tall.inert && tall.text.startsWith("窓を横長にしてください"), "tutorial in a tall window asks for a landscape window", tall);
  await pc.setViewportSize({ width: 1920, height: 1080 });
  await pc.waitForFunction(() => document.querySelector(".r2-rotate")?.hidden, null, { timeout: 5000 }).catch(() => {});
  const wide = await state(pc);
  expect(!wide.prompt && !wide.inert && wide.step === tall.step, "landscape again: the message goes, the tutorial where it was", { tall: tall.step, wide });
  await pc.locator(".live-guide :is([data-runtime-tutorial-next],[data-runtime-guide-next])").first().click();
  await pc.waitForFunction((was) => document.querySelector(".live-guide")?.dataset.tutorialStep !== was, wide.step, { timeout: 5000 }).catch(() => {});
  const next = await state(pc);
  expect(next.step && next.step !== wide.step, "landscape again: [次へ] moves the guide on", { from: wide.step, to: next.step });
  await pc.context().close();

  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE });
  const phone = await newPage({ context: ctx });
  await booted(phone);
  const upright = await state(phone);
  expect(upright.prompt && upright.device && !upright.window && upright.text.startsWith("端末を横向きにしてください"), "a phone held upright asks to turn the device", upright);
  await ctx.close();
  assertNoErrors(errors, "tall-window");
} finally { await browser.close(); }
if (failures.length) { console.log(JSON.stringify({ suite: "screen/tall-window", failures, ok: false })); process.exitCode = 1; }
else console.log(JSON.stringify({ suite: "screen/tall-window", ok: true }));
