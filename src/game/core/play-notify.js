import { isObCard } from "../card-types.js";
import { createSelectionRequest } from "../selection-model.js";
import { enqueueSelection, selectionProjectionMeta } from "./projection.js";
import { openScriptActivationWindow } from "./scripts.js";
import { addLog, cardTraits, findCard, otherPlayer } from "./shared.js";
import { emitGameEvent, emitUserAbilityFeedback } from "./triggers.js";
import { CUSTOM_NOTIFY_CARD_EXECUTED, PASS } from "../effects/custom/index.js";
import { magazineExecutionCandidates } from "../effects/generic/cost.js";
import { destroyCard } from "../effects/generic/destroy.js";
import { moveCardToTrash } from "../effects/generic/trash.js";

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
