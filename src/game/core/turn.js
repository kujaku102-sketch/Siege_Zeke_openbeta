import { cardRuntimeSpec } from "../card-runtime-specs.js";
import { isObCard } from "../card-types.js";
import { createSelectionRequest } from "../selection-model.js";
import { canAttack, cardHasKeyword, getAttackTargets } from "./battle.js";
import { finalizeEffectResolution, recordVictoryFact, resolveMandatoryStateChecks, runEffectEntry } from "./effects.js";
import { queueMemoryLimitIncreasePrompt } from "./scripts.js";
import { addLog, fail, findCard, newActionBlock, otherPlayer } from "./shared.js";
import { emitGameEvent, emitUserAbilityFeedback } from "./triggers.js";
import { beginStd048MandatoryDraw } from "../../cards/std/std_048_effects.js";
import { resolveStd049TurnEnd } from "../../cards/std/std_049_effects.js";
import { continueStd141TurnEndQueue } from "../../cards/std/std_141_effects.js";
import { beginSztb094Access } from "../../cards/sztb/sztb_094_effects.js";
import { executeCardRuntimeSpec } from "../effects/generic/actions.js";
import { getMaxMemory } from "../effects/generic/cost.js";
import { destroyCard, distributeLayeredFollowers, emitEffectPlacement, placeByMode, revealMountedCode, setCardSleeping, syncFieldEntryTurns } from "../effects/generic/placement.js";

export function drawCardRaw(player) {
  const card = player.deck.pop();
  if (card) player.hand.push(card);
  return card;
}

export function drawCards(state, playerId, count = 1) {
  const player = state.players[playerId];
  let drawn = 0;
  for (let i = 0; i < count; i += 1) {
    const card = drawCardRaw(player);
    if (!card) continue;
    drawn += 1;
    emitGameEvent(state, {
      type: "card_drawn", playerId, ownerId: card.owner ?? playerId,
      cardUid: card.uid, cardId: card.id, cardName: card.name,
      category: card.category, color: card.color, amount: 1,
      drawIndex: drawn, requestedCount: count, source: "draw"
    });
  }
  if (drawn) addLog(state, `${player.user.name}が${drawn}枚ドロー。`);
  return drawn;
}

function continueMandatoryTurnDraw(state, playerId, count) {
  const drawn = drawCards(state, playerId, count);
  if (drawn < count) {
    state.players[playerId].mandatoryDrawFailed = true;
    recordVictoryFact(state, { type: "mandatory-draw-failed", playerId });
    addLog(state, `${state.players[playerId].user.name}はターン開始時の必要ドローを完了できず敗北。`, "win");
    if (!state.effectResolution) finalizeEffectResolution(state);
  }
}

function hasMandatoryDrawChildWork(state) {
  return Boolean(
    // Only the placement/replacement continuation belongs to Dawn's mandatory
    // draw. Newly queued triggers (STD186/179 etc.) are separate effects.
    state.pending || state.prompt || state.deferredTrashMoves?.length || state.deferredDestruction
  );
}

export function resumeMandatoryDrawContinuation(state) {
  const continuation = state.mandatoryDrawContinuation;
  if (!continuation || continuation.type !== "std048-mandatory-draw" || hasMandatoryDrawChildWork(state)) return false;
  if (continuation.placementOutcome === "pending") return false;
  if (!continuation.ruleDrawDone) {
    continuation.ruleDrawDone = true;
    continueMandatoryTurnDraw(state, continuation.playerId, continuation.remainingRuleDraws);
    if (state.players[continuation.playerId].mandatoryDrawFailed) {
      state.mandatoryDrawContinuation = null;
      finalizeEffectResolution(state);
      return true;
    }
    if (hasMandatoryDrawChildWork(state)) return true;
  }
  if (continuation.placementOutcome === "placed" && !continuation.successEffectDone) {
    continuation.successEffectDone = true;
    const player = state.players[continuation.playerId];
    player.fortressStr = Math.min(player.user.maxStr, player.fortressStr + 3);
    drawCards(state, continuation.playerId, 1);
    addLog(state, `${continuation.sourceName}: ドラッグ成功。自分ユーザーを3回復し、1枚ドロー。`, "effect");
    if (hasMandatoryDrawChildWork(state)) return true;
  }
  state.mandatoryDrawContinuation = null;
  if (state.effectResolution?.kind === "STD-048-mandatory-draw") {
    resolveMandatoryStateChecks(state);
    finalizeEffectResolution(state);
  }
  if (!state.winner) runPostDrawTurnStart(state, continuation.playerId);
  return true;
}

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

function runPostDrawTurnStart(state, playerId) {
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

function resolveDelayedTrashMove(state, effect) {
  const owner = state.players[effect.ownerId];
  if (!owner) return false;
  const index = owner.trash.findIndex((card) => card.uid === effect.cardUid);
  if (index < 0) return false;
  const [card] = owner.trash.splice(index, 1);
  if (effect.destination === "hand") {
    owner.hand.push(card);
    addLog(state, `${effect.sourceName}: 次の自分ターン開始時にゴミ箱から手札へ。`, "effect");
    return true;
  }
  const zone = effect.destination === "choose_area"
    ? owner.front.length < owner.user.frontLimit ? "front" : owner.back.length < owner.user.backLimit ? "back" : "front"
    : effect.destination ?? "front";
  if (placeByMode(state, effect.ownerId, card, { zone, from: "trash", source: effect.sourceName }) !== "placed") return true;
  if (effect.resetDamage) card.damage = 0;
  if (effect.standby) card.sleep = false;
  if (effect.sleep) setCardSleeping(state, effect.ownerId, card);
  card.summoningSick = zone === "front";
  emitEffectPlacement(state, effect.ownerId, card, zone, effect.sourceName);
  return true;
}

function resolveTurnStartDelayedEffects(state, playerId) {
  const player = state.players[playerId];
  const due = state.delayedEffects.filter((effect) => effect.event === "turn_started"
    && effect.ownerId === playerId
    && effect.dueOwnerTurnsTaken <= player.turnsTaken + 1);
  state.delayedEffects = state.delayedEffects.filter((effect) => !due.includes(effect));
  for (const effect of due) {
    if (effect.type === "move_source_from_trash") resolveDelayedTrashMove(state, effect);
  }
}

function resolveTurnEndDelayedEffects(state, activeId) {
  const due = state.delayedEffects.filter((effect) => effect.event === "turn_ended"
    && (effect.dueTurn !== undefined ? effect.dueTurn <= state.turnNumber : effect.turnPlayerId === activeId));
  state.delayedEffects = state.delayedEffects.filter((effect) => !due.includes(effect));
  for (const effect of due) {
    if (effect.type === "destroy_card") {
      destroyCard(state, effect.ownerId, effect.cardUid, { source: `${effect.sourceName}の遅延破壊` });
      continue;
    }
    if (effect.type === "move_source_from_trash") {
      resolveDelayedTrashMove(state, effect);
      continue;
    }
    if (effect.type !== "generate_dolls_for_destroyed_ob") continue;
    const maximum = state.turnStats.destroyedOb;
    if (maximum <= 0) continue;
    const request = createSelectionRequest({ mode: "scope", scopeField: "count",
      scopeOptions: Array.from({ length: maximum + 1 }, (_, index) => String(index)),
      label: `生成するドールズの数（0～${maximum}）`, message: effect.sourceName,
      continuation: { type: "std212-respawn-count", playerId: effect.controllerId, sourceName: effect.sourceName, activeId, maximum } });
    state.pending = { type: "selection", validTargets: [], request };
    return true;
  }
  return false;
}

export function completeTurnAfterDelayedEffects(state, activeId) {
  const player = state.players[activeId];
  for (const current of Object.values(state.players)) {
    for (const card of [...current.front, ...current.back, ...current.hand]) {
      for (const [keyword, expiry] of Object.entries(card.keywordExpiries ?? {})) {
        if (expiry <= state.turnNumber) {
          card.grantedKeywords = (card.grantedKeywords ?? []).filter((value) => value !== keyword);
          delete card.keywordExpiries[keyword];
        }
      }
      if (card.assaultProgramTurn === state.turnNumber) delete card.assaultProgramTurn;
    }
  }
  player.forceAttack = false;
  syncFieldEntryTurns(state);
  state.turnNumber += 1;
  if (state.extraTurnPlayerId === activeId) {
    state.extraTurnPlayerId = null;
    state.damagePenaltyPlayerId = activeId;
    state.damagePenaltyTurn = state.turnNumber;
    startTurn(state, activeId);
  } else if (["lab", "sandbox"].includes(state.mode) && !state.sandboxUi?.alternateTurns) startTurn(state, "player");
  else startTurn(state, otherPlayer(activeId));
  return true;
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
