import { canAttack, getAttackTargets } from '../../engine.js';
import { currentReferencedCard } from './card-target.js';
import { MISSING, finiteNumberField, nonempty, ordinary, own, prepared, reject, safeRevision, selectedArray, selectedField, selectedObject } from './common.js';
import { securityEligibilityView } from './security-view.js';

function attackCardView(card) {
  const code = 'INVALID_AUTHORITY';
  const keywordView = securityEligibilityView(card);
  const ancestors = new Set();
  selectedObject(card, code, ancestors);
  try {
    const uid = selectedField(card, 'uid', code);
    const name = selectedField(card, 'name', code);
    const colorRaw = selectedField(card, 'color', code, null);
    const faceDown = selectedField(card, 'faceDown', code);
    const sleep = selectedField(card, 'sleep', code);
    const summoningSick = selectedField(card, 'summoningSick', code);
    if (!nonempty(uid) || typeof name !== 'string'
      || (colorRaw !== null && colorRaw !== undefined && typeof colorRaw !== 'string')
      || typeof faceDown !== 'boolean' || typeof sleep !== 'boolean' || typeof summoningSick !== 'boolean') reject(code);

    const rawClasses = selectedField(card, 'classes', code, []);
    const classes = selectedArray(rawClasses, code, ancestors, item => {
      if (!nonempty(item)) reject(code);
      return item;
    });
    const timedRaw = selectedField(card, 'timedModifiers', code, []);
    const timedModifiers = selectedArray(timedRaw, code, ancestors, item => {
      selectedObject(item, code, ancestors);
      try {
        const result = {};
        for (const key of ['keyword', 'atk', 'expiresAfterTurn']) {
          const value = selectedField(item, key, code, MISSING);
          if (value === MISSING || value === null || value === undefined) continue;
          if (key === 'keyword') {
            if (!nonempty(value)) reject(code);
          } else if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)
            || (key === 'expiresAfterTurn' && (!Number.isSafeInteger(value) || value < 0))) reject(code);
          result[key] = value;
        }
        return result;
      } finally { ancestors.delete(item); }
    });
    const mountedRaw = selectedField(card, 'mounted', code, []);
    const mounted = selectedArray(mountedRaw, code, ancestors, provider => {
      selectedObject(provider, code, ancestors);
      try {
        const id = selectedField(provider, 'id', code);
        const protectRaw = selectedField(provider, 'protectConsumed', code, false);
        if (!nonempty(id) || (protectRaw !== null && protectRaw !== undefined && typeof protectRaw !== 'boolean')) reject(code);
        return { id, protectConsumed: protectRaw ?? false };
      } finally { ancestors.delete(provider); }
    });
    const std220Raw = selectedField(card, 'std220RegistryExecutedTurn', code, null);
    if (std220Raw !== null && std220Raw !== undefined && !safeRevision(std220Raw)) reject(code);
    return {
      ...keywordView, uid, name, color: colorRaw ?? null, classes, faceDown, sleep, summoningSick,
      atk: finiteNumberField(card, 'atk', code), tempAtk: finiteNumberField(card, 'tempAtk', code),
      permanentAtk: finiteNumberField(card, 'permanentAtk', code), load: finiteNumberField(card, 'load', code),
      timedModifiers, mounted, std220RegistryExecutedTurn: std220Raw ?? null
    };
  } finally { ancestors.delete(card); }
}

function attackPlayerView(engineState, playerId) {
  const code = 'INVALID_AUTHORITY';
  const players = own(engineState, 'players', code);
  ordinary(players, code);
  const player = own(players, playerId, code);
  ordinary(player, code);
  const user = selectedField(player, 'user', code);
  const ancestors = new Set();
  selectedObject(user, code, ancestors);
  let abilityKey;
  try {
    const raw = selectedField(user, 'abilityKey', code, null);
    if (raw !== null && raw !== undefined && typeof raw !== 'string') reject(code);
    abilityKey = raw ?? null;
  } finally { ancestors.delete(user); }
  const scriptActivatedRaw = selectedField(player, 'scriptActivatedTurn', code, null);
  if (scriptActivatedRaw !== null && scriptActivatedRaw !== undefined && !safeRevision(scriptActivatedRaw)) reject(code);
  const zone = name => selectedArray(selectedField(player, name, code), code, new Set(), attackCardView);
  const registry = selectedArray(selectedField(player, 'registry', code), code, new Set(), card => {
    const cardCode = 'INVALID_AUTHORITY';
    const cardAncestors = new Set();
    selectedObject(card, cardCode, cardAncestors);
    try {
      const category = selectedField(card, 'category', cardCode);
      const faceDown = selectedField(card, 'faceDown', cardCode);
      const colorRaw = selectedField(card, 'color', cardCode, null);
      if (typeof category !== 'string' || typeof faceDown !== 'boolean'
        || (colorRaw !== null && colorRaw !== undefined && typeof colorRaw !== 'string')) reject(cardCode);
      return { category, faceDown, color: colorRaw ?? null };
    } finally { cardAncestors.delete(card); }
  });
  return {
    front: zone('front'), back: zone('back'), registry,
    scriptActivatedTurn: scriptActivatedRaw ?? null, user: { abilityKey }
  };
}

export function attackPlanningView(engineState) {
  const active = own(engineState, 'active', 'INVALID_AUTHORITY');
  const turnNumber = own(engineState, 'turnNumber', 'INVALID_AUTHORITY');
  if (!['player', 'ai'].includes(active) || !safeRevision(turnNumber)) reject('INVALID_AUTHORITY');
  return {
    active, turnNumber,
    players: { player: attackPlayerView(engineState, 'player'), ai: attackPlayerView(engineState, 'ai') }
  };
}

function attackTarget(engineState, referenceInput, action, metadata, actorSeat, playerId) {
  const attacker = currentReferencedCard(engineState, referenceInput, action.attackerRef, metadata, actorSeat);
  if (attacker.entry.location.kind !== 'board' || attacker.entry.location.zone !== 'front'
    || attacker.entry.location.seatId !== actorSeat || attacker.entry.controllerSeat !== actorSeat) reject('ACTION_NOT_ALLOWED');
  const opponentId = playerId === 'player' ? 'ai' : 'player';
  const opponentSeat = metadata.seatIds[opponentId === 'player' ? 0 : 1];
  let targetUid;
  if (action.target.kind === 'user') {
    if (action.target.seatId !== opponentSeat) reject('ACTION_NOT_ALLOWED');
    targetUid = `${opponentId}-fortress`;
  } else {
    const target = currentReferencedCard(engineState, referenceInput, action.target.cardRef, metadata, actorSeat);
    if (target.entry.location.kind !== 'board' || target.entry.location.zone !== 'front'
      || target.entry.location.seatId !== opponentSeat || target.entry.controllerSeat !== opponentSeat) reject('ACTION_NOT_ALLOWED');
    targetUid = target.uid;
  }
  const view = attackPlanningView(engineState);
  const attackerView = view.players[playerId].front.find(card => card.uid === attacker.uid);
  if (!attackerView || !canAttack(view, playerId, attackerView)
    || !getAttackTargets(view, playerId, attackerView).some(candidate => candidate.uid === targetUid)) reject('ACTION_NOT_ALLOWED');
  return { attackerUid: attacker.uid, targetUid };
}

export function prepareAttackAction({ source, metadata, trusted, canonical, playerId, readReferenceState }) {
  const target = attackTarget(source.engineState, readReferenceState(), canonical.value.command.action,
    metadata, trusted.actorSeat, playerId);
  return prepared(canonical, {
    engineFunction: 'attack', playerId, attackerUid: target.attackerUid, targetUid: target.targetUid
  });
}
