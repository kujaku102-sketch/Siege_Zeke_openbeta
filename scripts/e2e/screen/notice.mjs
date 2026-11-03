// Screen check: a refused move. The tutorial refuses an off-script placement; the card that was tried shakes where it stands and the refusal's notice sits
// centred just above the hand (its bottom within 5% of the screen height above the hand, its middle within 2px of the screen's middle).
// The refusals are the ones the first tutorial's own script runs into when it is played from its `expect`s (parts/tutorial.mjs); the shake and the notice are read at the
// moment of each refusal (parts/play.mjs). Passes when there was at least one refusal and every one shows what it should: a reason in the guide alone, or the shake and the notice.
import { TUTORIAL_ITEMS } from "../../../src/ui-refresh/tutorial-items.js";
import { openBrowser, assertNoErrors } from "../parts/browser.mjs";
import { makeUi, watchRefusals } from "../parts/play.mjs";
import { playTutorial, startTutorial } from "../parts/tutorial.mjs";

const { browser, errors, newPage } = await openBrowser();
try {
  const seen = [];
  for (const item of TUTORIAL_ITEMS) {
    const page = await newPage({ hook: true, path: "" });
    await watchRefusals(page);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.body.classList.contains("boot-done") && !document.querySelector("#boot-splash"), null, { timeout: 10000 });
    const ui = makeUi(page);
    await startTutorial(page, item.id);
    await playTutorial(page, item.id, { ui });
    seen.push(...ui.refusals.map((r) => ({ tutorial: item.id, ...r })));
    await page.close();
  }
  if (!seen.length) throw new Error("no tutorial move was refused: there is nothing to check the refusal screen on");
  // A refusal the tutorial gives a reason for shows it in the guide only (no notice over it); one without a reason keeps the notice just above the hand.
  const bad = seen.filter((r) => r.guide ? r.notice !== null : !r.notice || r.notice.gap < 0 || r.notice.gap > r.notice.viewportHeight * .05 || Math.abs(r.notice.centre) > 2 || (r.type === "card" && !r.shook));
  if (bad.length) throw new Error(`refusal screens that are wrong: ${JSON.stringify(bad)}`);
  assertNoErrors(errors, "notice");
  console.log(JSON.stringify({ suite: "screen/notice", refusals: seen.length, sample: seen[0], ok: true }));
} finally {
  await browser.close();
}
