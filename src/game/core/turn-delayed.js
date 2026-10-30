import { TRACE_TAGS, trace } from "../engine-trace.js";
import { createSelectionRequest } from "../selection-model.js";
import { addLog, otherPlayer } from "./shared.js";
import { startTurn } from "./turn.js";
import { destroyCard } from "../effects/generic/destroy.js";
import { syncFieldEntryTurns } from "../effects/generic/field-entry.js";
import { emitEffectPlacement, placeByMode, setCardSleeping } from "../effects/generic/placement.js";

export function resolveDelayedTrashMove(state, effect) {
  const owner = state.players[effect.ownerId];
  if (!owner) return false;
  const index = owner.trash.findIndex((card) => card.uid === effect.cardUid);
  if (index < 0) return false;
  const [card] = owner.trash.splice(index, 1);
  if (effect.destination === "hand") {
    owner.hand.push(card);
    addLog(state, `${effect.sourceName}: 次の自分ターン開始時にゴミ箱から手札へ。`, "effect");
    return true;
  }
  const zone = effect.destination === "choose_area"
    ? owner.front.length < owner.user.frontLimit ? "front" : owner.back.length < owner.user.backLimit ? "back" : "front"
    : effect.destination ?? "front";
  if (placeByMode(state, effect.ownerId, card, { zone, from: "trash", source: effect.sourceName }) !== "placed") return true;
  if (effect.resetDamage) card.damage = 0;
  if (effect.standby) card.sleep = false;
  if (effect.sleep) setCardSleeping(state, effect.ownerId, card);
  card.summoningSick = zone === "front";
  emitEffectPlacement(state, effect.ownerId, card, zone, effect.sourceName);
  return true;
}

export function resolveTurnStartDelayedEffects(state, playerId) {
  const player = state.players[playerId];
  const due = state.delayedEffects.filter((effect) => effect.event === "turn_started"
    && effect.ownerId === playerId
    && effect.dueOwnerTurnsTaken <= player.turnsTaken + 1);
  state.delayedEffects = state.delayedEffects.filter((effect) => !due.includes(effect));
  for (const effect of due) {
    if (effect.type === "move_source_from_trash") resolveDelayedTrashMove(state, effect);
  }
}

export function resolveTurnEndDelayedEffects(state, activeId) {
  const due = state.delayedEffects.filter((effect) => effect.event === "turn_ended"
    && (effect.dueTurn !== undefined ? effect.dueTurn <= state.turnNumber : effect.turnPlayerId === activeId));
  state.delayedEffects = state.delayedEffects.filter((effect) => !due.includes(effect));
  for (const effect of due) {
    trace(state, { tag: TRACE_TAGS.CLEANUP, event: "turn-end-delayed", type: effect.type, ownerId: effect.ownerId ?? null, cardUid: effect.cardUid ?? null, sourceName: effect.sourceName ?? null });
    if (effect.type === "destroy_card") {
      destroyCard(state, effect.ownerId, effect.cardUid, { source: `${effect.sourceName}の遅延破壊` });
      continue;
    }
    if (effect.type === "move_source_from_trash") {
      resolveDelayedTrashMove(state, effect);
      continue;
    }
    if (effect.type !== "generate_dolls_for_destroyed_ob") continue;
    const maximum = state.turnStats.destroyedOb;
    if (maximum <= 0) continue;
    const request = createSelectionRequest({ mode: "scope", scopeField: "count",
      scopeOptions: Array.from({ length: maximum + 1 }, (_, index) => String(index)),
      label: `生成するドールズの数（0～${maximum}）`, message: effect.sourceName,
      continuation: { type: "std212-respawn-count", playerId: effect.controllerId, sourceName: effect.sourceName, activeId, maximum } });
    state.pending = { type: "selection", validTargets: [], request };
    return true;
  }
  return false;
}

export function completeTurnAfterDelayedEffects(state, activeId) {
  const player = state.players[activeId];
  for (const current of Object.values(state.players)) {
    for (const card of [...current.front, ...current.back, ...current.hand]) {
      for (const [keyword, expiry] of Object.entries(card.keywordExpiries ?? {})) {
        if (expiry <= state.turnNumber) {
          card.grantedKeywords = (card.grantedKeywords ?? []).filter((value) => value !== keyword);
          delete card.keywordExpiries[keyword];
        }
      }
      if (card.assaultProgramTurn === state.turnNumber) delete card.assaultProgramTurn;
    }
  }
  player.forceAttack = false;
  syncFieldEntryTurns(state);
  state.turnNumber += 1;
  if (state.extraTurnPlayerId === activeId) {
    state.extraTurnPlayerId = null;
    state.damagePenaltyPlayerId = activeId;
    state.damagePenaltyTurn = state.turnNumber;
    startTurn(state, activeId);
  } else if (["lab", "sandbox"].includes(state.mode) && !state.sandboxUi?.alternateTurns) startTurn(state, "player");
  else startTurn(state, otherPlayer(activeId));
  return true;
}
