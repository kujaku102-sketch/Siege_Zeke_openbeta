// SZTB-097 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { isObCard } from "../../game/card-types.js";
import { createSelectionRequest } from "../../game/selection-model.js";
import { cardAtk, cardCurrentStr } from "../../game/core/battle.js";
import { addLog, findCard, isArmsBandOb, shuffle } from "../../game/core/shared.js";
import { PASS } from "../../game/effects/custom/index.js";
import { destroyCard } from "../../game/effects/generic/placement.js";

// handlers (was effects/custom/sztb_097.js)
export function sztb097ChoiceSelection(state, continuation, result, playerId, player) {
  if (result.scope === "①アームズバンドObへアクセス") {
    const candidates = player.deck.filter(isArmsBandOb);
    if (!candidates.length) { state.pending = null; return true; }
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((item) => item.uid), count: 1,
      candidateLabels: Object.fromEntries(candidates.map((item) => [item.uid, item.name])), label: "アームズバンドObへアクセス", message: continuation.sourceName,
      continuation: { type: "sztb097-access", playerId, sourceName: continuation.sourceName } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  const candidates = [...player.front, ...player.back].filter(isObCard);
  const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((item) => item.uid), count: candidates.length, minimum: 0, maximum: candidates.length,
    candidateLabels: Object.fromEntries(candidates.map((item) => [item.uid, `${item.name} / ATK ${cardAtk(state, playerId, item)}`])),
    label: "合計ATKへ加える自分Obを任意選択", message: "0枚で確定した場合、後続処理は行わない。",
    continuation: { type: "sztb097-atk-sum", playerId, sourceName: continuation.sourceName } });
  state.pending = { type: "selection", validTargets: request.candidates, request };
  return true;
}

export function sztb097AccessSelection(state, continuation, result, playerId, player) {
  const index = player.deck.findIndex((item) => item.uid === result.selected[0] && isArmsBandOb(item));
  if (index < 0) return false;
  const [accessed] = player.deck.splice(index, 1);
  player.deck = shuffle(player.deck, state.rng);
  player.hand.push(accessed);
  state.pending = null;
  addLog(state, `${continuation.sourceName}: ${accessed.name}へアクセスし手札へ加えた。`, "effect");
  return true;
}

export function sztb097AtkSumSelection(state, continuation, result, playerId, player) {
    const selected = result.selected.map((uid) => findCard(state, uid)).filter((entry) => entry?.playerId === playerId
      && ["front", "back"].includes(entry.zoneName) && isObCard(entry.card));
    if (!selected.length) {
      if (state.deferredSpellCleanup) state.deferredSpellCleanup.postEffectDone = true;
      state.pending = null;
      addLog(state, `${continuation.sourceName}: 0体を選択したため、後続処理を行わず終了。`, "effect");
      return true;
    }
    const totalAtk = selected.reduce((sum, entry) => sum + Math.max(0, cardAtk(state, playerId, entry.card)), 0);
    const targets = Object.entries(state.players).flatMap(([ownerId, owner]) => [...owner.front, ...owner.back]
      .filter((item) => isObCard(item) && cardCurrentStr(state, ownerId, item) <= totalAtk)
      .map((item) => ({ ownerId, card: item })));
    if (!targets.length) return false;
    const request = createSelectionRequest({ mode: "single", candidates: targets.map((entry) => entry.card.uid), count: 1,
      candidateLabels: Object.fromEntries(targets.map((entry) => [entry.card.uid, `${entry.card.name} / STR ${cardCurrentStr(state, entry.ownerId, entry.card)}`])),
      label: `合計ATK ${totalAtk} 以下のObを破壊`, message: continuation.sourceName,
      continuation: { type: "sztb097-destroy", playerId, sourceName: continuation.sourceName, totalAtk } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
}

export function sztb097DestroySelection(state, continuation, result, playerId, player) {
  const target = findCard(state, result.selected[0]);
  if (!target || !["front", "back"].includes(target.zoneName) || !isObCard(target.card)
    || cardCurrentStr(state, target.playerId, target.card) > continuation.totalAtk) return false;
  state.pending = null;
  destroyCard(state, target.playerId, target.card.uid, { source: continuation.sourceName });
  return true;
}

export function sztb097ResolveSpell({ player, state, playerId, card }) {
  const accessAvailable = player.deck.some((item) => isArmsBandOb(item));
  const ownOb = [...player.front, ...player.back].filter(isObCard);
  const maximumAtk = ownOb.reduce((sum, item) => sum + Math.max(0, cardAtk(state, playerId, item)), 0);
  const destroyAvailable = Object.entries(state.players).some(([ownerId, owner]) => [...owner.front, ...owner.back]
    .some((item) => isObCard(item) && cardCurrentStr(state, ownerId, item) <= maximumAtk));
  const scopeOptions = [];
  if (accessAvailable) scopeOptions.push("①アームズバンドObへアクセス");
  if (destroyAvailable) scopeOptions.push("②自分Obの合計ATK以下を破壊");
  if (scopeOptions.length) {
    const request = createSelectionRequest({ mode: "scope", scopeField: "effect", scopeOptions,
      label: `${card.name}: いずれかを選択`, message: card.text,
      continuation: { type: "sztb097-choice", playerId, sourceName: card.name } });
    state.pending = { type: "selection", validTargets: [], request };
  }
  return PASS;
}
