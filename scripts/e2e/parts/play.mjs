// Playing a match the way a person does: find the control, press it, answer what the match asks. Shared by the flow e2es.
//   const ui = makeUi(page, { keyboard });   ui.click(selector)   ui.read()   ui.action(type, cardId, preference)   ui.settle()   ...
// The match is read through the test-mode hook (?e2e=1): query() gives the legal actions and the open choice; the controls are pressed on the page.
// No card is named here: callers pass the card an action is about (a tutorial gets it from its script, a match from what is legal now).
import { validSelectionAnswer } from "../../../src/game/runtime/selection-contract.js";

const SLOT_POINTS = [[.5, .5], [.5, .18], [.2, .18], [.8, .18], [.18, .5], [.82, .5], [.5, .82], [.2, .82], [.8, .82]];

export function cardsOf(query) {
  const output = []; const visit = (card) => { output.push(card); if (!card.faceDown) card.mounted.forEach(visit); };
  for (const seat of query.observation.seats) for (const zone of ["hand", "front", "back", "registry", "trash", "ban"]) seat[zone].cards?.forEach(visit);
  return output;
}

export function answerFor(request, query, preference = {}, hidden = new Set(), skip = () => false) {
  const preferred = request.options.filter((option) => (!preference.zone || !option.zone || option.zone === preference.zone)
    && (!preference.targetId || !(option.cardRef ?? option.hostRef) || cardsOf(query).some((card) => card.cardRef === (option.cardRef ?? option.hostRef) && !card.faceDown && card.definition.id === preference.targetId))
    && (!preference.cardId || option.preview?.definitionId === preference.cardId)
    && (!preference.user || option.kind !== "card")
    && (!preference.cardOnly || Boolean(option.cardRef ?? option.hostRef))
    && (!preference.scope || !option.label || option.label.includes(preference.scope)));
  const others = request.options.filter((option) => !preferred.includes(option)); const shown = (option) => !hidden.has(option.optionId);
  const ordered = [...preferred.filter(shown), ...preferred.filter((option) => !shown(option)), ...others.filter(shown), ...others.filter((option) => !shown(option))];
  const selected = [];
  const search = (start, count) => {
    if (!count) { const answer = { requestId: request.requestId, optionIds: [...selected], allocation: [] }; return validSelectionAnswer(request, answer) && !skip(answer) ? answer : null; }
    for (let index = start; index <= ordered.length - count; index += 1) { selected.push(ordered[index].optionId); const found = search(index + 1, count - 1); selected.pop(); if (found) return found; }
    return null;
  };
  if (request.constraints.kind === "allocation") {
    const option = ordered[0]; const answer = { requestId: request.requestId, optionIds: option ? [option.optionId] : [], allocation: option ? [{ optionId: option.optionId, amount: request.constraints.total }] : [] };
    if (validSelectionAnswer(request, answer) && !skip(answer)) return answer;
  }
  for (let count = Math.max(request.constraints.minimum ?? 0, preference.pick ? 1 : 0); count <= Math.min(request.constraints.maximum ?? 0, ordered.length); count += 1) { const found = search(0, count); if (found) return found; }
  throw new Error(`no valid safe selection: ${request.presentationKey}`);
}

export function makeUi(page, { keyboard = false } = {}) {
  // What the screen showed at each refused move (see attemptOnce): the notice's text and place, and whether the card shook (window.__refusedShakes, kept by watchRefusals).
  const refusals = [];
  const read = () => page.evaluate(() => window.__SIMPLE_ZEKE_E2E__.query());
  const query = async () => { const result = await read(); if (!result.ok) throw new Error(JSON.stringify(result)); return result.value; };

  async function click(selector) {
    if (keyboard) {
      for (let index = 0; index < 500; index += 1) {
        await page.keyboard.press("Tab");
        if (!await page.locator(selector).evaluateAll((nodes) => nodes.some((node) => node === document.activeElement && node.getClientRects().length))) continue;
        if (!await page.evaluate(() => { const style = getComputedStyle(document.activeElement); return parseFloat(style.outlineWidth) > 0 || style.boxShadow !== "none"; })) throw new Error(`keyboard focus invisible: ${selector}`);
        await page.keyboard.press("Enter"); return;
      }
      throw new Error(`keyboard target unreachable: ${selector}`);
    }
    const locator = page.locator(selector);
    for (let index = 0; index < await locator.count(); index += 1) if (await locator.nth(index).isVisible()) {
      const control = locator.nth(index); await control.scrollIntoViewIfNeeded(); await control.focus();
      const point = await control.evaluate((node, selector) => { const rect = node.getBoundingClientRect(); return [[.5, .5], [.5, .18], [.2, .18], [.8, .18], [.18, .5], [.82, .5], [.5, .82], [.2, .82], [.8, .82]]
        .map(([rx, ry]) => ({ x: rect.left + rect.width * rx, y: rect.top + rect.height * ry }))
        .find(({ x, y }) => document.elementFromPoint(x, y)?.closest(selector) === node) ?? null; }, selector);
      if (point) { await page.mouse.click(point.x, point.y); return; }
    }
    throw new Error(`visible target unavailable: ${selector}`);
  }

  // A card just drawn or added flies in hidden while effects are on: wait until it lands, as a player would.
  const cardShown = (selector) => page.locator(selector).first().waitFor({ state: "visible", timeout: 4000 }).catch(() => { throw new Error(`card never shown: ${selector}`); });

  async function pick(option, q) {
    const listed = page.locator(`[data-option-id="${option.optionId}"]`);
    for (let index = 0; index < await listed.count(); index += 1) if (await listed.nth(index).isVisible()) return click(`[data-option-id="${option.optionId}"]`);
    if (option.cardRef ?? option.hostRef) return click(`[data-card-ref="${option.cardRef ?? option.hostRef}"]`);
    if (option.zone && Number.isSafeInteger(option.slot)) {
      const selector = `.board-slot[data-seat="${option.seatId ?? q.status.viewerSeat}"][data-zone="${option.zone}"][data-slot="${option.slot}"]`;
      for (let attempt = 0; ; attempt += 1) {
        try { return await click(selector); }
        catch (error) { if (attempt >= 8 || !String(error.message).startsWith("visible target unavailable")) throw error; await page.waitForTimeout(200); }
      }
    }
    if (option.kind === "user" || option.targetKind === "user") return click(`[data-fortress="${option.seatId}"]`);
    throw new Error(`no control for option ${JSON.stringify(option)}`);
  }

  async function hiddenSlots(request, q) {
    const slots = request.options.filter((option) => option.zone && Number.isSafeInteger(option.slot) && !(option.cardRef ?? option.hostRef))
      .map((option) => ({ id: option.optionId, selector: `.board-slot[data-seat="${option.seatId ?? q.status.viewerSeat}"][data-zone="${option.zone}"][data-slot="${option.slot}"]` }));
    if (!slots.length) return new Set();
    return new Set(await page.evaluate(({ slots, points }) => slots.filter(({ selector }) => {
      const node = document.querySelector(selector); if (!node) return true; const rect = node.getBoundingClientRect();
      return !points.some(([x, y]) => document.elementFromPoint(rect.left + rect.width * x, rect.top + rect.height * y)?.closest(selector) === node);
    }).map((slot) => slot.id), { slots, points: SLOT_POINTS }));
  }

  async function choose(request, q, preference, path = [], refused = new Set()) {
    const answer = answerFor(request, q, preference, await hiddenSlots(request, q), (candidate) => refused.has(JSON.stringify([...path, candidate.optionIds])));
    for (const id of answer.optionIds) await pick(request.options.find((option) => option.optionId === id), q);
    for (const row of answer.allocation) await page.locator(`[data-allocation-option="${row.optionId}"]`).fill(String(row.amount));
    const confirm = page.locator("[data-runtime-confirm]").first();
    if (!await page.locator(".live-guide").count() && await confirm.count() && await confirm.isVisible() && await confirm.isEnabled()) await click("[data-runtime-confirm]");
    return answer;
  }

  // Answer every open choice of the viewer until none is left; the opponent's choices are waited for.
  async function settle({ decline = false, preference = { scope: "レイヤー" } } = {}) {
    for (let index = 0; index < 50; index += 1) {
      const q = await query(); const input = q.requiredInput;
      if (!input) return;
      if (!input.canAnswer) { await page.waitForFunction(() => { const open = window.__SIMPLE_ZEKE_E2E__.query().value?.requiredInput; return !open || open.canAnswer; }); continue; }
      if (decline && input.optional) { await click("[data-runtime-decline]"); continue; }
      await choose({ ...input, requestId: input.choiceId }, await query(), preference);
    }
    throw new Error("required input failed to settle");
  }

  // Do one legal action of `type` (about `cardId` when given) by pressing its controls. `preference` steers the answers a plan asks for
  // (zone, targetId, user, cardOnly, scope). Returns once the match has moved.
  // A tutorial refuses an off-script answer and says why (the guide comes back with the reason): the plan is backed out of, the guide put away, and the
  // action started again with the next candidate, until one is accepted.
  async function action(type, cardId, preference = {}) {
    const refused = new Set();
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const result = await attemptOnce(type, cardId, preference, refused);
      if (result === "moved") return;
    }
    throw new Error(`every candidate of ${type} ${cardId ?? ""} was refused`);
  }

  async function attemptOnce(type, cardId, preference, refused) {
    const q = await query();
    const entryFor = (card) => q.legalActions.find((entry) => (entry.actionType ?? entry.action?.type) === type && (!cardId || (entry.base?.cardRef ?? entry.base?.attackerRef ?? entry.action?.cardRef) === card?.cardRef));
    const card = cardId && cardsOf(q).find((c) => !c.faceDown && c.definition.id === cardId && (["attack", "redeploy", "activateCardEffect"].includes(type) ? ["front", "back"].includes(c.location?.zone) : c.location?.zone === "hand") && entryFor(c));
    const entry = entryFor(card);
    if (!entry) throw new Error(`legal action missing: ${type} ${cardId ?? ""}`);
    if (card) {
      const cardSelector = `[data-card-ref="${card.cardRef}"]`;
      if (card.location?.zone === "hand") await cardShown(cardSelector);
      if (["front", "back"].includes(card.location?.zone) && await page.locator('[data-layer="hand"]:not([hidden])').count()) await click("[data-runtime-hand]");
      // The first touch on a lowered hand only raises it, and a raised hand lowers itself after a while: like a player, tap again when the card did not take the selection.
      for (let tap = 0; tap < 3; tap += 1) {
        await click(cardSelector);
        if (await page.waitForFunction(() => Boolean(document.querySelector(".r2-popup")), null, { timeout: 1500 }).then(() => true, () => false)) break;
        if (tap === 2) throw new Error(`the card did not take the selection: ${cardSelector}`);
      }
    }
    await click(`[data-action-id="${entry.actionId}"]`);
    if (entry.kind === "fixed") return "moved";
    let selections = []; let path = []; const moved = async () => (await query()).status.revision !== q.status.revision;
    for (let index = 0; index < 6; index += 1) {
      if (await moved()) return "moved";
      const planned = await page.evaluate((input) => window.__SIMPLE_ZEKE_E2E__.queryAction(input), { expectedRevision: q.status.revision, actionId: entry.actionId, selections });
      if (!planned.ok) { if (await moved()) return "moved"; throw new Error(JSON.stringify(planned)); }
      if (planned.value.completion) {
        const confirm = page.locator("[data-runtime-confirm]").first();
        if (!await page.locator(".live-guide").count() && await confirm.count() && await confirm.isVisible()) await click("[data-runtime-confirm]");
        if (await moved()) return "moved";
        await page.waitForTimeout(400);
        if (await moved()) return "moved";
        refused.add(JSON.stringify(path));
        if (process.env.E2E_DEBUG) console.error("refused", JSON.stringify(path), await page.locator(".live-guide .live-guide-error").innerText().catch(() => ""));
        refusals.push(await page.evaluate((ref) => { const notice = document.querySelector(".r2-notice"), hand = document.querySelector(".r2-hand-host"); const n = notice?.getBoundingClientRect(), h = hand?.getBoundingClientRect();
          return { type: ref ? "card" : "none", shook: Boolean(ref) && (window.__refusedShakes ?? []).includes(ref), notice: n && h ? { text: notice.textContent, gap: Math.round(h.top - n.bottom), centre: Math.round((n.left + n.right) / 2 - innerWidth / 2), viewportHeight: innerHeight } : null }; }, card?.cardRef ?? null));
        if (await page.locator(".live-guide-text").count() && !await page.locator(".live-guide :is([data-runtime-guide-next],[data-runtime-tutorial-next],[data-runtime-tutorial-finish])").count()) await click(".live-guide-text");
        for (let back = 0; back < 4 && await page.locator("[data-runtime-back]").first().isVisible().catch(() => false); back += 1) await click("[data-runtime-back]");
        return "refused";
      }
      const answer = await choose(planned.value.selectionRequests[0], q, preference, path, refused);
      selections.push(answer); path = [...path, answer.optionIds];
    }
    if (await moved()) return "moved";
    throw new Error("planning failed to complete");
  }

  return { page, click, read, query, cardShown, settle, action, choose, pick, refusals };
}

// Records every card that plays the refusal shake (the page keeps the list in window.__refusedShakes). Call before the match starts.
export const watchRefusals = (page) => page.addInitScript(() => { window.__refusedShakes = []; document.addEventListener("animationstart", (event) => { if (event.animationName === "live-refused") window.__refusedShakes.push(event.target.dataset?.cardRef); }, true); });
