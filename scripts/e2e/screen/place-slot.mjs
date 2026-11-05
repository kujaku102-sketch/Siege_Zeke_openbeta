// Screen check: a card placed by an effect (a drag after an access; the decode and the rule draw ask the same way) picks one empty slot on
// the board only (文豪, 2026-11-05, H2). No popup; the bar is one line, 「配置先を選択：<the card being placed>」, with no instruction; every
// empty own slot lights and nothing else but the own face-up Obs it can be mounted under, which wear 「マウント」; a tap on a lit empty slot
// places the card in that very slot and the bar goes.
// The board is made in a sandbox match through the test hook: an Ob whose login accesses a card and drags it is executed to the front, and
// its access is answered. The card is found by what its text says, not by its id; the sandbox decks are the default ones.
import { CARD_LIBRARY } from "../../../src/data/cards.js";
import { openBrowser, assertNoErrors, until } from "../parts/browser.mjs";

const dragger = Object.values(CARD_LIBRARY).find((card) => card.category === "Ob" && /アクセスし、それをドラッグする/.test(card.text ?? ""));
if (!dragger) throw new Error("no Ob that accesses a card and drags it: nothing to check");

const { browser, errors, newPage } = await openBrowser();
try {
  const page = await newPage({ hook: true, path: "" });
  await until(page, () => document.body.classList.contains("boot-done") && !document.querySelector("#boot-splash"), null, "the title after boot", 20000);
  const made = await page.evaluate((id) => {
    const h = window.__SIMPLE_ZEKE_E2E__;
    if (!h.start("sandbox", "basics", 1).ok) return "start";
    const [me] = h.scope().seatIds;
    let serial = 0;
    const read = () => h.query(me).value;
    const send = (action) => h.submit({ commandId: `e2e:${++serial}`, expectedRevision: read().status.revision, action }, me)?.value?.receipt?.reasonCode;
    const add = () => { h.sandbox({ type: "sandboxAddCard", definitionId: id, targetSeat: me });
      return read().observation.seats.find((row) => row.seatId === me).hand.cards.findLast((card) => card.definition.id === id)?.cardRef; };
    const entry = (type, ref) => read().legalActions.find((a) => (a.actionType ?? a.action?.type) === type && (a.base?.cardRef ?? a.action?.cardRef) === ref);
    // A copy installed first gives the card's colour.
    if (send(entry("install", add()).action) !== "ACCEPTED") return "install the colour";
    const exec = entry("executeCard", add());
    const first = h.queryAction({ expectedRevision: read().status.revision, actionId: exec.actionId, selections: [] }).value.selectionRequests[0];
    const front = first.options.find((option) => option.zone === "front");
    const plan = h.queryAction({ expectedRevision: read().status.revision, actionId: exec.actionId, selections: [{ requestId: first.requestId, optionIds: [front.optionId], allocation: [] }] }).value;
    if (send(plan.completion.action) !== "ACCEPTED") return "execute the card";
    // Its access (a pick from the deck, still a list) is answered with the first card offered.
    for (let input = read().requiredInput; input && !input.placing; input = read().requiredInput) {
      if (send({ type: "answerChoice", choiceId: input.choiceId, optionIds: input.options.slice(0, Math.max(1, input.minimum)).map((o) => o.optionId), allocation: [] }) !== "ACCEPTED") return "the access";
    }
    h.refresh();
    const input = read().requiredInput;
    return input?.placing ? { me, placing: input.placing.label, empty: input.options.filter((o) => Number.isInteger(o.slot)).map((o) => `${o.zone}${o.slot}`),
      hosts: input.options.filter((o) => o.cardRef).map((o) => o.cardRef) } : "no placement";
  }, dragger.id);
  if (typeof made === "string") throw new Error(`the board could not be made: ${made}`);
  const { me, placing, empty, hosts } = made;
  await until(page, () => Boolean(document.querySelector(".board-pick-guide")), null, "the bar over the board");
  const seen = await page.evaluate((seat) => ({
    modal: Boolean(document.querySelector(".effect-modal")),
    
    placing: document.querySelector(".board-pick-guide strong b")?.textContent ?? null,
    line: document.querySelector(".board-pick-guide strong")?.textContent ?? null, spans: document.querySelectorAll(".board-pick-guide > span").length,
    lit: [...document.querySelectorAll(`.board-slot.request-target[data-seat="${seat}"]:not([data-card-ref])`)].map((slot) => `${slot.dataset.zone}${slot.dataset.slot}`),
    litCards: [...document.querySelectorAll(".board-slot.request-target[data-card-ref]")].map((slot) => slot.dataset.cardRef),
    badges: [...document.querySelectorAll(".wf-pick-badge text")].map((text) => text.textContent),
    other: document.querySelectorAll(`.board-slot.request-target:not([data-seat="${seat}"])`).length
  }), me);
  if (seen.modal) throw new Error("a popup opened over the placement");
  if (seen.line !== `配置先を選択：${placing}` || seen.placing !== placing || seen.spans) throw new Error(`the bar is one line, the title and the card: ${JSON.stringify(seen)} (placing ${placing})`);
  if (seen.lit.sort().join() !== [...empty].sort().join() || seen.other) throw new Error(`every empty own slot and nothing else lights: ${JSON.stringify(seen)} (empty ${empty})`);
  if (seen.litCards.sort().join() !== [...hosts].sort().join() || seen.badges.length !== hosts.length || seen.badges.some((text) => text !== "マウント")) throw new Error(`the Obs to mount under wear 「マウント」: ${JSON.stringify(seen)}`);
  // A slot that is not the first one, so the card cannot land there by default.
  const target = empty.find((slot) => slot.startsWith("back") && slot !== "back1") ?? empty.at(-1);
  const [, zone, slot] = /^(front|back)(\d+)$/.exec(target);
  await page.click(`.board-slot[data-seat="${me}"][data-zone="${zone}"][data-slot="${slot}"]`);
  await until(page, ([seat, z, s, name]) => {
    const own = window.__SIMPLE_ZEKE_E2E__.query(seat).value.observation.seats.find((row) => row.seatId === seat);
    return own[z].cards.some((card) => card.location?.position === s && card.definition?.name === name) && !document.querySelector(".board-pick-guide,.effect-modal");
  }, [me, zone, Number(slot), placing], `the card in ${target}, the slot tapped`);
  assertNoErrors(errors, "place-slot");
  console.log(JSON.stringify({ suite: "screen/place-slot", card: dragger.name, placing, lit: seen.lit.length, hosts: hosts.length, placedAt: target, ok: true }));
} finally {
  await browser.close();
}
