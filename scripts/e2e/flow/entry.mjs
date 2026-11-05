// Flow check: the title's own operations, on the public build with no test hook (real clicks and keys).
// The title links (the one with no address reads 準備中, the one with an address is a link; outside the stage, covering no title control); the tutorial list and the battle setup open and come back by [戻る] and Escape
// (also right after the options window or the deck builder closes); the tutorial list is the one in the data, all unfinished in a cleared browser; the battle
// setup offers deck and user for both sides; the online button opens the name screen, which goes back to the setup.
import { TUTORIAL_ITEMS } from "../../../src/ui-refresh/tutorial-items.js";
import { openBrowser, assertNoErrors } from "../parts/browser.mjs";

async function checkEntryFlow(page) {
  // The links sit in the margin beside the stage; where that margin is narrow (16:10 here) they may
  // reach over the stage's empty corner, but never over the title's buttons or menu, nor off screen.
  const title = await page.evaluate(() => {
    const box = node => node.getBoundingClientRect().toJSON();
    const links = [...document.querySelectorAll(".r2-title-link")].map(link => ({ text: link.textContent, href: link.getAttribute("href"), box: box(link) }));
    const controls = [...document.querySelectorAll(".r2-mode-grid>button, .r2-utilities button")].map(box);
    return { battle: document.querySelector('[data-mode="ai"] strong')?.textContent, links, controls, width: innerWidth, height: innerHeight };
  });
  const meets = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  if (title.battle !== "対戦") throw new Error(`title battle button is not 対戦: ${title.battle}`);
  const unset = title.links.filter(link => link.href === null), set = title.links.filter(link => link.href !== null);
  if (title.links.length !== 2 || unset.length !== 1 || !unset[0].text.includes("準備中") || set.length !== 1 || !set[0].href.startsWith("https://") || set[0].text.includes("準備中")) throw new Error(`title links: one is 準備中 with no address, one has an https address: ${JSON.stringify(title.links)}`);
  if (title.links.some(({ box }) => title.controls.some(control => meets(box, control)) || box.left < 0 || box.top < 0 || box.right > title.width || box.bottom > title.height)) throw new Error(`title links cover a title control or leave the screen: ${JSON.stringify(title)}`);
  await page.locator('[data-mode="tutorial"]').click();
  await page.locator('[data-flow-screen="tutorial-select"]').waitFor({ state: "visible" });
  const items = await page.locator("[data-tutorial-item]").evaluateAll(nodes => nodes.map(node => `${node.dataset.tutorialItem}:${node.dataset.done}`));
  const expected = TUTORIAL_ITEMS.map(item => `${item.id}:false`).join();
  if (items.join() !== expected) throw new Error(`tutorial list is wrong: ${items} (expected ${expected})`);
  const menu = await page.locator(".r2-utilities button").boundingBox();
  if (!menu || menu.width < 44 || menu.height < 44) throw new Error(`flow screen menu is under 44 CSS px: ${JSON.stringify(menu)}`);
  // The options window leaves the focus on <body>: Escape still closes it, and the next Escape goes back.
  await page.locator('.r2-utilities [data-live="options"]').click();
  await page.locator(".r2-title-options").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await page.locator(".r2-title-options").waitFor({ state: "detached" });
  if (!await page.locator('[data-flow-screen="tutorial-select"]').count()) throw new Error("Escape on the options window left the tutorial list");
  await page.keyboard.press("Escape");
  await page.locator(".r2-entry").waitFor({ state: "visible" });
  await page.locator('[data-mode="ai"]').click();
  await page.locator('[data-flow-screen="battle-setup"]').waitFor({ state: "visible" });
  if (await page.locator(".r2-flow select").count() !== 4) throw new Error("battle setup does not offer deck and user for both sides");
  // The server is set on the shipped page, so the button opens the online door; with no name kept, the name screen asks first, and its back goes to the setup.
  if (await page.locator("[data-online-battle]").count() || await page.locator("[data-flow='open-online']").count() !== 1) throw new Error("online battle is not offered as an open button");
  await page.locator("[data-flow='open-online']").click();
  await page.locator('[data-flow-screen="online-name"]').waitFor({ state: "visible", timeout: 5000 });
  await page.locator("[data-flow-back]").click();
  await page.locator('[data-flow-screen="battle-setup"]').waitFor({ state: "visible", timeout: 5000 });
  // Right after the deck builder closes by its button, Escape goes back with no Tab in between.
  await page.locator(".r2-flow [data-deck-open]").click();
  await page.locator("[data-deck-close]").first().click();
  await page.locator("[data-deck-close]").waitFor({ state: "detached" });
  await page.keyboard.press("Escape");
  await page.locator(".r2-entry").waitFor({ state: "visible", timeout: 3000 }).catch(() => { throw new Error("Escape after closing the deck builder did not go back"); });
  await page.locator('[data-mode="ai"]').click();
  await page.locator("[data-flow-back]").click();
  await page.locator(".r2-entry").waitFor({ state: "visible" });
}

const { browser, errors, newPage } = await openBrowser();
try {
  const page = await newPage({ hook: false });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  if (await page.locator('[data-mode="tutorial"], [data-mode="ai"], [data-mode="sandbox"], [data-deck-open]').count() !== 4) throw new Error('the title does not expose the four primary routes');
  await checkEntryFlow(page);
  assertNoErrors(errors, 'entry');
  console.log(JSON.stringify({ suite: 'flow/entry', routes: 4, ok: true }));
} finally { await browser.close(); }
