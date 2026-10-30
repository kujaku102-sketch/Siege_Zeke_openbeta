import { isObCard } from "../card-types.js";
import { queueMemoryLimitIncreasePrompt } from "./scripts.js";
import { addLog, fail, newActionBlock } from "./shared.js";
import { cardHasKeyword } from "./stats.js";
import { emitUserAbilityFeedback } from "./triggers.js";
import { getMaxMemory } from "../effects/generic/cost.js";
import { setCardSleeping } from "../effects/generic/placement.js";

export function restSecurity(state, playerId, uid) {
  if (state.active !== playerId || state.winner || state.victory?.lockedOutcome || state.pending || state.prompt || state.effectResolution) return false;
  const card = state.players[playerId].front.find((item) => item.uid === uid);
  if (!card || !isObCard(card) || card.faceDown || !cardHasKeyword(card, "SECURITY")) return fail(state, "[セキュリティ]を持つフロントObを選んで。", false);
  if (state.securityRestWindow !== playerId) return fail(state, "[セキュリティ]はターン終了時だけスリープできる。", false);
  if (card.sleep) return fail(state, "既にスリープしている。", false);
  setCardSleeping(state, playerId, card);
  addLog(state, `${card.name}を[セキュリティ]待機でスリープ。`, "action");
  return true;
}

export function canActivateTurbo(state, playerId = "player") {
  const player = state.players[playerId];
  return Boolean(player && player.user?.abilityKey === "turbo" && state.active === playerId && !player.turboUsed);
}

export function activateTurbo(state, playerId = "player") {
  const player = state.players[playerId];
  { const blocked = newActionBlock(state); if (blocked) return fail(state, blocked, false); }
  if (!canActivateTurbo(state, playerId)) return fail(state, "ターボ・ブーストは今は使えない。", false);
  const beforeMaxMemory = getMaxMemory(player);
  player.turboUsed = true;
  player.turboActive = true;
  player.memory += 2;
  addLog(state, `${player.user.name}「ターボ・ブースト！」メモリ上限とアクティブメモリ+2。`, "effect");
  emitUserAbilityFeedback(state, "turbo", playerId, playerId, {
    branch: "activated", before: beforeMaxMemory, after: getMaxMemory(player), amount: 2, steps: [{ kind: "value_change", target: { kind: "player_stat", playerId, metric: "memory_limit" }, before: beforeMaxMemory, after: getMaxMemory(player) }]
  });
  queueMemoryLimitIncreasePrompt(state, playerId, "ターボ・ブースト！");
  return true;
}
