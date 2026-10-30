import { keywordValue } from "../../../packages/effect-compiler/index.js";
import { mountedKeywordSpecsFor } from "../continuous-effect-specs.js";
import { drawCards } from "./draw.js";
import { recordVictoryFact } from "./effects.js";
import { openResponseWindow, startNextQueuedResponse } from "./response.js";
import { addLog, otherPlayer, sourceCardByName } from "./shared.js";
import { cardCurrentStr } from "./stats.js";
import { emitGameEvent, emitUserAbilityFeedback } from "./triggers.js";
import { applyDamageModifiers } from "../effects/generic/damage.js";
import { destroyCard } from "../effects/generic/placement.js";

export function consumeProtect(state, card, source) {
  if (card.protect === undefined) card.protect = Number(keywordValue(card, "PROTECT") ?? 0);
  if (Number(card.protect ?? 0) > 0) {
    card.protect -= 1;
    addLog(state, `${card.name}の[プロテクト]が${source}を無効。残り${card.protect}。`, "effect");
    return true;
  }
  const mountedProtection = card.mounted?.map((provider) => ({
    provider,
    spec: mountedKeywordSpecsFor(provider.id).find((spec) => spec.keyword === "PROTECT" && (!spec.consumedFlag || !provider[spec.consumedFlag]))
  })).find((entry) => entry.spec);
  if (!mountedProtection) return false;
  if (mountedProtection.spec.consumedFlag) mountedProtection.provider[mountedProtection.spec.consumedFlag] = true;
  addLog(state, `${mountedProtection.provider.name}が与えた[プロテクト]が${source}を無効。`, "effect");
  return true;
}

export function dealCardDamage(state, ownerId, uid, amount, source = "効果", { sourcePlayerId = otherPlayer(ownerId), kind = "effect" } = {}) {
  const player = state.players[ownerId];
  const card = [...player.front, ...player.back].find((item) => item.uid === uid);
  if (!card) return false;
  const sourceCard = sourceCardByName(state, sourcePlayerId, source);
  amount = applyDamageModifiers(state, sourcePlayerId, sourceCard, ownerId, amount, { kind, destination: "card", victimCard: card });
  if (amount > 0 && consumeProtect(state, card, `${source}によるダメージ`)) {
    state.lastDamageOutcome = { targetUid: uid, amount: 0, destructionDetermined: false, prevented: true };
    return true;
  }
  const strBefore = cardCurrentStr(state, ownerId, card);
  card.damage += amount;
  addLog(state, `${source}: ${card.name}に${amount}ダメージ。残りSTR ${cardCurrentStr(state, ownerId, card)}。`, "effect");
  emitGameEvent(state, {
    type: "card_damaged",
    playerId: ownerId,
    ownerId,
    cardUid: card.uid,
    cardId: card.id,
    cardName: card.name,
    category: card.category,
    amount,
    sourcePlayerId, sourceUid: sourceCard?.uid ?? null,
    strBefore, strAfter: cardCurrentStr(state, ownerId, card),
    source
  });
  const destructionDetermined = cardCurrentStr(state, ownerId, card) <= 0;
  state.lastDamageOutcome = { targetUid: uid, amount, destructionDetermined, prevented: false };
  if (destructionDetermined) destroyCard(state, ownerId, uid, { source });
  return true;
}

export function dealFortressDamage(state, victimId, amount, sourcePlayerId, source = "攻撃", { kind = "effect" } = {}) {
  const victim = state.players[victimId];
  const sourcePlayer = state.players[sourcePlayerId];
  amount = applyDamageModifiers(state, sourcePlayerId, sourceCardByName(state, sourcePlayerId, source), victimId, amount, { kind, destination: "user" });
  if (state.damagePenaltyPlayerId === sourcePlayerId && state.damagePenaltyTurn === state.turnNumber && victimId !== sourcePlayerId) {
    amount = Math.max(0, amount - Number(state.extraTurnDamagePenalty ?? 2));
  }
  if (victim.user.abilityKey === "kickass") amount *= 2;
  if (victim.user.abilityKey === "kickass" && amount > 0) emitUserAbilityFeedback(state, "kickass", victimId, victimId, {
    branch: "damage-doubled", before: amount / 2, after: amount, steps: [{ kind: "multiply", target: { kind: "player_stat", playerId: victimId, metric: "damage" }, before: amount / 2, factor: 2, after: amount }]
  });
  if (victim.user.abilityKey === "dimension_innovation") {
    const banCount = Math.min(amount, victim.deck.length);
    for (let index = 0; index < banCount; index += 1) victim.ban.push(victim.deck.pop());
    addLog(state, `${victim.user.abilityName}: ${amount}ダメージを置換し、山札${banCount}枚をBAN。`, "effect");
    if (amount > 0 && banCount > 0) emitUserAbilityFeedback(state, "dimension_innovation", victimId, victimId, {
      branch: "damage-replaced", before: amount, after: banCount, strBefore: victim.fortressStr, strAfter: victim.fortressStr, outcome: "ban", steps: [{ kind: "transfer", from: { kind: "zone_count", playerId: victimId, zone: "deck" }, to: { kind: "zone_count", playerId: victimId, zone: "ban" }, count: banCount }]
    });
    if (kind === "attack") addLog(state, `${source}が${victim.user.name}を攻撃。ダメージは置換され、STRは変動なし。`, "damage", {
      actor: sourcePlayerId, cardId: sourceCardByName(state, sourcePlayerId, source)?.id ?? null,
      combat: { targetName: victim.user.name, damage: 0, targetStrBefore: victim.fortressStr, targetStrAfter: victim.fortressStr }
    });
    return banCount;
  }
  const before = victim.fortressStr;
  victim.fortressStr = Math.max(0, victim.fortressStr - amount);
  if (victim.user.abilityKey === "recovery_boot" && victim.fortressStr <= 0) {
    victim.fortressStr = 1;
    addLog(state, `${victim.user.abilityName}: STRを1へ回復。`, "effect");
    emitUserAbilityFeedback(state, "recovery_boot", victimId, victimId, { branch: "recovered", before: 0, after: 1, steps: [{ kind: "value_change", target: { kind: "player_stat", playerId: victimId, metric: "str" }, before: 0, after: 1 }] });
  }
  victim.damageReceivedThisTurn = Number(victim.damageReceivedThisTurn ?? 0) + amount;
  const sourceCard = kind === "attack" ? sourceCardByName(state, sourcePlayerId, source) : null;
  if (kind === "attack") addLog(state, `${source}が${victim.user.name}を攻撃。${amount}ダメージ、STR ${before}→${victim.fortressStr}。`, "damage", {
    actor: sourcePlayerId, cardId: sourceCard?.id ?? null,
    combat: { targetName: victim.user.name, damage: amount, targetStrBefore: before, targetStrAfter: victim.fortressStr }
  });
  else addLog(state, `${source}: ${victim.user.name}へ${amount}ダメージ。STR ${before}→${victim.fortressStr}。`, "damage");
  if (amount > 0) emitGameEvent(state, { type: "user_damaged", playerId: victimId, ownerId: victimId,
    amount, kind, sourcePlayerId, source,
    sourceUid: sourceCardByName(state, sourcePlayerId, source)?.uid ?? null,
    strBefore: before, strAfter: victim.fortressStr });
  const triggered = victim.user.incidents.filter((threshold) =>
    before > threshold && victim.fortressStr <= threshold && !victim.incidentsTriggered.includes(threshold)
  );
  for (const threshold of triggered) {
    victim.incidentsTriggered.push(threshold);
    victim.permanentMemory += 1;
    victim.memory += 1;
    drawCards(state, sourcePlayerId, 1);
    addLog(state, `INCIDENT ${threshold}: ${victim.user.name}のメモリ上限+1・アクティブメモリ1回復、${sourcePlayer.user.name}が1ドロー。`, "incident");
  }
  if (victim.fortressStr <= 0) recordVictoryFact(state, { type: "str-zero", playerId: victimId, sourcePlayerId });
  if ((state.interactive || state.runtimeContext) && amount > 0 && sourcePlayerId !== victimId) {
    const queued = { playerId: victimId, event: { sourcePlayerId, source, amount, kind } };
    if (state.resolvingResponse) (state.responseEventQueue ??= []).push(queued);
    else openResponseWindow(state, queued.playerId, queued.event) || startNextQueuedResponse(state);
  }
}
