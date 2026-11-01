import { finalizeEffectResolution, recordVictoryFact, resolveMandatoryStateChecks } from "./effects.js";
import { addLog } from "./shared.js";
import { emitGameEvent } from "./triggers.js";
import { runPostDrawTurnStart } from "./turn.js";

export function drawCardRaw(player) {
  const card = player.deck.pop();
  if (card) player.hand.push(card);
  return card;
}

export function drawCards(state, playerId, count = 1) {
  const player = state.players[playerId];
  let drawn = 0;
  for (let i = 0; i < count; i += 1) {
    const card = drawCardRaw(player);
    if (!card) continue;
    drawn += 1;
    emitGameEvent(state, {
      type: "card_drawn", playerId, ownerId: card.owner ?? playerId,
      cardUid: card.uid, cardId: card.id, cardName: card.name,
      category: card.category, color: card.color, amount: 1,
      drawIndex: drawn, requestedCount: count, source: "draw"
    });
  }
  if (drawn) addLog(state, `${player.user.name}が${drawn}枚ドロー。`);
  return drawn;
}

export function continueMandatoryTurnDraw(state, playerId, count) {
  const drawn = drawCards(state, playerId, count);
  if (drawn < count) {
    state.players[playerId].mandatoryDrawFailed = true;
    recordVictoryFact(state, { type: "mandatory-draw-failed", playerId });
    addLog(state, `${state.players[playerId].user.name}はターン開始時の必要ドローを完了できず敗北。`, "win");
    if (!state.effectResolution) finalizeEffectResolution(state);
  }
}

export function hasMandatoryDrawChildWork(state) {
  return Boolean(
    // Only the placement/replacement continuation belongs to Dawn's mandatory
    // draw. Newly queued triggers (STD186/179 etc.) are separate effects.
    state.pending || state.prompt || state.deferredTrashMoves?.length || state.deferredDestruction
  );
}

export function resumeMandatoryDrawContinuation(state) {
  const continuation = state.mandatoryDrawContinuation;
  if (!continuation || continuation.type !== "std048-mandatory-draw" || hasMandatoryDrawChildWork(state)) return false;
  if (continuation.placementOutcome === "pending") return false;
  if (!continuation.ruleDrawDone) {
    continuation.ruleDrawDone = true;
    continueMandatoryTurnDraw(state, continuation.playerId, continuation.remainingRuleDraws);
    if (state.players[continuation.playerId].mandatoryDrawFailed) {
      state.mandatoryDrawContinuation = null;
      finalizeEffectResolution(state);
      return true;
    }
    if (hasMandatoryDrawChildWork(state)) return true;
  }
  if (continuation.placementOutcome === "placed" && !continuation.successEffectDone) {
    continuation.successEffectDone = true;
    const player = state.players[continuation.playerId];
    player.fortressStr = Math.min(player.user.maxStr, player.fortressStr + 3);
    drawCards(state, continuation.playerId, 1);
    addLog(state, `${continuation.sourceName}: ドラッグ成功。自分ユーザーを3回復し、1枚ドロー。`, "effect");
    if (hasMandatoryDrawChildWork(state)) return true;
  }
  state.mandatoryDrawContinuation = null;
  if (state.effectResolution?.kind === "STD-048-mandatory-draw") {
    resolveMandatoryStateChecks(state);
    finalizeEffectResolution(state);
  }
  if (!state.winner) runPostDrawTurnStart(state, continuation.playerId);
  return true;
}
