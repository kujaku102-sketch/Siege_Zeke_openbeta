import { cardRuntimeSpec } from "../card-runtime-specs.js";
import { isObCard } from "../card-types.js";
import { createSelectionRequest } from "../selection-model.js";
import { beginStd048MandatoryDraw } from "../../cards/std/std_048_effects.js";
import { resolveStd049TurnEnd } from "../../cards/std/std_049_effects.js";
import { continueStd141TurnEndQueue } from "../../cards/std/std_141_effects.js";
import { beginSztb094Access } from "../../cards/sztb/sztb_094_effects.js";
import { canAttack, cardHasKeyword, getAttackTargets } from "./battle.js";
import { continueMandatoryTurnDraw, drawCardRaw, drawCards } from "./draw.js";
import { recordVictoryFact, runEffectEntry } from "./effects.js";
import { addLog, fail, findCard, otherPlayer } from "./shared.js";
import { emitGameEvent, emitUserAbilityFeedback } from "./triggers.js";
import { completeTurnAfterDelayedEffects, resolveTurnEndDelayedEffects, resolveTurnStartDelayedEffects } from "./turn-delayed.js";
import { executeCardRuntimeSpec } from "../effects/generic/actions.js";
import { getMaxMemory } from "../effects/generic/cost.js";
import { distributeLayeredFollowers, revealMountedCode } from "../effects/generic/placement.js";

function rollMadness(state, count) {
  let total = 0;
  for (let index = 0; index < count; index += 1) total += Math.floor(state.rng() * 6) + 1;
  return total;
}

export function resolveMadnessChecks(state, playerId) {
  const player = state.players[playerId];
  for (const card of [...player.front, ...player.back]) {
    const count = Number(card.counters?.madness ?? 0);
    if (!count) continue;
    const roll = rollMadness(state, count);
    if (roll > Number(card.str ?? 0) + 15) {
      const location = findCard(state, card.uid);
      if (location && ["front", "back"].includes(location.zoneName)) {
        const index = player[location.zoneName].indexOf(card);
        player[location.zoneName].splice(index, 1);
        revealMountedCode(player[location.zoneName], index, card, playerId, location.zoneName);
        player.ban.push(card);
        distributeLayeredFollowers(state, card, "ban", card.name);
        addLog(state, `${card.name}: 狂気判定${roll}が${Number(card.str ?? 0) + 15}を超えBAN。`, "effect");
      }
    }
  }
  const userCount = Number(player.counters?.madness ?? 0);
  if (userCount) {
    const roll = rollMadness(state, userCount);
    if (roll > Number(player.user.maxStr ?? 0) + 15) {
      player.userBanned = true;
      recordVictoryFact(state, { type: "user-banned", playerId });
      addLog(state, `${player.user.name}: 狂気判定${roll}によりBAN。`, "effect");
    }
  }
}

export function runPostDrawTurnStart(state, playerId) {
  const player = state.players[playerId];
  for (const provider of player.registry.filter((card) => !card.faceDown && cardRuntimeSpec(card.id, "turn_start"))) {
    runEffectEntry(state, "turn-start", playerId, () => executeCardRuntimeSpec(state, "turn_start", playerId, provider));
    if (state.winner) return;
  }
  for (const sister of [...player.front, ...player.back].filter((card) => card.id === "STD-113")) {
    runEffectEntry(state, "turn-start", playerId, () => executeCardRuntimeSpec(state, "turn_start", playerId, sister));
    if (state.winner) return;
  }
  const opponentId = otherPlayer(playerId);
  for (const source of state.players[opponentId].back.filter((card) => card.id === "STD-148" && card.residentActive)) source.std148ArmedTurn = state.turnNumber;
  emitGameEvent(state, { type: "turn_started", playerId });
}

export function startTurn(state, playerId) {
  const player = state.players[playerId];
  for (const current of Object.values(state.players)) current.damageReceivedThisTurn = 0;
  for (const current of Object.values(state.players)) current.triggerUsage = {};
  for (const current of Object.values(state.players)) {
    for (const card of [...current.front, ...current.back]) {
      card.timedModifiers = (card.timedModifiers ?? []).filter((item) => state.turnNumber <= item.expiresAfterTurn);
      card.damageModifiers = (card.damageModifiers ?? []).filter((item) => item.duration !== "turn" || state.turnNumber <= item.activeTurn);
      card.tempAtk = 0;
      card.tempStr = 0;
    }
  }
  state.turnStats = { destroyedOb: 0, destroyedCards: 0, destroyedSacredTreeScripts: 0 };
  if (player.turboActive) {
    player.turboActive = false;
    addLog(state, `${player.user.name}のターボ・ブーストが終了。`, "system");
  }
  for (const card of [...player.front, ...player.back]) {
    if (card.skipStandby) card.skipStandby = false;
    else card.sleep = false;
    card.attackedThisTurn = false;
    card.attackedObThisTurn = false;
    card.summoningSick = false;
  }
  for (const card of [...player.hand, ...player.deck, ...player.registry, ...player.trash]) {
    card.turnCostModifier = 0;
    card.revealed = false;
  }
  player.installedThisTurn = false;
  player.registryActionUsed = false;
  for (const current of Object.values(state.players)) current.scriptUsage = {};
  player.memory = getMaxMemory(player);

  resolveTurnStartDelayedEffects(state, playerId);

  let drawCount = 1;
  if (player.turnsTaken === 0 && playerId === state.firstPlayer) drawCount = 0;
  else if (player.turnsTaken === 0) drawCount = 2;
  player.turnsTaken += 1;
  state.active = playerId;
  state.phase = "main";
  resolveMadnessChecks(state, playerId);
  addLog(state, `TURN ${state.turnNumber}: ${player.user.name}の開始。メモリ${player.memory}。`, "turn");
  if (drawCount) {
    const first = drawCardRaw(player);
    if (first) addLog(state, `${player.user.name}が1枚ドロー。`);
    if (!first) continueMandatoryTurnDraw(state, playerId, 1);
    else if (first.id === "STD-048") {
      continueMandatoryTurnDraw(state, playerId, drawCount - 1);
      if (!player.mandatoryDrawFailed) beginStd048MandatoryDraw(state, playerId, first, 0);
    }
    else continueMandatoryTurnDraw(state, playerId, drawCount - 1);
  }
  if (state.mandatoryDrawContinuation) return;
  runPostDrawTurnStart(state, playerId);
}

export function endTurn(state) {
  if (state.winner || state.opening) return false;
  const activeId = state.active;
  const player = state.players[activeId];
  const resumingStd094TurnEnd = state.std094TurnEndQueue?.activeId === activeId || state.std094TurnEndDone === activeId;
  const resumingStd141TurnEnd = state.std141TurnEndQueue?.activeId === activeId || state.std141TurnEndDone === activeId;
  const resumingTurnEnd = state.std142TurnEndQueue?.activeId === activeId || state.std142TurnEndDone === activeId
    || resumingStd094TurnEnd || resumingStd141TurnEnd;
  if (!resumingTurnEnd) {
  // A Savage salvage choice resumes after Security and the first user effects.
  // Do not reopen Security or apply those effects a second time on resume.
  if (!state.skipSavageTurnEnd) {
  if (player.forceAttack && player.front.some((card) => !card.attackedThisTurn && canAttack(state, activeId, card))) {
    return fail(state, "攻撃可能なObすべてで攻撃してからターンを終了して。", false);
  }
  if (player.front.some((card) => card.mustAttackObTurn === state.turnNumber && !card.attackedObThisTurn
    && canAttack(state, activeId, card)
    && getAttackTargets(state, activeId, card).some((target) => target.type === "card"))) {
    return fail(state, "可能ならObを攻撃するカードが攻撃を終えていない。", false);
  }
  const readySecurities = player.front.filter((card) => isObCard(card) && !card.faceDown && !card.sleep && cardHasKeyword(card, "SECURITY"));
  if (readySecurities.length && state.securityRestWindow !== activeId) {
    state.securityRestWindow = activeId;
    addLog(state, "ターン終了時：[セキュリティ]をスリープするなら選択。もう一度ターン終了で確定。", "effect");
    return false;
  }
  delete state.securityRestWindow;
  if (player.user.abilityKey === "do_or_isnt"
    && [...player.front, ...player.back].filter(isObCard).length === 3) {
    const beforeStr = player.fortressStr;
    const beforeMemory = player.memory;
    player.fortressStr = Math.min(player.user.maxStr, player.fortressStr + 1);
    player.memory = Math.min(getMaxMemory(player), player.memory + 1);
    addLog(state, `DO OR is'NT: ${player.user.name}のSTRとメモリを1回復。`, "effect");
    if (beforeStr !== player.fortressStr || beforeMemory !== player.memory) emitUserAbilityFeedback(state, "do_or_isnt", activeId, activeId, {
      branch: "exact-three-recovery", strBefore: beforeStr, strAfter: player.fortressStr,
      memoryBefore: beforeMemory, memoryAfter: player.memory, steps: [{ kind: "value_change", target: { kind: "player_stat", playerId: activeId, metric: "str" }, before: beforeStr, after: player.fortressStr }, { kind: "value_change", target: { kind: "player_stat", playerId: activeId, metric: "memory" }, before: beforeMemory, after: player.memory }]
    });
  }
  const savageOwnerId = Object.entries(state.players).find(([, entry]) => entry.user.abilityKey === "trash_never_empty")?.[0] ?? null;
  if (!state.skipSavageTurnEnd && savageOwnerId) {
    const moved = [];
    for (let index = 0; index < 2; index += 1) {
      const card = player.deck.pop();
      if (!card) break;
      player.trash.push(card); moved.push(card);
    }
    if (moved.length === 2 && moved[0].color && moved[0].color === moved[1].color) {
      emitUserAbilityFeedback(state, "trash_never_empty", savageOwnerId, activeId, { branch: "milled-same-symbol", amount: moved.length, steps: [{ kind: "transfer", from: { kind: "zone_count", playerId: activeId, zone: "deck" }, to: { kind: "zone_count", playerId: activeId, zone: "trash" }, count: moved.length }] });
      const request = createSelectionRequest({ mode: "up_to", candidates: moved.map((card) => card.uid), count: 1, minimum: 0, maximum: 1,
        candidateLabels: Object.fromEntries(moved.map((card) => [card.uid, card.name])), label: "同シンボルから1枚までサルベージ", message: "選ばず確定も可能。",
        continuation: { type: "user-savage-salvage", playerId: activeId, ownerPlayerId: savageOwnerId } });
      state.pending = { type: "selection", validTargets: request.candidates, request };
      return false;
    } else if (moved.length === 2) {
      const drawn = drawCards(state, activeId, 1);
      addLog(state, "*ゴミ箱は空にならない*: 異なるシンボルのため1枚ドロー。", "effect");
      if (drawn) emitUserAbilityFeedback(state, "trash_never_empty", savageOwnerId, activeId, { branch: "milled-different-symbol", amount: drawn, outcome: "draw", steps: [{ kind: "transfer", from: { kind: "zone_count", playerId: activeId, zone: "deck" }, to: { kind: "zone_count", playerId: activeId, zone: "hand" }, count: drawn }] });
    }
  }
  }
  delete state.skipSavageTurnEnd;
  for (const provider of player.registry.filter((card) => !card.faceDown && cardRuntimeSpec(card.id, "turn_end"))) {
    executeCardRuntimeSpec(state, "turn_end", activeId, provider);
  }
  for (const card of [...player.front, ...player.back].filter((item) => !item.faceDown && cardRuntimeSpec(item.id, "turn_end"))) {
    executeCardRuntimeSpec(state, "turn_end", activeId, card);
  }
  }
  if (!state.std142TurnEndQueue && state.std142TurnEndDone !== activeId) {
    const ownerOrder = [activeId, otherPlayer(activeId)];
    state.std142TurnEndQueue = {
      activeId,
      entries: ownerOrder.flatMap((ownerId) => ["front", "back"].flatMap((zoneName) =>
        state.players[ownerId][zoneName]
          .filter((card) => card.id === "STD-142" && card.faceDown !== true)
          .map((card) => ({ playerId: ownerId, sourceUid: card.uid }))))
    };
  }
  while (state.std142TurnEndQueue?.entries.length) {
    const next = state.std142TurnEndQueue.entries.shift();
    const source = findCard(state, next.sourceUid);
    if (!source || source.playerId !== next.playerId || source.card.id !== "STD-142" || source.card.faceDown === true) continue;
    const request = createSelectionRequest({
      mode: "up_to",
      candidates: [source.card.uid],
      count: 1,
      minimum: 0,
      maximum: 1,
      candidateLabels: { [source.card.uid]: "このカードを破壊して②を起動" },
      label: "聖樹枝塊の終了時効果",
      message: "選ばず確定すると起動しない。",
      continuation: {
        type: "std142-turn-end-choice",
        playerId: next.playerId,
        activeId,
        sourceUid: source.card.uid,
        sourceName: source.card.name
      }
    });
    state.pending = { type: "selection", validTargets: request.candidates, request };
    return false;
  }
  if (state.std142TurnEndQueue) {
    delete state.std142TurnEndQueue;
    state.std142TurnEndDone = activeId;
  }
  if (!resumingStd141TurnEnd) {
    if (!state.std094TurnEndQueue && state.std094TurnEndDone !== activeId) {
      const ownerOrder = [activeId, otherPlayer(activeId)];
      state.std094TurnEndQueue = {
        activeId,
        nextOwnerId: activeId,
        entries: Object.fromEntries(ownerOrder.map((ownerId) => [ownerId,
          [...state.players[ownerId].front, ...state.players[ownerId].back]
            .filter((card) => card.id === "SZTB-094" && !card.faceDown)
            .map((card) => card.uid)
        ]))
      };
    }
    while (state.std094TurnEndQueue) {
      const queue = state.std094TurnEndQueue;
      const ownerId = queue.nextOwnerId;
      const sourceUid = queue.entries[ownerId].shift();
      queue.nextOwnerId = otherPlayer(ownerId);
      if (!sourceUid) {
        if (queue.entries[queue.nextOwnerId].length) continue;
        break;
      }
      const source = findCard(state, sourceUid);
      if (!source || source.playerId !== ownerId || !["front", "back"].includes(source.zoneName) || source.card.id !== "SZTB-094" || source.card.faceDown) continue;
      if (beginSztb094Access(state, ownerId, source.card.name, { resumeTurnEndActiveId: activeId })) return false;
    }
    if (state.std094TurnEndQueue) {
      delete state.std094TurnEndQueue;
      state.std094TurnEndDone = activeId;
    }
    emitGameEvent(state, { type: "turn_ended", playerId: activeId });
    resolveStd049TurnEnd(state, activeId);
  }
  if (!state.std141TurnEndQueue && state.std141TurnEndDone !== activeId) {
    const ownerOrder = [activeId, otherPlayer(activeId)];
    const count = Number(state.turnStats.destroyedSacredTreeScripts ?? 0);
    state.std141TurnEndQueue = {
      activeId,
      nextOwnerId: activeId,
      entries: Object.fromEntries(ownerOrder.map((ownerId) => [ownerId,
        (count >= 2 ? state.players[ownerId].back : [])
          .filter((card) => card.id === "STD-141" && card.residentActive)
          .map((card) => card.uid)
      ]))
    };
  }
  if (continueStd141TurnEndQueue(state, activeId)) {
    return false;
  }
  if (state.std141TurnEndQueue) {
    delete state.std141TurnEndQueue;
    state.std141TurnEndDone = activeId;
  }
  if (resolveTurnEndDelayedEffects(state, activeId)) return false;
  const completed = completeTurnAfterDelayedEffects(state, activeId);
  if (completed) {
    delete state.std142TurnEndDone;
    delete state.std094TurnEndDone;
    delete state.std141TurnEndDone;
  }
  return completed;
}
