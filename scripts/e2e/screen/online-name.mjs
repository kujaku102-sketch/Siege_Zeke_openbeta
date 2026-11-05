// the name asked the first time [オンライン対戦] opens (文豪, 2026-11-05), on the
// curved CRT (effects on; real presses through the bent glass, the public build, no test hook). Needs no server: an
// unreachable ?online= opens the door. Checks: the first open asks for the name; 戻る goes back to the battle setup; an
// empty name is refused with a line saying why, which typing again takes back; the field takes no more than 16; a name of 16 is kept and the door shows it with
// 変更 (no field there); 変更 opens the same screen holding the name, and 戻る goes back to the door; a reload goes straight
// to the door; the content stands in the middle of the glass top to bottom. A browser whose storage refuses to keep the
// name still opens the door, and asks again after a reload.
import { openBrowser, assertNoErrors } from "../parts/browser.mjs";
import { clickEntryControl } from "../parts/entry.mjs";

const { browser, errors, newPage } = await openBrowser();
const CURVE = 0.16;
const path = `?online=${encodeURIComponent("http://127.0.0.1:1")}`;
// A point on the flat page as it shows on the bent glass: the vertex shader's perspective.
async function pressOnGlass(page, x, y) {
  const glass = await page.locator(".r2-flow-crt-viewport").boundingBox();
  const u = (x - glass.x) / glass.width * 2 - 1, v = 1 - (y - glass.y) / glass.height * 2;
  const perspective = 1 / (1 + CURVE * (u * u + v * v));
  await page.mouse.click(glass.x + (1 + u * perspective) * glass.width / 2, glass.y + (1 - v * perspective) * glass.height / 2);
}
async function pressControl(page, selector) {
  const box = await page.locator(selector).first().boundingBox();
  await pressOnGlass(page, box.x + box.width / 2, box.y + box.height / 2);
}
const onGlass = (page, screen) => page.locator(`[data-flow-screen="${screen}"].r2-flow-crt-ready`).waitFor({ timeout: 10000 });
async function typeName(page, name, { save = true } = {}) {
  await pressControl(page, "[data-online-name]");
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  if (name) await page.keyboard.insertText(name);
  if (save) await pressControl(page, "[data-online-name-save]");
}
// How far the content's middle sits from the glass's middle, as a share of the glass's height.
const offCentre = page => page.evaluate(() => {
  const sheet = document.querySelector(".r2-flow-sheet"), frame = sheet.getBoundingClientRect();
  const parts = [...sheet.children].map(child => child.getBoundingClientRect());
  const top = Math.min(...parts.map(part => part.top)), bottom = Math.max(...parts.map(part => part.bottom));
  return +Math.abs((top + bottom) / 2 - (frame.top + frame.height / 2)) / frame.height;
});

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(() => { try { localStorage.setItem("sz-ui-effects", "on"); } catch {} });
  const page = await newPage({ hook: false, path, context });
  await clickEntryControl(page, '[data-flow="open-battle"]');
  await onGlass(page, "battle-setup");
  const centred = { "battle-setup": await offCentre(page) };

  // The first open asks; 戻る goes back to where it was asked from.
  await pressControl(page, '[data-flow="open-online"]');
  await onGlass(page, "online-name");
  if (await page.locator("#r2-flow-online-name-title").innerText() !== "名前の登録") throw new Error("the first open is not 名前の登録");
  centred["online-name"] = await offCentre(page);
  await pressControl(page, "[data-flow-back]");
  await onGlass(page, "battle-setup");
  await pressControl(page, '[data-flow="open-online"]');
  await onGlass(page, "online-name");

  // An empty name is refused, saying why; the field takes no more than 16; 16 is kept.
  await typeName(page, "");
  await page.locator('[data-flow-screen="online-name"] [role="alert"]', { hasText: "名前を入れてください" }).waitFor();
  await typeName(page, "あ".repeat(17), { save: false });
  if (await page.locator('[data-flow-screen="online-name"] [role="alert"], [data-online-name][aria-invalid]').count()) throw new Error("typing again leaves the refusal shown");
  const capped = await page.locator("[data-online-name]").inputValue();
  if ([...capped].length > 16) throw new Error(`the field took ${[...capped].length} characters`);
  const name = "あかね".padEnd(16, "ね");
  await typeName(page, name);
  await onGlass(page, "online-entry");
  centred["online-entry"] = await offCentre(page);
  if (await page.locator(".r2-online-name b").innerText() !== name) throw new Error("the door does not show the kept name");
  if (await page.locator("[data-flow-screen=online-entry] input[data-online-name]").count()) throw new Error("the door still has a name field");

  // 変更 opens the same screen with the name; 戻る goes back to the door.
  await pressControl(page, '[data-flow="change-name"]');
  await onGlass(page, "online-name");
  if (await page.locator("#r2-flow-online-name-title").innerText() !== "名前の変更" || await page.locator("[data-online-name]").inputValue() !== name) throw new Error("変更 does not hold the name");
  await pressControl(page, "[data-flow-back]");
  await onGlass(page, "online-entry");

  // Kept: a reload goes straight to the door.
  await page.reload({ waitUntil: "networkidle" });
  await clickEntryControl(page, '[data-flow="open-battle"]');
  await onGlass(page, "battle-setup");
  await pressControl(page, '[data-flow="open-online"]');
  await onGlass(page, "online-entry");
  for (const [screen, off] of Object.entries(centred)) if (off > .03) throw new Error(`${screen}: the content is ${(off * 100).toFixed(1)}% off the middle`);
  await context.close();

  // A storage that refuses to keep the name: the door still opens, and the name is asked again after a reload.
  const refusing = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await refusing.addInitScript(() => {
    try { localStorage.setItem("sz-ui-effects", "on"); } catch {}
    const keep = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === "sz-online-name") throw new DOMException("refused", "QuotaExceededError"); return keep.call(this, key, value); };
  });
  const shy = await newPage({ hook: false, path, context: refusing });
  await clickEntryControl(shy, '[data-flow="open-battle"]');
  await onGlass(shy, "battle-setup");
  await pressControl(shy, '[data-flow="open-online"]');
  await onGlass(shy, "online-name");
  await typeName(shy, "みどり");
  await onGlass(shy, "online-entry");
  await shy.reload({ waitUntil: "networkidle" });
  await clickEntryControl(shy, '[data-flow="open-battle"]');
  await onGlass(shy, "battle-setup");
  await pressControl(shy, '[data-flow="open-online"]');
  await onGlass(shy, "online-name");
  await refusing.close();

  assertNoErrors(errors, "online-name");
  console.log(JSON.stringify({ suite: "screen/online-name", centred, ok: true }));
} finally {
  await browser.close();
}
