import { cardAtBoardSlot, inheritBoardSlot, projectZoneSlots } from "../board-slots.js";
import { cardPlacementCostSpec } from "../card-runtime-specs.js";
import { isObCard, isObCategory } from "../card-types.js";
import { placementPermissionSpecsFor } from "../continuous-effect-specs.js";
import { layeredSpecFor } from "../layered-specs.js";
import { createSelectionRequest } from "../selection-model.js";
import { hasOptionalActivationSpec } from "../trigger-specs.js";
import { dealFortressDamage } from "./deal-damage.js";
import { resolveEffect, resolveMandatoryStateChecks, runEffectEntry } from "./effects.js";
import { hasKeyword, keywordValue } from "./keywords.js";
import { getEffectTargets } from "./play-effects.js";
import { notifyCardExecuted } from "./play-notify.js";
import { continueDeferredSpellCleanup, resolveLogin, resolveSpell, spellNeedsTarget } from "./play-spell.js";
import { EVENT_CONTEXT_REQUIRED_IF_IDS, NORMAL_IF_SCRIPT_IDS } from "./scripts.js";
import { addLog, fail, otherPlayer } from "./shared.js";
import { emitGameEvent } from "./triggers.js";
import { CUSTOM_PLAY_CARD_CORE, CUSTOM_PLAY_CARD_CORE_3, CUSTOM_PLAY_CARD_CORE_4, CUSTOM_SPELL_CLEANUP_EXTRA, PASS } from "../effects/custom/index.js";
import { STD121_PLACEMENT_PERMIT, executionCost, ownLayerEntries, placementCostCandidates } from "../effects/generic/cost.js";
import { markFieldEntry } from "../effects/generic/field-entry.js";
import { emitCardPlacement, emitEffectPlacement, failForcedPlacement, placeByMode, placementResult, resolveMountedSourceTrigger } from "../effects/generic/placement.js";
import { runtimeSpellAccessFailure } from "../effects/generic/selection-access.js";
import { moveCardToTrash } from "../effects/generic/trash.js";

export function supportsNormalScriptActivation(card) {
  if (card?.category !== "Script" || EVENT_CONTEXT_REQUIRED_IF_IDS.has(card.id)) return false;
  const condition = keywordValue(card, "IF");
  if (condition) return NORMAL_IF_SCRIPT_IDS.has(card.id);
  return !hasOptionalActivationSpec(card.id);
}

function overclockChoice(card) {
  return String(card?.text ?? "").match(/\[OC\+(\d+)\]/i);
}

// Direct hand execution can prepare only entries whose extra input does not
// precede placement. Login choices happen after placement and remain a later
// continuation; OC, Layered material and placement-cost input do not.
export function supportsDirectHandObExecution(card) {
  return Boolean(card && isObCategory(card.category) && !overclockChoice(card)
    && !Number.isFinite(card.setupCost) && !layeredSpecFor(card) && !cardPlacementCostSpec(card.id));
}

export function enabledSymbols(player) {
  return [...new Set(player.registry.filter((card) => card.category !== "Plugin" && !card.faceDown).map((card) => card.color).filter(Boolean))];
}

// Standalone execution/set uses explicit slots. Mounting inherits its host slot.
export function requestedExecutionSlot(state, playerId, card, { requestedSlot = null, zone = "front", baseUid = null, underUid = null, asScript = false, placementMode = "normal", placementCostPaid = false } = {}) {
  if (requestedSlot === null) return { ok: true };
  if (!card || !(isObCard(card) || ["Code", "Script"].includes(card.category)) || baseUid || underUid || placementMode !== "normal") return { ok: false, reason: "この実行経路では空きマスを指定できません。" };
  if ((card.category === "Script" || asScript) && zone !== "back") return { ok: false, reason: "設置先はバックです。" };
  const player = state.players[playerId];
  const limit = Number(player?.user?.[`${zone}Limit`]);
  if (!player || !["front", "back"].includes(zone) || !Number.isSafeInteger(limit) || !Number.isSafeInteger(requestedSlot) || requestedSlot < 1 || requestedSlot > limit) return { ok: false, reason: "配置マスが不正。" };
  const slots = projectZoneSlots(player[zone], { controllerId: playerId, zoneName: zone, limit: player.user[`${zone}Limit`] });
  const occupant = slots[requestedSlot - 1];
  const cost = cardPlacementCostSpec(card.id);
  if (occupant && cost && !placementCostPaid && placementCostCandidates(state, cost).some(item => item.card.uid === occupant.uid)) return { ok: true };
  return occupant ? { ok: false, reason: "そのマスには既にカードがあります。" } : { ok: true };
}

export const supportsAlternateScriptSetup = card => card?.id === 'STD-184';

export function canExecuteAtSlot(state, playerId, card, options = {}) {
  const slot = requestedExecutionSlot(state, playerId, card, options);
  if (!slot.ok) return slot;
  if (card.category !== "Script" && !options.asScript) return canPlayCard(state, playerId, card, options);
  const player = state.players[playerId];
  if (state.active !== playerId || !placementResult(player, "back").ok && !cardPlacementCostSpec(card.id)) return { ok: false, code: state.active !== playerId ? "NOT_YOUR_TURN" : "ZONE_FULL", reason: "設置するターンまたはバック上限を確認してください。" };
  if (cardPlacementCostSpec(card.id)) return canPlayCard(state, playerId, card, {...options,ignoreColor:true});
  if (options.asScript && (!supportsAlternateScriptSetup(card) || player.memory < Number(card.setupCost ?? 3) || state.mode !== "lab" && card.color && !enabledSymbols(player).includes(card.color))) return { ok: false, reason: "Script設置条件を満たしていません。" };
  return { ok: true };
}

export function canPlayCard(state, playerId, card, { ignoreColor = false, free = false, force = false, allowOffTurn = false, zone = "front", baseUid = null, underUid = null, freedSlots = 0, placementMode = "normal", executionCostReduction = 0, requestedSlot = null } = {}) {
  const slotCheck = requestedExecutionSlot(state, playerId, card, { requestedSlot, zone, baseUid, underUid, placementMode });
  if (!slotCheck.ok) return slotCheck;
  const player = state.players[playerId];
  if (baseUid || underUid) {
    const host = player[zone]?.find(item => item.uid === (baseUid ?? underUid));
    if (!host || baseUid && underUid || baseUid && (host.category !== "Code" || !isObCard(card)) || underUid && (!isObCard(host) || card.category !== "Code") || host.faceDown || placementPermissionSpecsFor(host.id).some(spec => spec.type === "forbid_mount_on_source")) return { ok: false, reason: "このカードにはマウントできません。" };
  }
  const placementCostSpec = cardPlacementCostSpec(card.id);
  if (placementPermissionSpecsFor(card.id).some((spec) => spec.type === "forbid_execution")) return { ok: false, code: "EXECUTION_FORBIDDEN", reason: "このカードは実行できない。" };
  if (!force && !allowOffTurn && state.active !== playerId) return { ok: false, code: "NOT_YOUR_TURN", reason: "今は自分のターンじゃない。" };
  if (card.category === "Plugin") return { ok: false, code: "PLUGIN_INSTALL_ONLY", reason: "Pluginはレジストリへインストールして。" };
  if (!free && !placementCostSpec && player.memory < Math.max(0, executionCost(card, state, playerId) - Number(executionCostReduction ?? 0))) return { ok: false, code: "MEMORY_SHORT", reason: "メモリ不足。" };
  const accessFailure = runtimeSpellAccessFailure(state, playerId, card);
  if (accessFailure) return { ok: false, code: "SPELL_ACCESS_DENIED", reason: accessFailure };
  const requiredZone = placementPermissionSpecsFor(card.id).find((spec) => spec.type === "require_execution_zone")?.zone;
  if (requiredZone && zone !== requiredZone) return { ok: false, code: "ZONE_RESTRICTED", reason: `このカードは実行時${requiredZone === "back" ? "バック" : "フロント"}にのみ配置できる。` };
  if (state.mode !== "lab" && !ignoreColor && card.color && !enabledSymbols(player).includes(card.color)) return { ok: false, code: "SYMBOL_MISSING", symbol: card.color, reason: `${card.color}シンボルがない。先にインストールして。` };
  if (card.category !== "Sp" && !["front", "back"].includes(zone)) return { ok: false, reason: "実行先が不正。" };
  let effectiveFreedSlots = freedSlots;
  if (placementCostSpec) {
    const candidates = placementCostCandidates(state, placementCostSpec);
    const requiredCount = Number(placementCostSpec.selection.count ?? 0);
    if (new Set(candidates.map(({ card: candidate }) => candidate.name)).size < requiredCount) {
      return { ok: false, code: "PLACEMENT_COST_UNMET", reason: `名前の異なる情報管理端末が${requiredCount}枚必要。` };
    }
    if (zone === "back" && candidates.some(({ ownerId, zoneName }) => ownerId === playerId && zoneName === "back")) {
      effectiveFreedSlots = Math.max(Number(effectiveFreedSlots ?? 0), 1);
    }
  }
  const placement = placementResult(player, zone, { addedSlots: baseUid || underUid ? 0 : 1, freedSlots: effectiveFreedSlots, mode: placementMode });
  if (card.category !== "Sp" && !placement.ok && placement.mode === "normal") return { ok: false, code: "ZONE_FULL", reason: `${zone === "front" ? "フロント" : "バック"}上限。` };
  return { ok: true };
}

export function playCardCore(state, playerId, uid, { targetUid = null, targetUids = [], selectionScope = null, free = false, ignoreColor = false, force = false, allowOffTurn = false, zone = "front", baseUid = null, underUid = null, placementCause = "execution", placementSource = null, placementMode = "normal", ocDecision = null, magazineDecision = null, magazineLayerUids = [], registryExecution = false, registryOriginIndex = null, asScript = false, placementCostPermit = null, requestedSlot = null } = {}) {
  const player = state.players[playerId];
  const index = player.hand.findIndex((card) => card.uid === uid);
  if (index < 0) return fail(state, "そのカードは手札にない。", force);
  const card = player.hand[index];
  const slotCheck = requestedExecutionSlot(state, playerId, card, { requestedSlot, zone, baseUid, underUid, asScript, placementMode, placementCostPaid: placementCostPermit === STD121_PLACEMENT_PERMIT });
  if (!slotCheck.ok) return fail(state, slotCheck.reason, force);
  const placementCostSpec = cardPlacementCostSpec(card.id);
  if (placementCostSpec && placementCostPermit !== STD121_PLACEMENT_PERMIT) {
    if (state.placementCostBatch || state.pending || state.prompt) return fail(state, "別の処理または設置コストを処理中。", force);
    if (!force && state.active !== playerId) return fail(state, "Scriptの設置は自分ターン中だけ。", force);
    const candidates = placementCostCandidates(state, placementCostSpec);
    const distinctNames = new Set(candidates.map(({ card: candidate }) => candidate.name));
    const requiredCount = Number(placementCostSpec.selection.count ?? 0);
    if (distinctNames.size < requiredCount) return fail(state, `名前の異なる情報管理端末が${requiredCount}枚必要。`, force);
    if (!placementResult(player, "back", { mode: placementMode }).ok
      && !candidates.some(({ ownerId, zoneName }) => ownerId === playerId && zoneName === "back")) {
      return fail(state, "バック上限を空けられる設置コスト候補がない。", force);
    }
    const request = createSelectionRequest({
      mode: "exact", candidates: candidates.map(({ card: candidate }) => candidate.uid), count: requiredCount,
      groups: requestedSlot !== null && cardAtBoardSlot(player[zone],requestedSlot,{controllerId:playerId,zoneName:zone})
        ? [{id:'requested-placement-slot',minimum:1,maximum:1,candidates:[cardAtBoardSlot(player[zone],requestedSlot,{controllerId:playerId,zoneName:zone}).uid]}] : [],
      candidateLabels: Object.fromEntries(candidates.map(({ ownerId, zoneName, card: candidate }) => [candidate.uid, `${ownerId}/${zoneName}: ${candidate.name}`])),
      label: `設置コストとして破壊する異名カード${requiredCount}枚`, message: card.text,
      continuation: {
        type: "placement-cost-destroy", playerId, sourceUid: card.uid, sourceName: card.name,
        requiredCount, distinctBy: placementCostSpec.selection.distinctBy, namePrefix: placementCostSpec.selection.namePrefix,
        options: { targetUid, targetUids, selectionScope, free, ignoreColor, force, allowOffTurn, zone, baseUid, underUid, placementCause, placementSource, placementMode, registryExecution, registryOriginIndex, asScript, requestedSlot }
      }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  const customPlayCardCore = CUSTOM_PLAY_CARD_CORE[card.id];
  if (customPlayCardCore) {
    const customResult = customPlayCardCore({ player, state, force, card, playerId, free, ignoreColor, zone, requestedSlot, targetUids, placementMode, index, registryExecution, placementSource, asScript });
    if (customResult !== PASS) return customResult;
  }
  const magazineMatch = card.category === "Sp" ? String(card.text ?? "").match(/\[弾倉[:：]\s*(\d+)\]/) : null;
  if (!free && !force && magazineMatch && magazineDecision === null) {
    const amount = Number(magazineMatch[1]);
    const layers = ownLayerEntries(player);
    const discountedCost = Math.max(0, executionCost(card, state, playerId) - amount);
    const canUse = layers.length >= amount && player.memory >= discountedCost;
    const request = createSelectionRequest({
      mode: "scope",
      scopeField: "magazine",
      scopeOptions: canUse ? ["使用しない", "使用する"] : ["使用しない"],
      label: `弾倉：${amount}を使用しますか？`,
      message: canUse ? `自分のレイヤーを${amount}枚消費し、実行メモリを${amount}少なくする。` : `使用に必要なレイヤー${amount}枚または実行メモリが不足している。`,
      continuation: { type: "play-card-magazine-confirm", playerId, sourceUid: uid, amount, options: { targetUid, targetUids, selectionScope, ignoreColor, allowOffTurn, zone, baseUid, underUid, placementCause, placementSource, placementMode, registryExecution, registryOriginIndex, requestedSlot, ocDecision } }
    });
    state.pending = { type: "selection", validTargets: [], request };
    return true;
  }
  const ocMatch = overclockChoice(card);
  if (!free && !force && ocMatch && ocDecision === null) {
    const amount = Number(ocMatch[1]);
    const canPay = player.memory >= executionCost(card, state, playerId) + amount;
    const request = createSelectionRequest({ mode: "scope", scopeField: "oc", scopeOptions: canPay ? ["支払わない", `+${amount}払う`] : ["支払わない"],
      label: `[OC]メモリを追加で+${amount}払いますか？`, message: canPay ? "追加で払うとOC以降の能力がトリガーする。" : "追加メモリが不足している。",
      continuation: { type: "play-card-oc", playerId, sourceUid: uid, amount, options: { targetUid, targetUids, selectionScope, ignoreColor, allowOffTurn, zone, baseUid, underUid, placementCause, placementSource, magazineDecision, magazineLayerUids, registryExecution, registryOriginIndex, requestedSlot } } });
    state.pending = { type: "selection", validTargets: [], request };
    return true;
  }
  if (card.category === "Script") {
    if (!force && state.active !== playerId) return fail(state, "Scriptの設置は自分ターン中だけ。", force);
    if (!placementResult(player, "back", { mode: placementMode }).ok && placementMode !== "forced-effect") return fail(state, "バック上限。", force);
    if (!placementResult(player, "back", { mode: placementMode }).ok && placementMode === "forced-effect") {
      player.hand.splice(index, 1); failForcedPlacement(state, card.owner ?? playerId, card, { from: registryExecution ? "registry" : "hand", zone: "back", source: placementSource ?? "効果による強制配置" }); return true;
    }
    player.hand.splice(index, 1);
    if (!placementResult(player, "back", { mode: placementMode }).ok && placementMode === "forced-effect") {
      failForcedPlacement(state, card.owner ?? playerId, card, { zone: "back", source: placementSource ?? "効果による強制配置" });
      return true;
    }
    card.faceDown = true;
    card.residentActive = false;
    card.sleep = false;
    if (placeByMode(state, playerId, card, { zone: "back", mode: placementMode, from: "hand", source: placementSource ?? "Script設置", requestedSlot }) !== "placed") return true;
    addLog(state, `${player.user.name}がScriptをバックへ裏向きで設置。`, "action");
    emitCardPlacement(state, playerId, card, "back", "set");
    return true;
  }
  let baseIndex = -1;
  let baseCard = null;
  let upperCard = null;
  if (baseUid && underUid) return fail(state, "上下両方の配置先は同時に選べない。", force);
  if (baseUid) {
    baseIndex = player[zone]?.findIndex((item) => item.uid === baseUid) ?? -1;
    baseCard = baseIndex >= 0 ? player[zone][baseIndex] : null;
    if (!baseCard || baseCard.category !== "Code") return fail(state, "上に実行するCodeを選んで。", force);
    if (placementPermissionSpecsFor(baseCard.id).some((spec) => spec.type === "forbid_mount_on_source")) return fail(state, "このCodeにはカードをマウントできない。", force);
    if (!isObCard(card)) return fail(state, "Codeの上へ実行できるのはOb。", force);
  }
  if (underUid) {
    upperCard = player[zone]?.find((item) => item.uid === underUid) ?? null;
    if (!upperCard || !isObCard(upperCard)) return fail(state, "Codeを配置するObを選んで。", force);
    if (card.category !== "Code") return fail(state, "Obの下へ配置できるのはCode。", force);
    if (placementPermissionSpecsFor(upperCard.id).some((spec) => spec.type === "forbid_mount_on_source")) return fail(state, "このカードにはカードをマウントできない。", force);
  }
  const magazineAmount = magazineDecision && magazineMatch ? Number(magazineMatch[1]) : 0;
  const uniqueMagazineLayerUids = [...new Set(magazineLayerUids)];
  const magazineEntries = magazineAmount > 0
    ? ownLayerEntries(player).filter(({ layer }) => uniqueMagazineLayerUids.includes(layer.uid))
    : [];
  if (magazineAmount > 0 && (uniqueMagazineLayerUids.length !== magazineAmount || magazineEntries.length !== magazineAmount)) {
    return fail(state, `弾倉に使用する自分のレイヤーを${magazineAmount}枚選んで。`, force);
  }
  const check = canPlayCard(state, playerId, card, { free: free || Boolean(card.dragFree), ignoreColor, force, allowOffTurn, zone, baseUid, underUid, placementMode, executionCostReduction: magazineAmount });
  if (!check.ok) return fail(state, check.reason, force);
  const firstObExecutionDiscount = !free && !card.dragFree && player.user.abilityKey === "do_or_isnt"
    && isObCard(card) && player.firstObExecutionTurn !== state.turnNumber
    && [...player.front, ...player.back].filter(isObCard).length <= 2;
  const paidExecutionMemory = !free && !card.dragFree
    ? Math.max(0, executionCost(card, state, playerId) - magazineAmount)
    : null;
  const optionalEmptyTarget = card.id === "STD-015" && getEffectTargets(state, otherPlayer(playerId), card).length === 0;
  if (spellNeedsTarget(card) && !targetUid && !targetUids.length && !optionalEmptyTarget) return fail(state, "対象を選んで。", force);
  const customPlayCardCore4 = CUSTOM_PLAY_CARD_CORE_4[card.id];
  if (customPlayCardCore4) {
    const customResult = customPlayCardCore4({ state, force, selectionScope });
    if (customResult !== PASS) return customResult;
  }

  const prePlacement = placementResult(player, zone, { addedSlots: baseUid || underUid ? 0 : 1, mode: placementMode });
  if (card.category !== "Sp" && !prePlacement.ok && prePlacement.mode === "forced-effect") {
    player.hand.splice(index, 1);
    failForcedPlacement(state, card.owner ?? playerId, card, { from: registryExecution ? "registry" : "hand", zone, source: placementSource ?? "効果による強制配置" });
    return true;
  }

  player.hand.splice(index, 1);
  if (registryExecution && !["STD-215", "STD-220"].includes(card.id)) player.triggerUsage["STD-236:registry-execute"] = true;
  const customPlayCardCore3 = CUSTOM_PLAY_CARD_CORE_3[card.id];
  if (customPlayCardCore3) customPlayCardCore3({ card, state, registryExecution });
  card.executedFromRegistry = Boolean(registryExecution);
  if (paidExecutionMemory !== null) player.memory -= paidExecutionMemory;
  if (magazineAmount > 0) {
    const consumed = [];
    for (const { host, layer } of magazineEntries) {
      const layerIndex = host.mounted.findIndex((candidate) => candidate.uid === layer.uid);
      if (layerIndex < 0) continue;
      const [paidLayer] = host.mounted.splice(layerIndex, 1);
      consumed.push(paidLayer);
      moveCardToTrash(state, paidLayer.owner ?? playerId, paidLayer, `${card.name}の[弾倉:${magazineAmount}]`);
    }
    addLog(state, `${card.name}: [弾倉:${magazineAmount}]でレイヤー${consumed.length}枚を消費し、実行メモリを${magazineAmount}軽減。`, "effect");
    emitGameEvent(state, {
      type: "layers_consumed",
      playerId,
      ownerId: playerId,
      amount: consumed.length,
      cardUids: consumed.map((layer) => layer.uid),
      sourceCardId: card.id,
      sourceCardUid: card.uid,
      source: card.name,
      reason: "magazine"
    });
    for (const source of [...player.front, ...player.back].filter((item) => item.id === "SZTB-095" && !item.faceDown)) {
      dealFortressDamage(state, otherPlayer(playerId), 1, playerId, source.name);
      addLog(state, `${source.name}: [弾倉]によるレイヤー消費を検知し、相手ユーザーに1ダメージ。`, "effect");
    }
    resolveMandatoryStateChecks(state);
  }
  delete card.revealedExecutionCost;
  delete card.revealed;
  if (!free && ocDecision && ocMatch) {
    player.memory -= Number(ocMatch[1]);
    card.ocPaidAmount = Number(ocMatch[1]);
  } else delete card.ocPaidAmount;
  delete card.dragFree;
  addLog(state, `${player.user.name}が「${card.name}」を${free ? "ドラッグ" : "実行"}。`, "action");

  const placement = placementResult(player, zone, { addedSlots: baseUid || underUid ? 0 : 1, mode: placementMode });
  if (card.category !== "Sp" && !placement.ok && placement.mode === "forced-effect") {
    failForcedPlacement(state, card.owner ?? playerId, card, { zone, source: placementSource ?? "効果による強制配置" });
    return true;
  }

  if (card.category === "Sp") {
    // 1.2.1: the Sp goes to the trash only after its whole text and every choice it needs are finished.
    // Until then it stays in flight as state.deferredSpellCleanup (continueDeferredSpellCleanup finishes it).
    const spellCleanupExtra = CUSTOM_SPELL_CLEANUP_EXTRA[card.id];
    state.deferredSpellCleanup = { playerId, card, zone, placementCause, placementSource, ...(spellCleanupExtra ? spellCleanupExtra({ card }) : {}) };
    resolveEffect(state, () => {
      resolveSpell(state, playerId, card, targetUid, { targetUids, selectionScope });
      continueDeferredSpellCleanup(state);
    });
    return true;
  }

  card.sleep = false;
  card.damage = 0;
  card.summoningSick = !hasKeyword(card, "QA");
  markFieldEntry(state, card);
  if (upperCard) {
    upperCard.mounted.push(card);
    card.layerRole = "mount";
    addLog(state, `${card.name}を${upperCard.name}の下へ配置。レイヤー${upperCard.mounted.length + 1}。`, "effect");
    notifyCardExecuted(state, playerId, card, { firstObExecutionDiscount, paidExecutionMemory });
    return true;
  } else if (baseCard) {
    inheritBoardSlot(card, baseCard, { controllerId: playerId, zoneName: zone });
    player[zone].splice(baseIndex, 1, card);
    baseCard.layerRole = "mount";
    card.mounted = [baseCard, ...(baseCard.mounted.splice(0))];
    addLog(state, `${card.name}を${baseCard.name}の上へ実行。レイヤー${card.mounted.length + 1}。`, "effect");
    resolveMountedSourceTrigger(state, playerId, card, baseCard);
  } else {
    if (placeByMode(state, playerId, card, { zone, mode: placementMode, from: "hand", source: placementSource ?? "実行", requestedSlot }) !== "placed") return true;
  }
  resolveEffect(state, () => resolveLogin(state, playerId, card));
  notifyCardExecuted(state, playerId, card, { firstObExecutionDiscount, paidExecutionMemory });
  emitCardPlacement(state, playerId, card, zone, placementCause, placementSource);
  if (placementCause === "effect") emitEffectPlacement(state, playerId, card, zone, placementSource);
  return true;
}

export function playCard(state, playerId, uid, options = {}) {
  if (options.requestedSlot != null) {
    // Reject a new explicit-slot command before entering/mutating effect state.
    if (state.winner || state.victory?.lockedOutcome || state.pending || state.prompt || state.effectResolution) return false;
    const card = state.players[playerId]?.hand.find(item => item.uid === uid);
    if (!card || !canExecuteAtSlot(state, playerId, card, { ...options, free: options.free || Boolean(card.dragFree) }).ok) return false;
  }
  return runEffectEntry(state, "card", playerId, () => playCardCore(state, playerId, uid, options));
}
