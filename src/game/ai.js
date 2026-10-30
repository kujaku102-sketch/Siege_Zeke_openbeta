import {
  activateTurbo,
  activateScript,
  activateCardEffect,
  attack,
  canAttack,
  cardHasKeyword,
  canPlayCard,
  endTurn,
  getEffectTargets,
  getActivatableEffects,
  getAttackTargets,
  installCard,
  playCard,
  resolveCardSelection,
  resolveAccessDragPlacement,
  restSecurity,
  spellNeedsTarget
} from "./engine.js";
import { hasKeyword, keywordValue } from "../../packages/effect-compiler/index.js";
import { confirmSelection, setSelectionScope, toggleSelection } from "./selection-model.js";

export function resolveAutomatedAiChoices(state, playerId = "ai") {
  for (let guard = 0; guard < 16; guard += 1) {
    if (state.pending?.type === "access-drag-place") {
      if (state.pending.playerId !== playerId) break;
      const player = state.players[playerId];
      const zone = player.front.length < player.user.frontLimit ? "front" : "back";
      if (!resolveAccessDragPlacement(state, playerId, zone)) break;
      continue;
    }
    if (state.pending?.type !== "selection") break;
    const request = state.pending.request;
    const continuation = request.continuation;
    if ((continuation?.playerId ?? playerId) !== playerId) break;
    if (request.mode === "scope") setSelectionScope(request, request.scopeOptions[0]);
    else if (request.groups?.length) {
      for (const group of request.groups) for (const uid of group.candidates.slice(0, group.minimum)) toggleSelection(request, uid);
    } else if (request.mode === "up_to") {
      let budget = Number(request.budget ?? Infinity);
      for (const uid of request.candidates) {
        const value = Number(request.candidateValues?.[uid] ?? 0);
        if (value <= budget && request.selected.length < request.maximum) {
          toggleSelection(request, uid);
          budget -= value;
        }
      }
    } else {
      for (const uid of request.candidates.slice(0, request.minimum)) toggleSelection(request, uid);
    }
    const result = confirmSelection(request);
    if (!result || !resolveCardSelection(state, continuation, result)) break;
  }
}

function cardScore(card) {
  return card.cost * 100 + Number(card.atk ?? 0) * 20 + Number(card.str ?? 0) * 10;
}

// Keep the generator suspended at a real human/engine choice boundary. Never
// issue another action or end the turn while the preceding effect is waiting.
function* awaitChoices(state, playerId) {
  resolveAutomatedAiChoices(state, playerId);
  while (state.pending || state.prompt || state.triggerThread?.status === "resolving") {
    yield { type: "await-input", label: "選択・発動確認待ち" };
    resolveAutomatedAiChoices(state, playerId);
  }
}

function chooseSpellTarget(state, playerId, card) {
  const opponentId = playerId === "player" ? "ai" : "player";
  if (!spellNeedsTarget(card)) return null;
  const targetPlayerId = card.id === "STD-111" ? playerId : opponentId;
  return getEffectTargets(state, targetPlayerId, card)
    .sort((a, b) => (Number(b.atk ?? 0) + Number(b.str ?? 0)) - (Number(a.atk ?? 0) + Number(a.str ?? 0)))[0]?.uid ?? null;
}

export function* runSimpleAiTurnSteps(state, playerId = "ai") {
  const player = state.players[playerId];
  if (state.winner || state.active !== playerId) return;
  resolveAutomatedAiChoices(state, playerId);
  if (state.interactive) yield* awaitChoices(state, playerId);

  if (!player.registryActionUsed && !player.registry.length && player.hand.length) {
    const installCandidate = [...player.hand]
      .filter((card) => card.color)
      .sort((a, b) => cardScore(a) - cardScore(b))[0];
    if (installCandidate && installCard(state, playerId, installCandidate.uid)) {
      yield { type: "install", cardUid: installCandidate.uid, label: `${installCandidate.name}をインストール` };
      if (state.interactive) yield* awaitChoices(state, playerId);
    }
  }

  const highestHandCost = Math.max(0, ...player.hand.map((card) => card.cost));
  if (!player.turboUsed && highestHandCost > player.memory && activateTurbo(state, playerId)) {
    yield { type: "turbo", label: "ターボ・ブースト" };
  }

  for (let guard = 0; guard < 12; guard += 1) {
    const playable = player.hand
      .filter((card) => canPlayCard(state, playerId, card).ok)
      .filter((card) => !spellNeedsTarget(card) || getEffectTargets(state, card.id === "STD-111" ? playerId : (playerId === "player" ? "ai" : "player"), card).length)
      .sort((a, b) => cardScore(b) - cardScore(a));
    if (!playable.length) break;
    const chosen = playable[0];
    const targetUid = chooseSpellTarget(state, playerId, chosen);
    if (!playCard(state, playerId, chosen.uid, { targetUid })) break;
    yield { type: "play", cardUid: chosen.uid, label: `${chosen.name}を実行` };
    if (state.interactive) yield* awaitChoices(state, playerId);
    if (chosen.category === "Script" && !keywordValue(chosen, "IF") && activateScript(state, playerId, chosen.uid)) {
      yield { type: "activate", cardUid: chosen.uid, label: `${chosen.name}を起動` };
      if (state.interactive) yield* awaitChoices(state, playerId);
    }
    resolveAutomatedAiChoices(state, playerId);
    if (state.winner) return;
  }

  for (const card of [...player.hand, ...player.front, ...player.back]) {
    for (const effect of getActivatableEffects(state, playerId, card).filter((item) => item.enabled && item.kind === "proxy")) {
      if (activateCardEffect(state, playerId, card.uid, effect.id)) {
        yield { type: "effect", cardUid: card.uid, label: `${card.name}の${effect.label ?? "能力"}を起動` };
        if (state.interactive) yield* awaitChoices(state, playerId);
      }
    }
  }

  const attackers = [...player.front]
    .filter((card) => canAttack(state, playerId, card))
    .sort((a, b) => cardScore(b) - cardScore(a));
  for (const attacker of attackers) {
    const targets = getAttackTargets(state, playerId, attacker);
    const opponent = state.players[playerId === "player" ? "ai" : "player"];
    const killable = targets
      .filter((target) => target.type === "card")
      .map((target) => ({ ...target, card: opponent.front.find((card) => card.uid === target.uid) }))
      .filter((target) => target.card && Number(target.card.str ?? 0) - target.card.damage <= Number(attacker.atk ?? 0))
      .sort((a, b) => Number(b.card.atk ?? 0) - Number(a.card.atk ?? 0))[0];
    const target = killable ?? targets.find((item) => item.type === "fortress") ?? targets[0];
    if (target && attack(state, playerId, attacker.uid, target.uid)) {
      yield { type: "attack", cardUid: attacker.uid, targetUid: target.uid, label: `${attacker.name}で攻撃` };
      if (state.interactive) yield* awaitChoices(state, playerId);
    }
    if (state.winner) return;
  }

  const openedSecurityWindow = endTurn(state) === false && state.securityRestWindow === playerId;
  yield { type: "turn-end", label: openedSecurityWindow ? "セキュリティ待機を確認" : "ターン終了" };
  if (state.interactive) yield* awaitChoices(state, playerId);
  if (openedSecurityWindow) {
    for (const security of player.front.filter((card) => !card.sleep && cardHasKeyword(card, "SECURITY"))) {
      if (restSecurity(state, playerId, security.uid)) {
        yield { type: "security", cardUid: security.uid, label: `${security.name}をスリープ` };
      }
    }
    endTurn(state);
    yield { type: "turn-end", label: "ターン終了" };
    if (state.interactive) yield* awaitChoices(state, playerId);
  }
}

export function runSimpleAiTurn(state, playerId = "ai") {
  let stepCount = 0;
  for (const step of runSimpleAiTurnSteps(state, playerId)) { stepCount += 1; if (step.type === "await-input") break; }
  return stepCount;
}
