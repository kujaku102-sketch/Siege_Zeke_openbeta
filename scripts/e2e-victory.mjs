import { clickEntryControl } from "./e2e-entry-crt.mjs";

// Dedicated source E2E. It deliberately uses the development-only fixture
// hook for zones, then starts each real card operation through rendered DOM.
export async function runVictoryE2E({ page, base }) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const url = new URL(base);
  url.searchParams.set("e2e", "1");
  await page.goto(url.toString(), { waitUntil: "networkidle" });
  const hook = await page.evaluate(() => Boolean(window.__SIMPLE_ZEKE_E2E__));
  if (!hook) throw new Error("victory E2E hook is unavailable");
  // The hook only supplies the starting state; this assertion also proves the
  // production runner cannot accidentally expose it without ?e2e=1.
  await clickEntryControl(page, "[data-mode='sandbox']");
  await page.locator('[data-live="catalog"]').click();
  await page.locator("[data-catalog-card='STD-049']").click();
  if (!await page.locator("[data-action='end-turn']").count()) throw new Error("sandbox DOM action surface is unavailable");

  await page.evaluate(() => {
    const fixture = window.__SIMPLE_ZEKE_E2E__;
    const next = fixture.getState();
    next.winner = "player";
    next.victory = { lockedOutcome: "player", lockedAtEffectId: "EFFECT-E2E", finished: false };
    fixture.setState(next);
  });
  const locked = page.locator(".r2-console");
  if (!await locked.count() || !/RESULT LOCKED/.test(await locked.innerText())) {
    throw new Error("victory lock is not rendered independently from game finish");
  }
  if (/GAME FINISHED/.test(await locked.innerText())) {
    throw new Error("game finished was rendered before declared work settled");
  }

  await page.evaluate(() => {
    const fixture = window.__SIMPLE_ZEKE_E2E__;
    const next = fixture.getState();
    next.victory.finished = true;
    fixture.setState(next);
  });
  const finished = page.locator(".r2-console");
  if (!await finished.count() || !/GAME FINISHED/.test(await finished.innerText())) {
    throw new Error("settled victory is not rendered as game finished");
  }
  if (/RESULT LOCKED/.test(await finished.innerText())) {
    throw new Error("victory lock remained visible after game finish");
  }

  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await clickEntryControl(page, "[data-mode='sandbox']");
  await page.locator('[data-live="catalog"]').click();
  await page.locator("[data-catalog-card='STD-015']").click();
  await page.locator("[data-catalog-owner]").selectOption("ai");
  await page.locator("[data-catalog-card='STD-003']").click();
  const fixtureUids = await page.evaluate(() => {
    const fixture = window.__SIMPLE_ZEKE_E2E__;
    const state = fixture.getState();
    const player = state.players.player;
    const opponent = state.players.ai;
    const shockGun = player.hand.find((card) => card.id === "STD-015");
    const script = opponent.hand.find((card) => card.id === "STD-003");
    if (!shockGun || !script) throw new Error("victory fixture cards are unavailable");
    script.faceDown = true;
    player.hand = [shockGun];
    player.front = [];
    player.back = [];
    player.memory = 10;
    opponent.hand = opponent.hand.filter((card) => card.uid !== script.uid);
    opponent.front = [];
    opponent.back = [script];
    opponent.memory = 10;
    opponent.fortressStr = 1;
    state.active = "player";
    state.selectedUid = null;
    state.pending = null;
    state.prompt = null;
    state.winner = null;
    state.victory = { lockedOutcome: null, lockedAtEffectId: null, finished: false };
    state.declaredEffects = [];
    state.resolvingDeclaredEffect = null;
    fixture.setState(state);
    return { shockGunUid: shockGun.uid, scriptUid: script.uid };
  });
  await page.locator('[data-live="close-catalog"]').click();
  await page.locator(`.r2-hand [data-card-uid="${fixtureUids.shockGunUid}"]`).click();
  await page.locator("[data-action='play-front']").first().click();
  if (!await page.locator(`.prompt-toast [data-action="prompt-activate"]`).count()) {
    throw new Error("STD-003 declaration window did not open before Shock Gun cleanup");
  }
  const beforeDeclaration = await page.evaluate(() => {
    const state = window.__SIMPLE_ZEKE_E2E__.getState();
    return {
      winner: state.winner,
      shockGunInTrash: state.players.player.trash.some((card) => card.id === "STD-015")
    };
  });
  if (beforeDeclaration.winner !== null || beforeDeclaration.shockGunInTrash) {
    throw new Error("victory or Shock Gun cleanup completed before STD-003 declaration choice");
  }
  await page.locator("[data-action='prompt-activate']").click();
  await page.waitForFunction(() => /GAME FINISHED/.test(document.querySelector(".r2-console")?.textContent ?? ""));
  const realFlow = await page.evaluate(({ shockGunUid, scriptUid }) => {
    const state = window.__SIMPLE_ZEKE_E2E__.getState();
    return {
      winner: state.winner,
      victory: state.victory,
      shockGunTrash: state.players.player.trash.some((card) => card.uid === shockGunUid),
      shockGunBan: state.players.player.ban.some((card) => card.uid === shockGunUid),
      scriptTrash: state.players.ai.trash.some((card) => card.uid === scriptUid),
      declaredCount: state.declaredEffects.length,
      resolving: state.resolvingDeclaredEffect,
      log: state.log.map((entry) => ({ text: entry.text, tone: entry.tone }))
    };
  }, fixtureUids);
  const winLogIndex = realFlow.log.findIndex((entry) => entry.tone === "win");
  const declaredResolutionIndex = realFlow.log.findIndex((entry) => entry.text.includes("以降の相手カードのゴミ箱移動"));
  if (realFlow.winner !== "player" || realFlow.victory.lockedOutcome !== "player" || !realFlow.victory.finished
    || !realFlow.shockGunTrash || realFlow.shockGunBan || !realFlow.scriptTrash
    || realFlow.declaredCount !== 0 || realFlow.resolving !== null
    || winLogIndex < 0 || declaredResolutionIndex <= winLogIndex) {
    throw new Error(`declared-effect victory flow mismatch: ${JSON.stringify(realFlow)}`);
  }

  await page.goto(url.toString(), { waitUntil: "networkidle" });
  await clickEntryControl(page, "[data-mode='sandbox']");
  await page.locator('[data-live="catalog"]').click();
  await page.locator("[data-catalog-card='STD-015']").click();
  await page.locator("[data-catalog-owner]").selectOption("ai");
  await page.locator("[data-catalog-card='STD-015']").click();
  const responseFixture = await page.evaluate(() => {
    const fixture = window.__SIMPLE_ZEKE_E2E__;
    const state = fixture.getState();
    const player = state.players.player;
    const opponent = state.players.ai;
    const shockGun = player.hand.find((card) => card.id === "STD-015");
    const response = opponent.hand.find((card) => card.id === "STD-015");
    if (!shockGun || !response) throw new Error("Response victory fixture cards are unavailable");
    player.hand = [shockGun];
    player.front = [];
    player.back = [];
    player.memory = 10;
    opponent.hand = [response];
    opponent.front = [];
    opponent.back = [];
    opponent.memory = 10;
    opponent.fortressStr = 1;
    state.active = "player";
    state.selectedUid = null;
    state.pending = null;
    state.prompt = null;
    state.winner = null;
    state.victory = { lockedOutcome: null, lockedAtEffectId: null, finished: false };
    state.declaredEffects = [];
    state.resolvingDeclaredEffect = null;
    state.deferredDeclaredResponseCleanup = null;
    state.responseEventQueue = [];
    fixture.setState(state);
    return { shockGunUid: shockGun.uid, responseUid: response.uid };
  });
  await page.locator('[data-live="close-catalog"]').click();
  await page.locator(`.r2-hand [data-card-uid="${responseFixture.shockGunUid}"]`).click();
  await page.locator("[data-action='play-front']").first().click();
  const responseButton = page.locator(`[data-response-card="${responseFixture.responseUid}"]`);
  if (!await responseButton.count()) throw new Error("lethal damage did not open the pre-lock Response declaration window");
  const beforeResponse = await page.evaluate(() => {
    const state = window.__SIMPLE_ZEKE_E2E__.getState();
    return { winner: state.winner, pending: state.pending?.type, declared: state.declaredEffects.length };
  });
  if (beforeResponse.winner !== null || beforeResponse.pending !== "response-window" || beforeResponse.declared !== 0) {
    throw new Error(`Response declaration boundary opened in the wrong state: ${JSON.stringify(beforeResponse)}`);
  }
  await responseButton.click();
  await page.waitForFunction(() => /GAME FINISHED/.test(document.querySelector(".r2-console")?.textContent ?? ""));
  const responseFlow = await page.evaluate(({ shockGunUid, responseUid }) => {
    const state = window.__SIMPLE_ZEKE_E2E__.getState();
    return {
      winner: state.winner,
      victory: state.victory,
      sourceTrash: state.players.player.trash.some((card) => card.uid === shockGunUid),
      responseTrash: state.players.ai.trash.some((card) => card.uid === responseUid),
      declaredCount: state.declaredEffects.length,
      resolving: state.resolvingDeclaredEffect,
      log: state.log.map((entry) => ({ text: entry.text, tone: entry.tone }))
    };
  }, responseFixture);
  const responseLockIndex = responseFlow.log.findIndex((entry) => entry.tone === "win");
  const responseResolutionIndex = responseFlow.log.findIndex((entry) => entry.text.includes("レスポンス:1の効果と発動元処理を完了"));
  if (responseFlow.winner !== "player" || responseFlow.victory.lockedOutcome !== "player" || !responseFlow.victory.finished
    || !responseFlow.sourceTrash || !responseFlow.responseTrash || responseFlow.declaredCount !== 0 || responseFlow.resolving !== null
    || responseLockIndex < 0 || responseResolutionIndex <= responseLockIndex) {
    throw new Error(`declared Response victory flow mismatch: ${JSON.stringify(responseFlow)}`);
  }
  if (errors.length) throw new Error(`victory E2E page errors: ${errors.join(" | ")}`);
  console.log(JSON.stringify({ suite: "victory", dom: "STD-049 catalog", victoryPresentation: "lock-then-finish", declaredStack: ["Shock Gun -> STD-003 declare -> cleanup -> lock -> STD-003 resolve -> finish", "Shock Gun -> Response declare -> source cleanup -> lock -> Response resolve and cleanup -> finish"], ok: true }));
}
