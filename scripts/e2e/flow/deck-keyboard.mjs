// Flow check: the sandbox card add and the deck builder by keyboard only (Tab to the control, Enter to press it, a committed text input as an IME would give).
// Passes when the typed catalog search finds the card and Enter adds it to the player's hand (one more card), the recommender fills a deck and Enter saves it
// (exactly one saved deck), and the deck dialog closes by its own button. On a flat board (3D transforms off) the same add works by a click.
// The card is the first one the catalog lists; no card is named here.
import { openBrowser, assertNoErrors } from "../parts/browser.mjs";
import { clickEntryControl } from "../parts/entry.mjs";

const { browser, errors, newPage } = await openBrowser();
const handCount = (page) => page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.query("player").value.observation.seats.find((seat) => seat.seatId === "player").hand.count);

async function tabFocus(page, selector) {
  const targets = page.locator(selector);
  for (let attempt = 0; attempt < 700; attempt += 1) {
    await page.keyboard.press("Tab");
    if (!await targets.evaluateAll((nodes) => nodes.some((node) => node === document.activeElement && node.getClientRects().length > 0))) continue;
    const visible = await page.evaluate(() => { const style = getComputedStyle(document.activeElement); return Number.parseFloat(style.outlineWidth) > 0 || style.boxShadow !== "none"; });
    if (!visible) throw new Error(`keyboard focus is not visible: ${selector}`);
    return;
  }
  throw new Error(`keyboard target is not reachable by Tab: ${selector}`);
}
const tabActivate = async (page, selector) => { await tabFocus(page, selector); await page.keyboard.press("Enter"); };

try {
  const page = await newPage();
  await page.waitForFunction(() => document.body.classList.contains("boot-done") && !document.querySelector("#boot-splash"), null, { timeout: 15000 });
  await tabActivate(page, '[data-mode="sandbox"]');
  await tabActivate(page, "[data-runtime-menu]");
  await tabActivate(page, "[data-catalog-open]");
  const cardId = await page.locator("[data-catalog-card]").first().getAttribute("data-catalog-card");
  const before = await handCount(page);
  await tabFocus(page, "[data-catalog-query]");
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText(cardId); // one committed text operation, as a Japanese IME commit re-renders after input
  await tabActivate(page, `[data-catalog-card="${cardId}"]`);
  const after = await handCount(page);
  if (after !== before + 1) throw new Error(`keyboard sandbox add failed: ${before} -> ${after}`);
  await tabActivate(page, '[data-live="close-catalog"]');
  await tabActivate(page, "[data-runtime-menu]");
  await tabActivate(page, "[data-deck-open]");
  await tabActivate(page, "[data-deck-auto-build]");
  await tabActivate(page, "[data-deck-recommend]");
  await tabActivate(page, "[data-deck-save]");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("simple-zeke.saved-decks.v1") ?? "[]").length);
  if (saved !== 1) throw new Error(`keyboard deck save failed: ${saved}`);
  await tabActivate(page, "[data-deck-close]");
  if (await page.locator(".deck-builder-modal").count()) throw new Error("keyboard deck dialog close failed");
  await page.close();

  const flat = await newPage({ viewport: { width: 1280, height: 720 } });
  await flat.addStyleTag({ content: ".battle-board,.battle-board *,.wire-board-host,.wire-board-host * { transform: none !important; perspective: none !important; }" });
  await clickEntryControl(flat, '[data-mode="sandbox"]');
  await flat.locator("[data-runtime-menu]").click();
  await flat.locator("[data-catalog-open]").click();
  const flatBefore = await handCount(flat);
  await flat.locator("[data-catalog-card]").first().click();
  const flatResult = { after: await handCount(flat), transform: await flat.evaluate(() => getComputedStyle(document.querySelector(".wire-board-host")).transform) };
  if (flatResult.transform !== "none" || flatResult.after !== flatBefore + 1) throw new Error(`flat board operation failed: ${JSON.stringify({ flatBefore, ...flatResult })}`);
  assertNoErrors(errors, "deck-keyboard");
  console.log(JSON.stringify({ suite: "flow/deck-keyboard", sandboxCardAdd: true, deckSave: true, dialogClose: true, flatBoardAdd: true, ok: true }));
} finally {
  await browser.close();
}
