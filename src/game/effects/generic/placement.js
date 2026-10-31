import { TRACE_TAGS, trace } from "../../engine-trace.js";
import { placeCardInBoardSlot } from "../../board-slots.js";
import { isObCard } from "../../card-types.js";
import { mountEventSpecsFor } from "../../continuous-effect-specs.js";
import { evaluatePlacement } from "../../placement-policy.js";
import { createSelectionRequest } from "../../selection-model.js";
import { dealFortressDamage } from "../../core/deal-damage.js";
import { drawCards } from "../../core/draw.js";
import { enqueueSelection, selectionProjectionMeta } from "../../core/projection.js";
import { addLog, cardTraits, fail, otherPlayer } from "../../core/shared.js";
import { emitGameEvent, emitUserAbilityFeedback } from "../../core/triggers.js";
import { markFieldEntry, movedSummoningSick } from "./field-entry.js";
import { moveCardToTrash, resetLeftAreaState, revealMountedCode, triggerMoved } from "./trash.js";

export const backupLimit = (card) => {
  const match = String(card?.text ?? "").match(/\[バックアップ(?:[:：](\d+))?\]/);
  return match ? Number(match[1] ?? 1) : 0;
};

export function resolveMountedSourceTrigger(state, playerId, host, source) {
  const specs = source ? mountEventSpecsFor(source.id).filter((spec) => spec.event === "ob_mounted_on_source") : [];
  if (!specs.length) return false;
  const layerIndex = host.mounted.findIndex((card) => card.uid === source.uid);
  if (layerIndex < 0) return false;
  for (const spec of specs) for (const action of spec.actions) {
    if (action.type === "grant_backup" && action.target === "mounted_host") host.backup = Number(host.backup ?? 0) + Number(action.amount ?? 0);
    else if (action.type === "grant_protect" && action.target === "mounted_host") host.protect = Number(host.protect ?? 0) + Number(action.amount ?? 0);
    else if (action.type === "modify_stats" && action.target === "mounted_host") {
      host.permanentAtk = Number(host.permanentAtk ?? 0) + Number(action.atk ?? 0);
      host.permanentStr = Number(host.permanentStr ?? 0) + Number(action.str ?? 0);
    } else if (action.type === "draw" && action.target === "source_controller") drawCards(state, playerId, Number(action.amount ?? 0));
    else if (action.type === "destroy" && action.target === "source_layer") {
      const currentIndex = host.mounted.findIndex((card) => card.uid === source.uid);
      if (currentIndex < 0) continue;
      host.mounted.splice(currentIndex, 1);
      moveCardToTrash(state, source.owner ?? playerId, source, `${source.name}のマウント誘発`);
      state.turnStats.destroyedCards += 1;
      addLog(state, `${source.name}のマウント誘発: ${source.name}を破壊。`, "damage");
      emitGameEvent(state, {
        type: "card_destroyed", playerId, ownerId: source.owner ?? playerId,
        cardUid: source.uid, cardId: source.id, cardName: source.name,
        category: source.category, from: "layer", source: `${source.name}のマウント誘発`
      });
    } else throw new Error(`Unsupported mount event action: ${action.type}`);
  }
  addLog(state, `${source.name}: ${host.name}へマウント誘発を適用。`, "effect");
  return true;
}

function triggerMountedSleepEffects(state, playerId, card) {
  for (const source of card.mounted ?? []) for (const spec of mountEventSpecsFor(source.id).filter((item) => item.event === "mounted_host_slept")) {
    const ownerId = source.owner ?? playerId;
    const owner = state.players[ownerId];
    for (const action of spec.actions) {
      if (action.type === "discard" && action.target === "source_owner_hand") {
        if (!owner?.hand.length) continue;
        const count = Math.min(Number(action.count ?? 1), owner.hand.length);
        const request = createSelectionRequest({ mode: count === 1 ? "single" : "exact", candidates: owner.hand.map((item) => item.uid), count,
          candidateLabels: Object.fromEntries(owner.hand.map((item) => [item.uid, item.name])), label: `${source.name}: 手札を${count}枚捨てる`, message: source.text,
          continuation: { type: "mounted-event-discard", playerId: ownerId, sourceName: source.name, count } });
        enqueueSelection(state, { type: "selection", validTargets: request.candidates, request }, selectionProjectionMeta("engine:mounted-event-discard", ownerId));
      } else if (action.type === "deal_damage" && action.target === "source_owner_user") {
        dealFortressDamage(state, ownerId, Number(action.amount ?? 0), ownerId, source.name);
      } else throw new Error(`Unsupported mounted host event action: ${action.type}`);
    }
  }
}

export function setCardSleeping(state, playerId, card) {
  if (card.sleep) return false;
  card.sleep = true;
  triggerMountedSleepEffects(state, playerId, card);
  return true;
}

export function emitEffectPlacement(state, playerId, card, zone, source) {
  return emitGameEvent(state, {
    type: "card_effect_placed", playerId, ownerId: card.owner ?? playerId,
    cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category,
    color: card.color, traits: cardTraits(card), to: zone, placementCause: "effect", source
  });
}

export function emitCardPlacement(state, playerId, card, zone, placementCause, source = null) {
  return emitGameEvent(state, { type: "card_placed", playerId, ownerId: card.owner ?? playerId,
    cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category,
    color: card.color, traits: cardTraits(card), to: zone, placementCause, source });
}

export function finalizeRuleDestruction(state, ownerId, card, { from = "hand", to = "trash", source = "配置上限", zone = null } = {}) {
  trace(state, { tag: TRACE_TAGS.REPLACE, op: "destroy", event: "replaced", kind: "placement-limit", cardUid: card.uid, ownerId, from, to });
  state.turnStats.destroyedCards += 1;
  if (isObCard(card)) state.turnStats.destroyedOb += 1;
  if (card.category === "Script" && card.name.includes("聖樹")) state.turnStats.destroyedSacredTreeScripts += 1;
  emitGameEvent(state, {
    type: "card_destroyed", playerId: ownerId, ownerId,
    cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category,
    from, to, zone, source, ruleDestruction: true
  });
  return true;
}

export function placementResult(player, zone, { addedSlots = 1, freedSlots = 0, mode = "normal" } = {}) {
  return evaluatePlacement({
    zone,
    occupied: player[zone]?.length ?? 0,
    limit: player.user?.[`${zone}Limit`],
    addedSlots,
    freedSlots,
    mode
  });
}

export function failForcedPlacement(state, ownerId, card, { from = "hand", zone, source = "効果による強制配置", suppressScriptWindow = false } = {}) {
  const owner = state.players[ownerId];
  if (from === "trash") {
    if (!owner.trash.some((item) => item.uid === card.uid)) owner.trash.push(card);
    finalizeRuleDestruction(state, ownerId, card, { from, to: "trash", zone, source });
  } else {
    moveCardToTrash(state, ownerId, card, source, {
      fromArea: false, suppressScriptWindow,
      ruleDestruction: { from, zone, source }
    });
  }
  addLog(state, `${source}: ${card.name}は配置上限によりエリアへ入らずルール破壊。`, "effect");
  return "failed-forced";
}

export function placeByMode(state, ownerId, card, { zone, mode = "forced-effect", from = "generated", source = "効果による強制配置", addedSlots = 1, freedSlots = 0, suppressScriptWindow = false, requestedSlot = null } = {}) {
  const player = state.players[ownerId];
  const placement = placementResult(player, zone, { addedSlots, freedSlots, mode });
  if (!placement.ok) {
    if (placement.mode === "forced-effect") return failForcedPlacement(state, card.owner ?? ownerId, card, { from, zone, source, suppressScriptWindow });
    return "normal-rejected";
  }
  const placed = placeCardInBoardSlot(player[zone], card, {
    controllerId: ownerId, zoneName: zone, limit: player.user?.[`${zone}Limit`], requestedSlot
  });
  if (!placed) {
    if (placement.mode === "forced-effect") return failForcedPlacement(state, card.owner ?? ownerId, card, { from, zone, source, suppressScriptWindow });
    return "normal-rejected";
  }
  if (!["front", "back"].includes(from)) {
    markFieldEntry(state, card);
    // 生成されたカードは効果が作った値をそのまま使う。実在のカードがエリア外から入る場合だけ初期化する。
    if (from !== "generated") resetLeftAreaState(card);
  }
  return "placed";
}

export function emitRegistryInstalled(state, playerId, card, source = "インストール") {
  card.faceDown = false;
  const event = emitGameEvent(state, { type: "registry_installed", playerId, ownerId: card.owner ?? playerId,
    cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category, source });
  const installer = state.players[playerId];
  if (installer.user.abilityKey === "registry_liberty" && !installer.firstRegistryInstallResolved) {
    installer.firstRegistryInstallResolved = true;
    const drawn = drawCards(state, playerId, 1);
    installer.registryActionUsed = false;
    addLog(state, `${installer.user.abilityName}: 1枚引き、追加のインストール権を得た。`, "effect");
    emitUserAbilityFeedback(state, "registry_liberty", playerId, playerId, {
      branch: "first-install", amount: drawn, outcome: "install-ready", steps: [{ kind: "transfer", from: { kind: "zone_count", playerId, zone: "deck" }, to: { kind: "zone_count", playerId, zone: "hand" }, count: drawn }, { kind: "state_change", target: { kind: "status", playerId, status: "extra_install" }, before: false, after: true }]
    });
  }
  const opponentId = otherPlayer(playerId);
  for (const observer of [...state.players[opponentId].front, ...state.players[opponentId].back].filter((item) => item.id === "STD-226" && !item.sleep && !item.faceDown)) {
    const candidates = [...state.players.player.registry, ...state.players.ai.registry].filter((item) => !item.faceDown);
    if (!candidates.length) continue;
    const request = createSelectionRequest({ mode: "up_to", candidates: candidates.map((item) => item.uid), minimum: 0, maximum: 1,
      candidateLabels: Object.fromEntries(candidates.map((item) => [item.uid, item.name])), label: `${observer.name}: レジストリを裏向き`, message: observer.text,
      continuation: { type: "std226-compress", playerId: opponentId, sourceUid: observer.uid, sourceName: observer.name } });
    enqueueSelection(state, { type: "selection", validTargets: request.candidates, request }, selectionProjectionMeta("engine:std226-compress", opponentId));
  }
  return event;
}

export function placeCardByEffect(state, { sourceOwnerId, controllerId, cardUid, sourceZone, targetZone, sourceName = "効果配置", placementMode = "forced-effect", placementCause = "effect", underUid = null, onPlaced = null } = {}) {
  const sourcePlayer = state.players[sourceOwnerId];
  const controller = state.players[controllerId];
  const sourceCards = sourcePlayer?.[sourceZone];
  const targetCards = controller?.[targetZone];
  if (!Array.isArray(sourceCards) || !Array.isArray(targetCards) || !["front", "back"].includes(targetZone)) return { status: "invalid" };
  const sourceIndex = sourceCards.findIndex((card) => card.uid === cardUid);
  if (sourceIndex < 0) return { status: "missing" };
  const host = underUid ? targetCards.find((card) => card.uid === underUid && isObCard(card)) : null;
  const sourceCard = sourceCards[sourceIndex];
  if (underUid && (!host || sourceCard.category !== "Code")) return { status: "invalid" };
  const [removed] = sourceCards.splice(sourceIndex, 1);
  const card = removed;
  if (host) {
    card.layerRole = "code";
    host.mounted.push(card);
    onPlaced?.(card, targetZone);
    emitCardPlacement(state, controllerId, card, targetZone, placementCause, sourceName);
    emitEffectPlacement(state, controllerId, card, targetZone, sourceName);
    return { status: "placed", card, zoneName: targetZone };
  }
  const placement = placeByMode(state, controllerId, card, { zone: targetZone, from: sourceZone, source: sourceName, mode: placementMode });
  if (placement !== "placed") {
    if (placement === "normal-rejected") sourceCards.splice(sourceIndex, 0, removed);
    return { status: placement === "normal-rejected" ? "rejected" : "failed-placement", card };
  }
  onPlaced?.(card, targetZone);
  emitCardPlacement(state, controllerId, card, targetZone, placementCause, sourceName);
  emitEffectPlacement(state, controllerId, card, targetZone, sourceName);
  return { status: "placed", card, zoneName: targetZone };
}

export function moveCardByEffect(state, playerId, uid, targetZone, sourceName) {
  const player = state.players[playerId];
  const sourceZone = player.front.some((card) => card.uid === uid) ? "front" : player.back.some((card) => card.uid === uid) ? "back" : null;
  if (!sourceZone || sourceZone === targetZone) return fail(state, "移動先は現在と異なるエリアを選んで。", false);
  if (!placementResult(player, targetZone).ok) return fail(state, "移動先エリアが上限。", false);
  const index = player[sourceZone].findIndex((card) => card.uid === uid);
  const [card] = player[sourceZone].splice(index, 1);
  const revealed = revealMountedCode(player[sourceZone], index, card, playerId, sourceZone);
  if (placeByMode(state, playerId, card, { zone: targetZone, mode: "normal", from: sourceZone, source: sourceName }) !== "placed") return false;
  card.sleep = false;
  card.summoningSick = movedSummoningSick(state, card, targetZone);
  addLog(state, `${sourceName}: 「${card.name}」を${targetZone === "front" ? "フロント" : "バック"}へ効果で移動。`, "effect");
  if (revealed) addLog(state, `${card.name}の下にあった${revealed.name}は移動前のエリアに残る。`, "effect");
  triggerMoved(state, playerId, card, sourceZone, targetZone);
  return true;
}
