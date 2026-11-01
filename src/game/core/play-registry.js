import { runEffectEntry } from "./effects.js";
import { canExecuteAtSlot, canPlayCard, playCard } from "./play.js";
import { addLog, fail, findCard, newActionBlock } from "./shared.js";
import { emitGameEvent } from "./triggers.js";
import { CUSTOM_INSTALL_CARD } from "../effects/custom/index.js";
import { ownLayerEntries } from "../effects/generic/cost.js";
import { emitRegistryInstalled } from "../effects/generic/placement.js";

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

export function recoverRegistryCardCore(state, playerId, uid) {
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
