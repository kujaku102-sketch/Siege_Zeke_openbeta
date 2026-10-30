import { normalizeBoardSlots } from "../board-slots.js";
import { flattenMaterialStack, layeredCandidates, layeredSelectionPlan, layeredSpecFor, validatesLayeredSelection } from "../layered-specs.js";
import { resolveEffect } from "./effects.js";
import { hasKeyword } from "./keywords.js";
import { notifyCardExecuted } from "./play-notify.js";
import { resolveLogin } from "./play-spell.js";
import { canPlayCard, requestedExecutionSlot } from "./play.js";
import { addLog, fail, newActionBlock } from "./shared.js";
import { executionCost } from "../effects/generic/cost.js";
import { placeByMode, placementResult } from "../effects/generic/placement.js";

export function getLayeredCandidates(state, _playerId, card) {
  return layeredCandidates(state, _playerId, card);
}

export function getLayeredRequirement(card) {
  const rule = layeredSpecFor(card);
  return { minimum: rule?.minimum ?? Number.POSITIVE_INFINITY, label: rule?.label ?? "未対応のレイヤード条件" };
}

export function getLayeredSelectionPlan(state, playerId, card) {
  return layeredSelectionPlan(state, playerId, card);
}

export function canPlayLayeredCard(state, playerId, uid, materialUids, zone = "front", requestedSlot = null) {
  const player = state.players[playerId];
  const handIndex = player.hand.findIndex((card) => card.uid === uid);
  if (handIndex < 0) return { ok: false, reason: "レイヤードするカードが手札にない。" };
  const card = player.hand[handIndex];
  if (!hasKeyword(card, "LAYERED")) return { ok: false, reason: "[レイヤード]を持つカードを選んで。" };
  const rule = layeredSpecFor(card);
  if (!rule) return { ok: false, reason: "未対応のレイヤード条件。" };
  const uniqueUids = [...new Set(materialUids)];
  const eligible = getLayeredCandidates(state, playerId, card);
  const selected = uniqueUids.map((targetUid) => eligible.find((entry) => entry.card.uid === targetUid)).filter(Boolean);
  if (selected.length !== uniqueUids.length || !validatesLayeredSelection(card, playerId, selected)) return { ok: false, reason: `レイヤード条件不足：${rule.label}` };
  if (requestedSlot !== null) {
    const projected = { ...state, players: { ...state.players, [playerId]: { ...player, [zone]: player[zone].filter(item => !uniqueUids.includes(item.uid)) } } };
    const slotCheck = requestedExecutionSlot(projected, playerId, card, { zone, requestedSlot });
    if (!slotCheck.ok) return slotCheck;
  }
  const ownSlotsFreed = selected.filter((entry) => entry.playerId === playerId && entry.zoneName === zone).length;
  if (!placementResult(player, zone, { addedSlots: 1, freedSlots: ownSlotsFreed }).ok) return { ok: false, reason: `${zone === "front" ? "フロント" : "バック"}上限。` };
  const overrideDiscount = hasKeyword(card, "OVERRIDE") ? Math.max(0, ...selected.map((entry) => Number(entry.card.cost ?? 0))) : 0;
  const effectiveCost = Math.max(0, executionCost(card, state, playerId) - overrideDiscount);
  const check = canPlayCard(state, playerId, card, { zone, freedSlots: ownSlotsFreed, free: hasKeyword(card, "OVERRIDE") });
  if (!check.ok) return check;
  if (player.memory < effectiveCost) return { ok: false, reason: "メモリ不足。" };
  return { ok: true, selected, ownSlotsFreed, overrideDiscount, effectiveCost };
}

export function playLayeredCard(state, playerId, uid, materialUids, zone = "front", { requestedSlot = null } = {}) {
  { const blocked = newActionBlock(state); if (blocked) return fail(state, blocked, false); }
  const check = canPlayLayeredCard(state, playerId, uid, materialUids, zone, requestedSlot);
  if (!check.ok) return fail(state, check.reason, false);
  normalizeBoardSlots(state);
  const { selected, ownSlotsFreed, overrideDiscount, effectiveCost } = check;
  const player = state.players[playerId], card = player.hand.find(item => item.uid === uid);

  const materials = [];
  for (const entry of selected) {
    const sourceZone = state.players[entry.playerId][entry.zoneName];
    const index = sourceZone.findIndex((candidate) => candidate.uid === entry.card.uid);
    if (index < 0) continue;
    const [material] = sourceZone.splice(index, 1);
    materials.push(...flattenMaterialStack(material));
  }
  const executionHandIndex = player.hand.findIndex((candidate) => candidate.uid === uid);
  if (executionHandIndex < 0) return fail(state, "レイヤード実行カードが手札から失われた。", false);
  player.hand.splice(executionHandIndex, 1);
  player.memory -= effectiveCost;
  card.mounted = materials;
  card.sleep = false;
  card.damage = 0;
  card.summoningSick = !hasKeyword(card, "QA");
  placeByMode(state, playerId, card, { zone, mode: "normal", from: "hand", addedSlots: 1, freedSlots: ownSlotsFreed, requestedSlot });
  addLog(state, `${card.name}を${materials.length}枚の公開カードでレイヤード実行。実行メモリ${effectiveCost}${overrideDiscount ? `（オーバーライド-${overrideDiscount}）` : ""}。`, "action");
  resolveEffect(state, () => resolveLogin(state, playerId, card));
  notifyCardExecuted(state, playerId, card);
  return true;
}
