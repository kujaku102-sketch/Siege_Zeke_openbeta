import { canPlayCard, playCard } from "../game/engine.js";

// Deliberate first-stage allowlist, not a claim that other Ob cannot be played.
// These sample cards require no login targets, OC or material selection.
const trialCards = new Set(["STD-020", "STD-021", "STD-022", "STD-023", "STD-024"]);

export function operationLocked(state) {
  return Boolean(state.winner || state.victory?.lockedOutcome || state.pending || state.prompt || state.effectResolution);
}

export function placementOptions(state, uid) {
  if (operationLocked(state)) return { slots: [], reason: "効果処理中または対戦終了のため実行できません。" };
  const card = state.players.player.hand.find(item => item.uid === uid);
  if (!card || card.category !== "Ob" || !trialCards.has(card.id)) return { slots: [], reason: "この段階ではサンプル手札の通常Obだけ接続しています。" };
  const slots = [];
  const reasons = [];
  for (const zone of ["front", "back"]) {
    const check = canPlayCard(state, "player", card, { zone });
    if (!check.ok) { reasons.push(check.reason); continue; }
    for (let slot = 1; slot <= state.players.player.user[`${zone}Limit`]; slot++) {
      if (canPlayCard(state, "player", card, { zone, requestedSlot: slot }).ok) slots.push({ zone, slot });
    }
  }
  return { slots, reason: slots.length ? "空いているマスを選んで実行します。" : reasons[0] ?? "配置できる空きマスがありません。" };
}

export function beginPlacement(state, uid) {
  return placementOptions(state, uid).slots.length ? { type: "placement", sourceUid: uid } : null;
}

export function commitPlacement(state, draft, zone, slot) {
  if (!draft || draft.type !== "placement") return false;
  // Re-read legality at commit time; no state, costs, or history change on cancel.
  if (!placementOptions(state, draft.sourceUid).slots.some(item => item.zone === zone && item.slot === slot)) return false;
  return playCard(state, "player", draft.sourceUid, { zone, requestedSlot: slot });
}
