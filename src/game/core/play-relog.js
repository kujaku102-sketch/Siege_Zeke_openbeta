import { compileEffectText, hasKeyword } from "../../../packages/effect-compiler/index.js";
import { inheritBoardSlot, normalizeBoardSlots } from "../board-slots.js";
import { isObCard } from "../card-types.js";
import { placementPermissionSpecsFor } from "../continuous-effect-specs.js";
import { flattenedLayerCount, normalizeMountedStack } from "../layered-specs.js";
import { createSelectionRequest } from "../selection-model.js";
import { resolveEffect } from "./effects.js";
import { resolveLogin, resolveLogout } from "./play-spell.js";
import { requestedExecutionSlot } from "./play.js";
import { addLog, fail, newActionBlock } from "./shared.js";
import { consumeSelectedSourceLayers } from "../effects/generic/cost.js";
import { movedSummoningSick } from "../effects/generic/field-entry.js";
import { emitRegistryInstalled, placeByMode, placementResult, resolveMountedSourceTrigger } from "../effects/generic/placement.js";
import { beginAllocationSelectionModule } from "../effects/generic/selection-modules.js";
import { distributeLayeredFollowers, revealMountedCode, triggerMoved } from "../effects/generic/trash.js";

export function relogPreparationKind(card, layerCount = flattenedLayerCount(card)) {
  const compiled = compileEffectText(card?.text ?? "", { category: card?.category, id: card?.id });
  const operationTypes = new Set((compiled.operations ?? []).map((operation) => operation.type));
  if (operationTypes.has("registry_executable_and_logout_install_self")
    || operationTypes.has("logout_registry_replacement_and_registry_execute")) return "registry";
  if (layerCount > 0 && operationTypes.has("replace_move_cost")) return "payment-choice";
  return "normal";
}

// A Code that an Ob can be re-executed onto: face-up, in the target area, not forbidding mounts.
export function relogBaseCode(player, zone, baseUid) {
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
