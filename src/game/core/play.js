import { compileEffectText, hasKeyword, keywordValue } from "../../../packages/effect-compiler/index.js";
import { cardAtBoardSlot, inheritBoardSlot, normalizeBoardSlots, projectZoneSlots } from "../board-slots.js";
import { cardPlacementCostSpec, cardRuntimeSpec } from "../card-runtime-specs.js";
import { isObCard, isObCategory } from "../card-types.js";
import { placementPermissionSpecsFor } from "../continuous-effect-specs.js";
import { flattenedLayerCount, flattenMaterialStack, layeredCandidates, layeredSelectionPlan, layeredSpecFor, normalizeMountedStack, validatesLayeredSelection } from "../layered-specs.js";
import { createSelectionRequest, createSelectionSpec, selectionRequestFromSpec } from "../selection-model.js";
import { hasOptionalActivationSpec } from "../trigger-specs.js";
import { continueStd211DestructionBatch } from "../../cards/std/std_211_effects.js";
import { dealFortressDamage } from "./deal-damage.js";
import { resolveEffect, resolveMandatoryStateChecks, runEffectEntry } from "./effects.js";
import { enqueueSelection, selectionProjectionMeta } from "./projection.js";
import { EVENT_CONTEXT_REQUIRED_IF_IDS, NORMAL_IF_SCRIPT_IDS, openScriptActivationWindow } from "./scripts.js";
import { addLog, cardTraits, fail, findCard, isArmsBandOb, newActionBlock, otherPlayer, provisional } from "./shared.js";
import { drainTriggerQueue, emitGameEvent, emitUserAbilityFeedback } from "./triggers.js";
import { CUSTOM_ACTIVATE_CARD_EFFECT_CORE, CUSTOM_GET_EFFECT_ACTIVATION_TARGETS, CUSTOM_GET_EFFECT_ACTIVATION_TARGETS_2, CUSTOM_GET_EFFECT_TARGETS, CUSTOM_INSTALL_CARD, CUSTOM_NORMAL_SPELL_SELECTION, CUSTOM_NOTIFY_CARD_EXECUTED, CUSTOM_PLAY_CARD_CORE, CUSTOM_PLAY_CARD_CORE_3, CUSTOM_PLAY_CARD_CORE_4, CUSTOM_RESOLVE_LOGIN, CUSTOM_RESOLVE_LOGIN_2, CUSTOM_RESOLVE_SPELL, CUSTOM_SPELL_CLEANUP_EXTRA, PASS } from "../effects/custom/index.js";
import { executeCardRuntimeSpec, executeRuntimeActions, runtimeActionFeasible } from "../effects/generic/actions.js";
import { STD121_PLACEMENT_PERMIT, consumeSelectedSourceLayers, executionCost, magazineExecutionCandidates, ownLayerEntries, placementCostCandidates } from "../effects/generic/cost.js";
import { destroyCard, distributeLayeredFollowers, emitCardPlacement, emitEffectPlacement, emitRegistryInstalled, failForcedPlacement, markFieldEntry, moveCardToTrash, movedSummoningSick, placeByMode, placementResult, resolveMountedSourceTrigger, revealMountedCode, triggerMoved } from "../effects/generic/placement.js";
import { beginAllocationSelectionModule, matchesModuleFilter, moveRemainderToDeck, runtimeSpellAccessFailure, takeViewedFromDeck } from "../effects/generic/selection.js";

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

export function relogPreparationKind(card, layerCount = flattenedLayerCount(card)) {
  const compiled = compileEffectText(card?.text ?? "", { category: card?.category, id: card?.id });
  const operationTypes = new Set((compiled.operations ?? []).map((operation) => operation.type));
  if (operationTypes.has("registry_executable_and_logout_install_self")
    || operationTypes.has("logout_registry_replacement_and_registry_execute")) return "registry";
  if (layerCount > 0 && operationTypes.has("replace_move_cost")) return "payment-choice";
  return "normal";
}

// A Code that an Ob can be re-executed onto: face-up, in the target area, not forbidding mounts.
function relogBaseCode(player, zone, baseUid) {
  const host = player?.[zone]?.find((item) => item.uid === baseUid) ?? null;
  if (!host || host.category !== "Code" || host.faceDown
    || placementPermissionSpecsFor(host.id).some((spec) => spec.type === "forbid_mount_on_source")) return null;
  return host;
}

export function canDirectRelogAtSlot(state, playerId, card, { sourceZone, zone, requestedSlot, layerCount = null, baseUid = null } = {}) {
  const player = state?.players?.[playerId];
  if (!player || state.active !== playerId || !isObCard(card)) return { ok: false };
  const effectiveLayerCount = layerCount === null ? flattenedLayerCount(card) : layerCount;
  if (!Number.isSafeInteger(effectiveLayerCount) || effectiveLayerCount < 0 || Object.is(effectiveLayerCount, -0)) return { ok: false };
  if (!["front", "back"].includes(sourceZone) || !["front", "back"].includes(zone)
    || sourceZone === zone || sourceZone !== (zone === "front" ? "back" : "front")) return { ok: false };
  const preparationKind = relogPreparationKind(card, effectiveLayerCount);
  if (preparationKind === "registry") return requestedSlot === null && baseUid === null && player.memory >= Number(card.cost ?? 0) ? { ok: true } : { ok: false };
  if (baseUid !== null) {
    if (requestedSlot !== null || !relogBaseCode(player, zone, baseUid)) return { ok: false };
    return player.memory >= (preparationKind === "payment-choice" ? 1 : Number(card.cost ?? 0)) ? { ok: true } : { ok: false };
  }
  const slot = requestedExecutionSlot(state, playerId, card, { zone, requestedSlot });
  if (!slot.ok) return slot;
  if (!placementResult(player, zone).ok) return { ok: false };
  if (player.memory < (preparationKind === "payment-choice" ? 1 : Number(card.cost ?? 0))) return { ok: false };
  return { ok: true };
}

// Read-only: the same conditions installCard enforces, with a stable code.
export function installCheck(state, playerId, uid) {
  const player = state.players[playerId];
  if (!player.hand.some((card) => card.uid === uid)) return { ok: false, code: "CARD_NOT_IN_HAND", reason: "そのカードは手札にない。" };
  if (state.active !== playerId) return { ok: false, code: "NOT_YOUR_TURN", reason: "今は自分のターンじゃない。" };
  if (player.registryActionUsed) return { ok: false, code: "REGISTRY_ACTION_USED", reason: "このターンのレジストリ操作権は使用済み。" };
  return { ok: true };
}

export function installCard(state, playerId, uid, { force = false } = {}) {
  const player = state.players[playerId];
  const index = player.hand.findIndex((card) => card.uid === uid);
  if (index < 0) return fail(state, "そのカードは手札にない。", force);
  if (!force) { const blocked = newActionBlock(state); if (blocked) return fail(state, blocked, false); }
  if (!force) { const check = installCheck(state, playerId, uid); if (!check.ok) return fail(state, check.reason, force); }
  const [card] = player.hand.splice(index, 1);
  player.registry.push(card);
  player.installedThisTurn = true;
  player.registryActionUsed = true;
  emitRegistryInstalled(state, playerId, card, "通常インストール");
  addLog(state, `${player.user.name}が「${card.name}」をレジストリへインストール。${card.category === "Plugin" ? `P-in（${card.name}）有効。` : `${card.color}シンボル有効。`}`, "action");
  const customInstallCard = CUSTOM_INSTALL_CARD[card.id];
  if (customInstallCard) customInstallCard({ state, playerId, card });
  return true;
}

export function configurePlugin(state, playerId, uid, value) {
  const plugin = state.players[playerId].registry.find((card) => card.uid === uid && !card.faceDown && (card.category === "Plugin" || card.id === "STD-224"));
  if (!plugin) return fail(state, "指定するPluginがレジストリにない。", false);
  plugin.pluginValue = Number(value);
  state.prompt = null;
  addLog(state, `P-in（${plugin.name}）：メモリ${plugin.pluginValue}を監視。`, "effect");
  return true;
}

function recoverRegistryCardCore(state, playerId, uid) {
  const player = state.players[playerId];
  if (state.active !== playerId) return fail(state, "回収は自分ターン中だけ。", false);
  if (player.registryActionUsed) return fail(state, "このターンのレジストリ操作権は使用済み。", false);
  const index = player.registry.findIndex((card) => card.uid === uid);
  if (index < 0) return fail(state, "そのカードはレジストリにない。", false);
  const [card] = player.registry.splice(index, 1);
  player.hand.push(card);
  emitGameEvent(state, { type: "registry_left", playerId, ownerId: card.owner ?? playerId, cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category, reason: "recover" });
  player.registryActionUsed = true;
  player.installedThisTurn = true;
  addLog(state, `${player.user.name}が「${card.name}」をレジストリから手札へ回収。`, "action");
  return true;
}

export function recoverRegistryCard(state, playerId, uid) {
  return runEffectEntry(state, "registry-recover", playerId, () => recoverRegistryCardCore(state, playerId, uid));
}

export function canExecuteRegistryCard(state, playerId, card, options = {}) {
  const player = state.players[playerId];
  const selfExecutable = ["STD-215", "STD-220"].includes(card.id);
  const sourceActive = [...player.front, ...player.back].some((item) => item.id === "STD-236");
  if (!sourceActive && !selfExecutable) return { ok: false, reason: "不乱 健博士がエリアにいない。" };
  if (state.active !== playerId) return { ok: false, reason: "自分ターン中だけ。" };
  if (!selfExecutable && player.triggerUsage["STD-236:registry-execute"]) return { ok: false, reason: "このターンは実行済み。" };
  if (card.faceDown) return { ok: false, reason: "裏向きのレジストリカードは実行できない。" };
  if (!player.registry.some((item) => item.uid === card.uid)) return { ok: false, reason: "レジストリにない。" };
  const magazineMatch = card.category === "Sp" ? String(card.text ?? "").match(/\[弾倉[:：]\s*(\d+)\]/) : null;
  const magazineAmount = Number(magazineMatch?.[1] ?? 0);
  const executionCostReduction = magazineAmount > 0 && ownLayerEntries(player).length >= magazineAmount ? magazineAmount : 0;
  const normal = { ...options, ignoreColor: selfExecutable, executionCostReduction };
  return card.category === "Script" || options.asScript ? canExecuteAtSlot(state, playerId, card, normal) : canPlayCard(state, playerId, card, normal);
}

export function executeRegistryCard(state, playerId, uid, options = {}) {
  const player = state.players[playerId];
  const index = player.registry.findIndex((item) => item.uid === uid);
  if (index < 0) return false;
  const card = player.registry[index];
  const check = canExecuteRegistryCard(state, playerId, card, { ...options, zone: options.zone ?? "front", baseUid: options.baseUid ?? null, underUid: options.underUid ?? null });
  if (!check.ok) return fail(state, check.reason, false);
  player.registry.splice(index, 1);
  player.hand.push(card);
  const outcome = playCard(state, playerId, uid, { ...options, ignoreColor: options.ignoreColor ?? ["STD-215", "STD-220"].includes(card.id), registryExecution: true, registryOriginIndex: index });
  const awaitingExecutionChoice = outcome === true
    && ["play-card-oc", "play-card-magazine-confirm", "play-card-magazine-layers"].includes(state.pending?.request?.continuation?.type)
    && state.pending.request.continuation.sourceUid === uid;
  if (awaitingExecutionChoice) return true;
  const resultingLocation = findCard(state, uid);
  const ok = outcome === true && (card.category === "Sp" || ["front", "back", "mounted"].includes(resultingLocation?.zoneName));
  if (!ok) {
    const handIndex = player.hand.findIndex((item) => item.uid === uid);
    if (handIndex >= 0) player.registry.splice(index, 0, ...player.hand.splice(handIndex, 1));
  } else emitGameEvent(state, { type: "registry_left", playerId, ownerId: card.owner ?? playerId, cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category, reason: "execute" });
  return outcome;
}

export function enabledSymbols(player) {
  return [...new Set(player.registry.filter((card) => card.category !== "Plugin" && !card.faceDown).map((card) => card.color).filter(Boolean))];
}

// Standalone execution/set uses explicit slots. Mounting inherits its host slot.
function requestedExecutionSlot(state, playerId, card, { requestedSlot = null, zone = "front", baseUid = null, underUid = null, asScript = false, placementMode = "normal", placementCostPaid = false } = {}) {
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

export function spellNeedsTarget(card) {
  return ["STD-011", "STD-014", "STD-015", "STD-032", "STD-033", "STD-086", "STD-104", "STD-111", "STD-138", "STD-202", "STD-203", "STD-209", "SZTB-096"].includes(card.id);
}

// These are the existing normal input rules, shared by draft and submit.
// The class catalog is public and never depends on either hidden deck.
export function normalSpellSelection(state, playerId, card) {
  if (card.category !== "Sp") return null;
  const customNormalSpellSelection = CUSTOM_NORMAL_SPELL_SELECTION[card.id];
  if (customNormalSpellSelection) {
    const customResult = customNormalSpellSelection({ state, playerId });
    if (customResult !== PASS) return customResult;
  }
  const candidates = spellNeedsTarget(card) ? getEffectTargets(state, card.id === "STD-111" ? playerId : otherPlayer(playerId), card) : [];
  const count = spellNeedsTarget(card) && !(card.id === "STD-015" && candidates.length === 0) ? 1 : 0;
  return { candidates, minimum: count, maximum: count, scopes: [], groups: [] };
}

export function normalExecutionCheck(state, playerId, card, options = {}, registry = false) {
  if (card.dragFree || card.category === "Plugin") return { ok: false, code: card.category === "Plugin" ? "PLUGIN_INSTALL_ONLY" : "EXECUTION_FORBIDDEN" };
  if (registry) return canExecuteRegistryCard(state, playerId, card, options);
  if (layeredSpecFor(card)) return {ok:false,code:"LAYERED_ONLY"};
  const amount = Number(String(card.text ?? "").match(/\[弾倉[:：]\s*(\d+)\]/)?.[1] ?? 0);
  const normal = { ...options, executionCostReduction: amount > 0 && ownLayerEntries(state.players[playerId]).length >= amount ? amount : 0 };
  return card.category === "Script" || options.asScript ? canExecuteAtSlot(state, playerId, card, normal) : canPlayCard(state, playerId, card, normal);
}

export function normalCardEffectSelection(state, playerId, card, effectId, targetUids = []) {
  const effect = getActivatableEffects(state, playerId, card).find(item => item.id === effectId && item.enabled);
  if (!effect || card.faceDown || effect.kind === "proxy" && state.mode !== "lab" && card.color && !enabledSymbols(state.players[playerId]).includes(card.color)) return null;
  const candidates = getEffectActivationTargets(state, playerId, card, effectId);
  const count = card.id === "STD-196" ? 2 : candidates.length || ["STD-192", "STD-157", "STD-049", "STD-169"].includes(card.id) ? 1 : 0;
  const moveUid = card.id === "STD-200" ? card.uid : card.id === "STD-192" ? targetUids[0] : null;
  const moving = moveUid ? findCard(state, moveUid) : null;
  const zones = moving ? [moving.zoneName === "front" ? "back" : "front"].filter(zone => placementResult(state.players[playerId], zone).ok) : [];
  return { effect, candidates, minimum: count, maximum: count, needsZone: ["STD-192", "STD-200"].includes(card.id), zones };
}

export function finalizeDeferredSpellCleanup(state, { replacementHostUid = null } = {}) {
  const deferred = state.deferredSpellCleanup;
  if (!deferred) return false;
  const { playerId, card, zone, placementCause, placementSource } = deferred;
  const player = state.players[playerId];
  const host = replacementHostUid
    ? [...player.front, ...player.back].find((item) => item.uid === replacementHostUid && item.id === "SZTB-095" && !item.faceDown)
    : null;
  if (host) {
    card.layerRole = "layered";
    host.mounted.push(card);
    player.triggerUsage[`${host.uid}:sztb095-sp-replacement`] = true;
    addLog(state, `${host.name}: ${card.name}をゴミ箱へ送るかわりにレイヤーへ加えた。`, "effect");
  } else {
    moveCardToTrash(state, playerId, card, card.name);
  }
  state.deferredSpellCleanup = null;
  notifyCardExecuted(state, playerId, card);
  emitCardPlacement(state, playerId, card, zone, placementCause, placementSource);
  return true;
}

export function continueDeferredSpellCleanup(state) {
  const deferred = state.deferredSpellCleanup;
  if (!deferred || state.pending || state.prompt) return false;
  if (state.std211DestructionBatch) return continueStd211DestructionBatch(state);
  const { playerId, card } = deferred;
  const player = state.players[playerId];
  if (deferred.postEffect === "arms-band-jacket" && !deferred.postEffectDone) {
    deferred.postEffectDone = true;
    if ([...player.front, ...player.back].some(isArmsBandOb)) {
      const request = createSelectionRequest({
        mode: "scope", scopeField: "zone", scopeOptions: ["フロント", "バック"],
        label: `${card.name}: アームズバンド・ジャケットの配置先`,
        message: "自分エリアに名称:アームズバンドObが存在するため、ジャケットを生成し配置する。",
        continuation: { type: "sztb-jacket-place", playerId, sourceName: card.name }
      });
      state.pending = { type: "selection", validTargets: [], request };
      return true;
    }
  }
  const hosts = [...player.front, ...player.back].filter((item) => item.id === "SZTB-095" && !item.faceDown
    && !player.triggerUsage[`${item.uid}:sztb095-sp-replacement`]);
  if (hasKeyword(card, "MAGAZINE") && hosts.length) {
    const request = createSelectionRequest({
      mode: "up_to", candidates: hosts.map((item) => item.uid), count: 1, minimum: 0, maximum: 1,
      candidateLabels: Object.fromEntries(hosts.map((item) => [item.uid, item.name])),
      label: "実行したSpをレイヤーへ加える", message: "選ばず確定すると通常通りゴミ箱へ送る。各ターン1度。",
      continuation: { type: "sztb095-sp-replacement", playerId }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return true;
  }
  return finalizeDeferredSpellCleanup(state);
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

export function notifyCardExecuted(state, executingPlayerId, executedCard, { firstObExecutionDiscount = false, paidExecutionMemory = null } = {}) {
  const residentOwnerId = otherPlayer(executingPlayerId);
  const owner = state.players[residentOwnerId];
  const executingOwner = state.players[executingPlayerId];
  if (isObCard(executedCard)) {
    for (const [controllerId, controller] of Object.entries(state.players)) {
      for (const source of controller.back.filter((card) => card.id === "STD-184" && card.std184Script && card.faceDown)) {
        const request = createSelectionRequest({ mode: "scope", scopeField: "place", scopeOptions: ["配置しない", "Obとして配置する"],
          label: `${source.name}: Obのログイン`, message: source.text,
          continuation: { type: "std184-place-ob", playerId: controllerId, sourceUid: source.uid, sourceName: source.name } });
        enqueueSelection(state, { type: "selection", validTargets: [], request }, selectionProjectionMeta("engine:std184-place", controllerId));
      }
    }
  }
  const tackle = owner.registry.find((card) => card.id === "STD-224" && !card.faceDown && Number(card.pluginValue) === Number(executedCard.cost ?? 0));
  const placedLocation = findCard(state, executedCard.uid);
  if (tackle && placedLocation && ["front", "back"].includes(placedLocation.zoneName)) {
    const tackleIndex = owner.registry.findIndex((card) => card.uid === tackle.uid);
    if (tackleIndex >= 0) moveCardToTrash(state, tackle.owner ?? residentOwnerId, owner.registry.splice(tackleIndex, 1)[0], tackle.name);
    destroyCard(state, executingPlayerId, executedCard.uid, { source: tackle.name, suppressReplacement: true });
    addLog(state, `${tackle.name}: 指定メモリ${tackle.pluginValue}と一致し、これと${executedCard.name}を破壊。`, "effect");
  }
  if (!state.prompt && isObCard(executedCard)) {
    const takeover = owner.back.find((card) => card.id === "STD-204" && card.category === "Script" && card.faceDown);
    if (takeover) {
      openScriptActivationWindow(state, residentOwnerId, takeover, {
        type: "card_executing", playerId: executingPlayerId, ownerId: executedCard.owner ?? executingPlayerId,
        cardUid: executedCard.uid, cardId: executedCard.id, cardName: executedCard.name, category: executedCard.category, color: executedCard.color
      }, { replacementTargetUid: executedCard.uid });
    }
  }
  const placed = findCard(state, executedCard.uid);
  if (!state.prompt && placed && ["front", "back"].includes(placed.zoneName)) {
    const candidateOwners = [otherPlayer(executingPlayerId), executingPlayerId];
    for (const scriptOwnerId of candidateOwners) {
      const scriptOwner = state.players[scriptOwnerId];
      const scripts = scriptOwner.back.filter((item) => {
        if (item.category !== "Script" || !item.faceDown) return false;
        const customNotifyCardExecuted = CUSTOM_NOTIFY_CARD_EXECUTED[item.id];
        if (customNotifyCardExecuted) {
          const customResult = customNotifyCardExecuted({ scriptOwnerId, executingPlayerId, executedCard, scriptOwner });
          if (customResult !== PASS) return customResult;
        }
        return false;
      });
      for (const script of scripts) {
        openScriptActivationWindow(state, scriptOwnerId, script, {
          type: "card_executing", playerId: executingPlayerId, ownerId: executedCard.owner ?? executingPlayerId,
          cardUid: executedCard.uid, cardId: executedCard.id, cardName: executedCard.name, category: executedCard.category, color: executedCard.color
        }, { eventTargetUid: executedCard.uid, eventTargetOwnerId: executingPlayerId, eventCardColor: executedCard.color });
      }
    }
  }
  const pluginIndex = owner.registry.findIndex((card) => card.id === "STD-224" && card.pluginValue === Number(executedCard.cost));
  if (pluginIndex >= 0 && executedCard.category !== "Sp") {
    const [plugin] = owner.registry.splice(pluginIndex, 1);
    moveCardToTrash(state, plugin.owner ?? residentOwnerId, plugin, plugin.name);
    const location = findCard(state, executedCard.uid);
    if (location && ["front", "back"].includes(location.zoneName)) destroyCard(state, executingPlayerId, executedCard.uid, { source: `P-in（${plugin.name}）`, suppressReplacement: true });
    addLog(state, `P-in（${plugin.name}）：メモリ${plugin.pluginValue}を検知し、Pluginと実行カードを破壊。`, "effect");
  }
  for (const source of [...owner.front, ...owner.back].filter((card) => card.id === "SZTB-094" && !card.faceDown && !card.sleep)) {
    if (magazineExecutionCandidates(state, residentOwnerId).length) {
      (state.independentEffects ??= []).push({ kind: "SZTB-094-COUNTER", playerId: residentOwnerId, sourceUid: source.uid, sourceName: source.name });
    }
  }
  emitGameEvent(state, {
    type: "card_executed",
    playerId: executingPlayerId,
    ownerId: executedCard.owner ?? executingPlayerId,
    cardUid: executedCard.uid,
    cardId: executedCard.id,
    cardName: executedCard.name,
    category: executedCard.category
    , traits: cardTraits(executedCard)
  });
  if (isObCard(executedCard)) {
    const player = state.players[executingPlayerId];
    player.firstObExecutionTurn = state.turnNumber;
    if (firstObExecutionDiscount) emitUserAbilityFeedback(state, "do_or_isnt", executingPlayerId, executingPlayerId, {
      branch: "first-ob-discount", amount: paidExecutionMemory, anchorCardUid: executedCard.uid, steps: [{ kind: "measurement", target: { kind: "card_stat", playerId: executingPlayerId, metric: "effective_cost", cardUid: executedCard.uid }, before: paidExecutionMemory, after: paidExecutionMemory }]
    });
  }
}

export function resolveLogin(state, playerId, card) {
  const player = state.players[playerId];
  const opponent = state.players[otherPlayer(playerId)];
  if (cardRuntimeSpec(card.id, "login")) {
    executeCardRuntimeSpec(state, "login", playerId, card);
    return;
  }
  const customResolveLogin2 = CUSTOM_RESOLVE_LOGIN_2[card.id];
  if (customResolveLogin2) customResolveLogin2({ state, playerId, card });
  const selectionModule = card.compiled?.selectionModules?.find((module) => module.module === "look_select_remainder");
  if (selectionModule) {
    // 見ている間も山札に置いたまま(山札外に出すとランタイムのID台帳と枚数が合わなくなる)
    const viewed = player.deck.slice(Math.max(0, player.deck.length - selectionModule.lookCount));
    const eligible = viewed.filter((candidate) => matchesModuleFilter(candidate, selectionModule.selection.filter));
    if (!eligible.length) {
      moveRemainderToDeck(player, takeViewedFromDeck(player, viewed.map((viewedCard) => viewedCard.uid)), selectionModule.remainder.position);
      addLog(state, `${card.name}: 見たカードに条件適合なし。残りを山札${selectionModule.remainder.position === "bottom" ? "下" : "上"}へ。`, "effect");
      return;
    }
    const request = selectionRequestFromSpec(createSelectionSpec({ candidates: eligible.map((candidate) => candidate.uid), minimum: 1, maximum: Math.min(selectionModule.selection.maximum, eligible.length) }), {
      candidateLabels: Object.fromEntries(eligible.map((candidate) => [candidate.uid, candidate.name])), label: `見た${viewed.length}枚から選択`, message: card.text,
      continuation: { type: "selection-module-look", playerId, sourceName: card.name, module: selectionModule, viewedUids: viewed.map((viewedCard) => viewedCard.uid) }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return;
  }
  const loginAccess = card.compiled?.operations?.find((operation) => operation.type === "access") && /レジストリにインストール/.test(card.text);
  if (loginAccess && player.deck.length) {
    const request = selectionRequestFromSpec(createSelectionSpec({ candidates: player.deck.map((candidate) => candidate.uid), minimum: 1, maximum: 1 }), {
      candidateLabels: Object.fromEntries(player.deck.map((candidate) => [candidate.uid, candidate.name])), label: "アクセスしてレジストリへインストール", message: card.text,
      continuation: { type: "selection-module-access-move", playerId, sourceName: card.name, source: "deck", destination: "registry", shuffleRemaining: true }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return;
  }
  const customResolveLogin = CUSTOM_RESOLVE_LOGIN[card.id];
  if (customResolveLogin) customResolveLogin({ player, card, playerId, state, opponent });
  if (hasKeyword(card, "LAYERED")) provisional(state, `${card.name}のレイヤード条件・軽減は簡易処理。`, card);
  if (card.compiled?.status && card.compiled.status !== "supported") provisional(state, `${card.name}: 効果解析 ${card.compiled.status}`, card);
}

export function resolveSpell(state, playerId, card, targetUid, { targetUids = [], selectionScope = null } = {}) {
  const opponentId = otherPlayer(playerId);
  const opponent = state.players[opponentId];
  const player = state.players[playerId];
  if (executeCardRuntimeSpec(state, "spell", playerId, card, { targetUid })) return;
  const customResolveSpell = CUSTOM_RESOLVE_SPELL[card.id];
  if (customResolveSpell) {
    const customResult = customResolveSpell({ player, state, playerId, card, targetUids, targetUid, opponentId, selectionScope });
    if (customResult !== PASS) return customResult;
  }
}

export function getEffectTargets(state, targetPlayerId, sourceCard) {
  const player = state.players[targetPlayerId];
  const zones = sourceCard.text?.includes("フロント") ? ["front"] : ["front", "back"];
  let cards = zones.flatMap((zoneName) => player[zoneName]);
  const targetsOpponent = Boolean(sourceCard.owner && sourceCard.owner !== targetPlayerId);
  if (targetsOpponent) {
    cards = cards.filter((card) => !hasKeyword(card, "FIREWALL"));
    const decoys = cards.filter((card) => hasKeyword(card, "DECOY"));
    if (decoys.length && !hasKeyword(sourceCard, "HACKING")) cards = decoys;
  }
  const customGetEffectTargets = CUSTOM_GET_EFFECT_TARGETS[sourceCard.id];
  if (customGetEffectTargets) {
    const customResult = customGetEffectTargets({ cards, targetPlayerId, player });
    if (customResult !== PASS) return customResult;
  }
  return ["STD-033", "STD-209"].includes(sourceCard.id) ? cards : cards.filter(isObCard);
}

export function getActivatableEffects(state, playerId, card) {
  const location = findCard(state, card.uid);
  if (!location || location.playerId !== playerId || !["hand", "front", "back"].includes(location.zoneName)) return [];
  return card.compiled.keywords
    .filter((keyword) => ["UPDATE", "PROXY"].includes(keyword.name))
    .filter((keyword) => keyword.name !== "PROXY" || ["STD-048", "STD-049", "STD-106", "STD-124", "STD-160", "STD-169"].includes(card.id))
    .filter((keyword) => keyword.name === "PROXY" ? location.zoneName === "hand" : ["front", "back"].includes(location.zoneName))
    .map((keyword, index) => ({
      id: `${card.id}:${keyword.name.toLowerCase()}:${index}`,
      kind: keyword.name.toLowerCase(),
      label: keyword.name === "UPDATE" ? `[アップデート:${keyword.value}]` : `プロキシ:${keyword.value}(コスト)`,
      cost: Number(keyword.value ?? 0),
      text: card.text,
      enabled: state.active === playerId
        && state.players[playerId].memory >= Number(keyword.value ?? 0)
        && (!cardRuntimeSpec(card.id, "update")?.requiresResidentActive || card.residentActive === true)
        && (keyword.name !== "UPDATE" || updateDecodeFeasible(state, playerId, card))
    }));
}

// デコード先(ゴミ箱の候補)が無いアップデートは起動可能として出さない
function updateDecodeFeasible(state, playerId, card) {
  const updateRuntime = cardRuntimeSpec(card.id, "update");
  if (!updateRuntime) return true;
  const runtime = { records: Object.create(null) };
  return updateRuntime.actions.filter((action) => action.type === "decode")
    .every((action) => runtimeActionFeasible(state, playerId, card, action, runtime));
}

export function getEffectActivationTargets(state, playerId, card, effectId) {
  const customGetEffectActivationTargets = CUSTOM_GET_EFFECT_ACTIVATION_TARGETS[card.id];
  if (customGetEffectActivationTargets) {
    const customResult = customGetEffectActivationTargets({ state, playerId, effectId, card });
    if (customResult !== PASS) return customResult;
  }
  if (!effectId?.startsWith(`${card.id}:update:`)) return [];
  const player = state.players[playerId];
  const customGetEffectActivationTargets2 = CUSTOM_GET_EFFECT_ACTIVATION_TARGETS_2[card.id];
  if (customGetEffectActivationTargets2) {
    const customResult = customGetEffectActivationTargets2({ player, card });
    if (customResult !== PASS) return customResult;
  }
  return [];
}

function resolveLogout(state, playerId, card) {
  if (executeCardRuntimeSpec(state, "logout", playerId, card)) return;
}

export function resolveLogoutAfterAreaExit(state, playerId, card) {
  const hasLogout = hasKeyword(card, "LOGOUT") || /(?:\[|［)ログアウト(?:\]|］)/.test(String(card.text ?? ""));
  if (!hasLogout) return false;
  state.triggerQueue.push({
    id: `AUTO-${++state.triggerSerial}`,
    source: { playerId, zoneName: "trash", card },
    event: { type: "logout", playerId, ownerId: card.owner ?? playerId, cardUid: card.uid, cardId: card.id, cardName: card.name, category: card.category },
    spec: { id: `${card.id}:logout`, actions: [] },
    runtimePhase: "logout"
  });
  if (state.effectDepth === 0) drainTriggerQueue(state);
  return true;
}

function activateCardEffectCore(state, playerId, cardUid, effectId, { targetUid = null, targetZone = null, targetUids = [] } = {}) {
  const location = findCard(state, cardUid);
  if (!location || location.playerId !== playerId || !["hand", "front", "back"].includes(location.zoneName)) return fail(state, "効果を起動するカードが使用可能な領域にない。", false);
  const card = location.card;
  const effect = getActivatableEffects(state, playerId, card).find((item) => item.id === effectId);
  if (!effect || !effect.enabled) return fail(state, "その効果は現在起動できない。", false);
  const player = state.players[playerId];

  if (effect.kind === "proxy") {
    if (location.zoneName !== "hand") return fail(state, "[プロキシ]は手札から起動する。", false);
    if (player.memory < effect.cost) return fail(state, "メモリ不足。", false);
    if (state.mode !== "lab" && card.color && !enabledSymbols(player).includes(card.color)) return fail(state, `${card.color}シンボルがない。`, false);
  }

  const updateRuntime = effect.kind === "update" ? cardRuntimeSpec(card.id, "update") : null;
  if (updateRuntime) {
    const runtime = { records: Object.assign(Object.create(null), {
      activation_target_uid: targetUid,
      activation_target_uids: targetUids,
      activation_target_zone: targetZone
    }) };
    if (!updateRuntime.actions.every((action) => runtimeActionFeasible(state, playerId, card, action, runtime))) {
      return fail(state, "効果を実行できる対象がない。", false);
    }
    player.memory -= effect.cost;
    return executeRuntimeActions(state, playerId, card, updateRuntime.actions, { runtime });
  }

  const customActivateCardEffectCore = CUSTOM_ACTIVATE_CARD_EFFECT_CORE[card.id];
  if (customActivateCardEffectCore) {
    const customResult = customActivateCardEffectCore({ player, effect, card, playerId, state, targetUid, location, effectId });
    if (customResult !== PASS) return customResult;
  }

  return fail(state, `${effect.label}は解析済みだが専用処理が未登録。`, false);
}

export function activateCardEffect(state, playerId, cardUid, effectId, options = {}) {
  { const blocked = newActionBlock(state); if (blocked) return fail(state, blocked, false); }
  normalizeBoardSlots(state);
  return resolveEffect(state, () => activateCardEffectCore(state, playerId, cardUid, effectId, options));
}

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

export function relogCard(state, playerId, uid, targetZone, { useLayerDiscount = null, layerUid = null, requestedSlot = null, baseUid = null } = {}) {
  { const blocked = newActionBlock(state); if (blocked) return fail(state, blocked, false); }
  normalizeBoardSlots(state);
  const player = state.players[playerId];
  if (state.active !== playerId) return fail(state, "再実行は自分ターン中だけ。", false);
  if (!["front", "back"].includes(targetZone)) return fail(state, "再実行先が不正。", false);
  const sourceZone = targetZone === "front" ? "back" : "front";
  const index = player[sourceZone].findIndex((card) => card.uid === uid);
  if (index < 0) return fail(state, "反対側エリアのカードを選んで。", false);
  const card = player[sourceZone][index];
  const preparationKind = relogPreparationKind(card);
  if (requestedSlot !== null && !requestedExecutionSlot(state, playerId, card, { zone: targetZone, requestedSlot }).ok) return false;
  if (baseUid !== null && (requestedSlot !== null || preparationKind === "registry" || !isObCard(card) || !relogBaseCode(player, targetZone, baseUid))) {
    return fail(state, "上に再実行するCodeを選んで。", false);
  }
  if (preparationKind === "registry") {
    const moveCost = Number(card.cost ?? 0);
    if (player.memory < moveCost) return fail(state, "再実行するメモリが足りない。", false);
    player.memory -= moveCost;
    player[sourceZone].splice(index, 1);
    const revealed = revealMountedCode(player[sourceZone], index, card, playerId, sourceZone);
    player.registry.push(card);
    distributeLayeredFollowers(state, card, "registry", card.name);
    card.sleep = false;
    card.summoningSick = false;
    emitRegistryInstalled(state, playerId, card, card.name);
    addLog(state, `${card.name}: [ログアウト]でレジストリへインストール。`, "effect");
    if (revealed) addLog(state, `${card.name}の下にあった${revealed.name}は場に残る。`, "effect");
    return true;
  }
  if (baseUid === null && player[targetZone].length >= player.user[`${targetZone}Limit`]) return fail(state, `${targetZone === "front" ? "フロント" : "バック"}上限。`, false);
  if (preparationKind === "payment-choice" && useLayerDiscount === null) {
    const regularCost = Number(card.cost ?? 0);
    const options = player.memory >= regularCost
      ? ["通常コストを払う", "レイヤー1枚を破棄して1メモリ"]
      : ["レイヤー1枚を破棄して1メモリ"];
    const request = createSelectionRequest({
      mode: "scope", scopeField: "moveCost", scopeOptions: options,
      label: "移動コストの支払い方を選択", message: card.text,
      continuation: { type: "relog-layer-discount", playerId, sourceUid: uid, targetZone, requestedSlot, baseUid }
    });
    state.pending = { type: "selection", validTargets: [], request };
    return true;
  }
  let moveCost = Number(card.cost ?? 0);
  let discountedLayer = null;
  if (preparationKind === "payment-choice" && useLayerDiscount === true) {
    normalizeMountedStack(card);
    moveCost = 1;
    discountedLayer = card.mounted.find((layer) => layer.uid === layerUid) ?? null;
    if (!discountedLayer) return fail(state, "移動コストに使うレイヤーを1枚選んで。", false);
  }
  if (player.memory < moveCost) {
    return fail(state, "再実行するメモリが足りない。", false);
  }

  player.memory -= moveCost;
  if (discountedLayer) {
    const consumed = consumeSelectedSourceLayers(state, playerId, card, [discountedLayer.uid], `${card.name}の移動コスト`);
    if (!consumed) return false;
    addLog(state, `${card.name}: 選んだレイヤーを破棄し、移動コストを1に変更。`, "effect");
  }
  player[sourceZone].splice(index, 1);
  const revealed = revealMountedCode(player[sourceZone], index, card, playerId, sourceZone);
  const baseCode = baseUid === null ? null : relogBaseCode(player, targetZone, baseUid);
  if (baseCode) {
    const baseIndex = player[targetZone].indexOf(baseCode);
    inheritBoardSlot(card, baseCode, { controllerId: playerId, zoneName: targetZone });
    player[targetZone].splice(baseIndex, 1, card);
    baseCode.layerRole = "mount";
    card.mounted = [...(card.mounted ?? []), baseCode, ...baseCode.mounted.splice(0)];
  } else if (placeByMode(state, playerId, card, { zone: targetZone, mode: "normal", from: sourceZone, source: "再実行", requestedSlot }) !== "placed") return false;
  card.sleep = false;
  card.attackedThisTurn = false;
  card.summoningSick = movedSummoningSick(state, card, targetZone);
  addLog(state, `${player.user.name}が「${card.name}」を${targetZone === "front" ? "フロント" : "バック"}へ再実行。メモリ${moveCost}支払い。`, "action");
  if (revealed) addLog(state, `${card.name}の下にあった${revealed.name}は${sourceZone === "front" ? "フロント" : "バック"}に残る。`, "effect");
  if (baseCode) {
    addLog(state, `${card.name}を${baseCode.name}の上へ再実行。レイヤー${card.mounted.length + 1}。`, "effect");
    resolveMountedSourceTrigger(state, playerId, card, baseCode);
  }
  if (hasKeyword(card, "LOGIN")) resolveEffect(state, () => resolveLogin(state, playerId, card));
  const hasLogout = hasKeyword(card, "LOGOUT") || /(?:\[|［)ログアウト(?:\]|］)/.test(String(card.text ?? ""));
  if (hasLogout) resolveEffect(state, () => resolveLogout(state, playerId, card));
  if (hasLogout && card.compiled?.selectionModules?.some((module) => module.module === "select_allocate_follow_up")) {
    resolveEffect(state, () => beginAllocationSelectionModule(state, playerId, card));
  }
  triggerMoved(state, playerId, card, sourceZone, targetZone);
  return true;
}
