// Screen check: a card that can also be set as a Script, executed from the registry (文豪, 2026-11-05, H3). Its placement is asked
// on the board only: no popup; the bar carries [Obとして配置] [Scriptとして設置] with the pressed way marked, and only that way's slots
// light (as the card itself: the open front and back slots; as a Script: the open back slots only). A tap on a lit back slot as a
// Script sets the card there face down.
// The board is made in a sandbox match through the test hook: the card that allows registry execution is executed, then the card is
// installed into the registry twice. Both cards are found by what they do (the engine's own check, the card text), not by their ids.
import { CARD_LIBRARY } from "../../../src/data/cards.js";
import { supportsAlternateScriptSetup } from "../../../src/game/engine.js";
import { openBrowser, assertNoErrors, until } from "../parts/browser.mjs";

const cards = Object.values(CARD_LIBRARY);
const dual = cards.find((card) => supportsAlternateScriptSetup(card));
const enabler = cards.find((card) => /レジストリからカードを実行できる/.test(card.text ?? ""));
if (!dual || !enabler) throw new Error("no card that can also be set as a Script, or none that allows registry execution: nothing to check");

const { browser, errors, newPage } = await openBrowser();
try {
  const page = await newPage({ hook: true, path: "" });
  await until(page, () => document.body.classList.contains("boot-done") && !document.querySelector("#boot-splash"), null, "the title after boot", 20000);
  const made = await page.evaluate(([dualId, enablerId]) => {
    const h = window.__SIMPLE_ZEKE_E2E__;
    if (!h.start("sandbox", "basics", 1).ok) return "start";
    const [me, other] = h.scope().seatIds;
    let serial = 0;
    const read = (seat = me) => h.query(seat).value;
    const send = (action, seat = me) => h.submit({ commandId: `e2e:${++serial}`, expectedRevision: read(seat).status.revision, action }, seat)?.value?.receipt?.reasonCode;
    const add = (id) => { h.sandbox({ type: "sandboxAddCard", definitionId: id, targetSeat: me });
      return read().observation.seats.find((row) => row.seatId === me).hand.cards.findLast((card) => card.definition.id === id)?.cardRef; };
    const entry = (type, ref, seat = me) => read(seat).legalActions.find((a) => (a.actionType ?? a.action?.type) === type && (ref === null || (a.base?.cardRef ?? a.action?.cardRef) === ref));
    // One install a turn: a copy of the enabler gives its colour; the card itself goes in on the next own turn.
    if (send(entry("install", add(enablerId)).action) !== "ACCEPTED") return "install the enabler's colour";
    const exec = entry("executeCard", add(enablerId));
    const first = h.queryAction({ expectedRevision: read().status.revision, actionId: exec.actionId, selections: [] }).value.selectionRequests[0];
    const front = first.options.find((option) => option.zone === "front");
    const plan = h.queryAction({ expectedRevision: read().status.revision, actionId: exec.actionId, selections: [{ requestId: first.requestId, optionIds: [front.optionId], allocation: [] }] }).value;
    if (send(plan.completion.action) !== "ACCEPTED") return "execute the enabler";
    for (let input = read().requiredInput; input; input = read().requiredInput) {
      if (send({ type: "answerChoice", choiceId: input.choiceId, optionIds: input.options.slice(0, input.minimum).map((o) => o.optionId), allocation: [] }) !== "ACCEPTED") return "the enabler's choice";
    }
    const nextTurn = () => send(entry("endTurn", null).action) === "ACCEPTED" && send(entry("endTurn", null, other).action, other) === "ACCEPTED";
    // Two copies go in, a turn apart: the one left in the registry keeps the card's colour while the other is executed.
    if (!nextTurn() || send(entry("install", add(dualId)).action) !== "ACCEPTED") return "install the card's colour";
    if (!nextTurn()) return "end the turns";
    const ref = add(dualId);
    if (send(entry("install", ref).action) !== "ACCEPTED") return "install the card";
    h.refresh();
    return entry("executeRegistry", ref) ? { ref, me } : "no registry execution";
  }, [dual.id, enabler.id]);
  if (typeof made === "string") throw new Error(`the board could not be made: ${made}`);
  const { ref, me } = made;
  // The player's way: the registry, the card in it, its レジストリから実行.
  await page.click(`[data-runtime-zone="registry"][data-seat="${me}"]`);
  await page.click(`.wf-drawer [data-card-ref="${ref}"]`);
  await page.click(`.r2-popup [data-action-id]:has-text("レジストリから実行")`);
  await until(page, () => document.querySelectorAll(".board-pick-modes button").length === 2, null, "the bar's two ways");
  if (await page.locator(".wf-drawer").count()) await page.click("[data-runtime-zone-close]");
  const lit = () => page.evaluate((seat) => {
    const zone = (z) => [...document.querySelectorAll(`.board-slot.request-target[data-seat="${seat}"][data-zone="${z}"]`)].map((slot) => Number(slot.dataset.slot)).sort();
    return { front: zone("front"), back: zone("back"), modal: Boolean(document.querySelector(".effect-modal")),
      pressed: [...document.querySelectorAll(".board-pick-modes button")].map((button) => `${button.textContent}:${button.getAttribute("aria-pressed")}`),
      title: document.querySelector(".board-pick-guide strong")?.textContent ?? null };
  }, me);
  const asCard = await lit();
  if (asCard.modal) throw new Error("a popup opened over the board pick");
  if (asCard.title !== "配置先を選択" || asCard.pressed.join() !== "Obとして配置:true,Scriptとして設置:false") throw new Error(`the bar as the card itself: ${JSON.stringify(asCard)}`);
  if (!asCard.front.length || !asCard.back.length) throw new Error(`as the card itself the front and the back light: ${JSON.stringify(asCard)}`);
  await page.click('[data-runtime-place-mode="script"]');
  await until(page, () => document.querySelector('[data-runtime-place-mode="script"]')?.getAttribute("aria-pressed") === "true", null, "Scriptとして設置 pressed");
  const asScript = await lit();
  if (asScript.modal || asScript.front.length || asScript.back.join() !== asCard.back.join()) throw new Error(`as a Script only the open back slots light: ${JSON.stringify(asScript)}`);
  const slot = asScript.back[0];
  await page.click(`.board-slot[data-seat="${me}"][data-zone="back"][data-slot="${slot}"]`);
  await until(page, ([seat, cardRef, at]) => {
    const own = window.__SIMPLE_ZEKE_E2E__.query(seat).value.observation.seats.find((row) => row.seatId === seat);
    const placed = own.back.cards.find((card) => card.cardRef === cardRef || card.slot === at);
    return placed?.faceDown === true && !own.registry.cards.some((card) => card.cardRef === cardRef) && !document.querySelector(".board-pick-guide");
  }, [me, ref, slot], "the card set face down in the back slot tapped");
  assertNoErrors(errors, "place-mode");
  console.log(JSON.stringify({ suite: "screen/place-mode", asCard, asScript: { back: asScript.back, pressed: asScript.pressed }, slot, ok: true }));
} finally {
  await browser.close();
}
