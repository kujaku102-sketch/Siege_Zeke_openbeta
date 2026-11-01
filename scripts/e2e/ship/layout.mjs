// Ship check: the title lays out at three PC sizes (no sideways overflow, content has width, the controls are there), the visual-effects
// setting never changes the game state, and reduced motion leaves the state alone and shortens the animation. Run by release:gate only.
// The card used for the effects check is the first one the sandbox catalog lists; no card is named here.
import { openBrowser } from "../parts/browser.mjs";
import { clickEntryControl } from "../parts/entry.mjs";

const VIEWPORTS = [{ label: "1920x1080", width: 1920, height: 1080 }, { label: "1440x900", width: 1440, height: 900 }, { label: "1280x720", width: 1280, height: 720 }];
const { browser, base, errors } = await openBrowser();

const firstDifference = (left, right, prefix = "state") => {
  if (Object.is(left, right)) return null;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return { path: prefix, left, right };
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) { const found = firstDifference(left[key], right[key], `${prefix}.${key}`); if (found) return found; }
  return null;
};

async function stateAfterCatalogAdd(effectsEnabled) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript((enabled) => {
    localStorage.setItem("sz-ui-effects", enabled ? "on" : "off");
    let seed = 0x5a17; Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x100000000);
    let now = 1700000000000; Date.now = () => now++;
  }, effectsEnabled);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const target = new URL(base); target.searchParams.set("e2e", "1");
  await page.goto(target.toString(), { waitUntil: "networkidle" });
  await clickEntryControl(page, '[data-mode="sandbox"]');
  await page.locator("[data-runtime-menu]").click();
  await page.locator("[data-catalog-open]").click();
  const before = await page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.query("player").value);
  const card = page.locator("[data-catalog-card]").first();
  const cardId = await card.getAttribute("data-catalog-card");
  await card.click();
  const result = await page.evaluate(({ before, cardId }) => {
    const after = window.__SIMPLE_ZEKE_E2E__.query("player").value;
    const seat = (state, id) => state.observation.seats.find((item) => item.seatId === id);
    const count = (state) => seat(state, "player").hand.cards.filter((c) => !c.faceDown && c.definition.id === cardId).length;
    return { state: { activeSeat: after.status.activeSeat, progress: after.status.progress, revisionDelta: after.status.revision - before.status.revision,
      handDelta: seat(after, "player").hand.count - seat(before, "player").hand.count, addedCardDelta: count(after) - count(before),
      playerMemoryDelta: seat(after, "player").memory.current - seat(before, "player").memory.current, aiMemoryDelta: seat(after, "ai").memory.current - seat(before, "ai").memory.current },
      effectsSetting: localStorage.getItem("sz-ui-effects") };
  }, { before, cardId });
  await context.close();
  return result;
}

try {
  const viewports = [];
  const context = await browser.newContext();
  for (const viewport of VIEWPORTS) {
    const page = await context.newPage();
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    page.on("pageerror", (error) => errors.push(`${viewport.label} pageerror: ${error.message}`));
    await page.goto(base.toString(), { waitUntil: "networkidle" });
    const layout = await page.evaluate(() => ({
      documentOverflowX: document.documentElement.scrollWidth - innerWidth,
      contentWidth: document.querySelector(".r2-content")?.getBoundingClientRect().width ?? 0,
      controls: document.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled])").length
    }));
    if (layout.documentOverflowX > 1 || layout.contentWidth <= 0 || layout.controls < 4) throw new Error(`${viewport.label} layout gate failed: ${JSON.stringify(layout)}`);
    viewports.push({ ...viewport, ...layout });
    await page.close();
  }
  await context.close();

  const effectsOn = await stateAfterCatalogAdd(true);
  const effectsOff = await stateAfterCatalogAdd(false);
  if (effectsOn.effectsSetting !== "on" || effectsOff.effectsSetting !== "off" || JSON.stringify(effectsOn.state) !== JSON.stringify(effectsOff.state)) {
    throw new Error(`visual effects setting changed the game state or was not kept: ${JSON.stringify({ on: effectsOn.effectsSetting, off: effectsOff.effectsSetting, difference: firstDifference(effectsOn.state, effectsOff.state) })}`);
  }

  const reduced = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: "reduce" });
  reduced.on("pageerror", (error) => errors.push(error.message));
  const target = new URL(base); target.searchParams.set("e2e", "1");
  await reduced.goto(target.toString(), { waitUntil: "networkidle" });
  await clickEntryControl(reduced, '[data-mode="sandbox"]');
  const motion = await reduced.evaluate(() => {
    const before = JSON.stringify(window.__SIMPLE_ZEKE_E2E__.query("player").value);
    const chip = document.createElement("div"); chip.className = "vfx-event-chip"; document.body.append(chip);
    const reducedDuration = getComputedStyle(chip).animationDuration; chip.remove();
    return { stateUnchanged: before === JSON.stringify(window.__SIMPLE_ZEKE_E2E__.query("player").value), reducedDuration };
  });
  await reduced.close();
  if (!motion.stateUnchanged || !(Number.parseFloat(motion.reducedDuration) <= 0.00002)) throw new Error(`reduced motion failed: ${JSON.stringify(motion)}`);
  if (errors.length) throw new Error(`page errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ suite: "ship/layout", viewports, effectsStateParity: true, reducedMotion: true, ok: true }));
} finally {
  await browser.close();
}
