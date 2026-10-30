import { REFERENCE_TOKEN, copyData, canonicalJson, dense, exact, nonempty, ordinary, own, reject, revision } from './guards.js';

const FORMAT_VERSION = 1;
const ENVELOPE_KEYS = ['contractVersion', 'matchId', 'commandId', 'actorSeat', 'expectedRevision', 'action'];
const REFERENCE_ACTIONS = new Set(['restSecurity', 'install', 'recoverRegistry', 'activateScript']);

function reference(value) {
  if (typeof value !== 'string' || !REFERENCE_TOKEN.test(value)) reject('INVALID_COMMAND');
  return value;
}
function destination(value, registry = false) {
  ordinary(value, 'INVALID_COMMAND');
  if (registry && own(value, 'zone', 'INVALID_COMMAND') === 'registry') return exact(value, ['zone'], 'INVALID_COMMAND');
  // Re-execution may name a Code in the target area instead of a slot.
  if (registry && Object.hasOwn(value, 'hostRef')) {
    const result = exact(value, ['zone', 'hostRef'], 'INVALID_COMMAND');
    if (!['front', 'back'].includes(result.zone)) reject('INVALID_COMMAND');
    reference(result.hostRef);
    return result;
  }
  const result = exact(value, ['zone', 'slot'], 'INVALID_COMMAND');
  if (!['front', 'back'].includes(result.zone) || !Number.isSafeInteger(result.slot)
    || result.slot < 1 || Object.is(result.slot, -0)) reject('INVALID_COMMAND');
  return result;
}
function target(value) {
  ordinary(value, 'INVALID_COMMAND');
  const kind = own(value, 'kind', 'INVALID_COMMAND');
  if (kind === 'card') { const result = exact(value, ['kind', 'cardRef'], 'INVALID_COMMAND'); reference(result.cardRef); return result; }
  if (kind === 'user') { const result = exact(value, ['kind', 'seatId'], 'INVALID_COMMAND'); if (!nonempty(result.seatId)) reject('INVALID_COMMAND'); return result; }
  reject('INVALID_COMMAND');
}
function targets(value) {
  const result = dense(value, 'INVALID_COMMAND').map(target);
  if (new Set(result.map(canonicalJson)).size !== result.length) reject('INVALID_COMMAND');
  return result;
}
function placement(value) {
  ordinary(value, 'INVALID_COMMAND');
  const kind = own(value, 'kind', 'INVALID_COMMAND');
  if (kind === 'none') return exact(value, ['kind'], 'INVALID_COMMAND');
  if (kind === 'slot') { const result = exact(value, ['kind', 'zone', 'slot'], 'INVALID_COMMAND'); destination({zone:result.zone,slot:result.slot}); return result; }
  if (kind === 'aboveCode' || kind === 'belowOb') { const result = exact(value, ['kind', 'hostRef'], 'INVALID_COMMAND'); reference(result.hostRef); return result; }
  if (kind === 'asScript') { const result = exact(value, ['kind', 'slot'], 'INVALID_COMMAND'); destination({zone:'back',slot:result.slot}); return result; }
  reject('INVALID_COMMAND');
}

export function canonicalCommand(input) {
  const source = exact(input, ENVELOPE_KEYS, 'INVALID_COMMAND');
  if (!Number.isSafeInteger(source.contractVersion) || Object.is(source.contractVersion, -0) || source.contractVersion < 0) reject('INVALID_COMMAND');
  if (source.contractVersion !== FORMAT_VERSION) reject('UNSUPPORTED_CONTRACT');
  if (!nonempty(source.matchId) || !nonempty(source.commandId) || !nonempty(source.actorSeat) || !revision(source.expectedRevision)) reject('INVALID_COMMAND');
  const action = copyData(source.action, 'INVALID_COMMAND');
  ordinary(action, 'INVALID_COMMAND');
  const type = own(action, 'type', 'INVALID_COMMAND');
  if (!nonempty(type)) reject('INVALID_COMMAND');
  let canonicalAction;
  if (type === 'endTurn' || type === 'keepOpeningHand' || type === 'openingMulligan' && !Object.hasOwn(action, 'cardRefs')) canonicalAction = exact(action, ['type'], 'INVALID_COMMAND');
  else if (type === 'openingMulligan') {
    // Opening protocol v2.4 names the cards to return; whether this form is valid for the match is the bridge's call.
    canonicalAction = exact(action, ['type', 'cardRefs'], 'INVALID_COMMAND');
    canonicalAction.cardRefs = dense(canonicalAction.cardRefs, 'INVALID_COMMAND');
    if (canonicalAction.cardRefs.length < 1
      || !canonicalAction.cardRefs.every(cardRef => typeof cardRef === 'string' && cardRef.length === 34 && REFERENCE_TOKEN.test(cardRef))
      || new Set(canonicalAction.cardRefs).size !== canonicalAction.cardRefs.length) reject('INVALID_COMMAND');
  }
  else if (type === 'executeSpell' || type === 'executeRegistry' || type === 'activateCardEffect') {
    const keys = type === 'executeSpell' ? ['type','cardRef','targets','selectionScope']
      : type === 'executeRegistry' ? ['type','cardRef','placement','targets','selectionScope']
      : ['type','cardRef','effectKey','targets','targetZone'];
    canonicalAction = exact(action, keys, 'INVALID_COMMAND');
    reference(canonicalAction.cardRef);
    canonicalAction.targets = targets(canonicalAction.targets);
    if (type === 'activateCardEffect') {
      if (!nonempty(canonicalAction.effectKey) || ![null,'front','back'].includes(canonicalAction.targetZone)) reject('INVALID_COMMAND');
    } else if (canonicalAction.selectionScope !== null && !nonempty(canonicalAction.selectionScope)) reject('INVALID_COMMAND');
    if (type === 'executeRegistry') canonicalAction.placement = placement(canonicalAction.placement);
  }
  else if (type === 'mountCard') {
    canonicalAction = exact(action, ['type','cardRef','hostRef','mountKind'], 'INVALID_COMMAND');
    reference(canonicalAction.cardRef); reference(canonicalAction.hostRef);
    if (canonicalAction.cardRef === canonicalAction.hostRef || !['aboveCode','belowOb'].includes(canonicalAction.mountKind)) reject('INVALID_COMMAND');
  }
  else if (type === 'executeCard' || type === 'redeploy' || type === 'setScript') {
    canonicalAction = exact(action, ['type', 'cardRef', 'destination'], 'INVALID_COMMAND');
    if (typeof canonicalAction.cardRef !== 'string' || canonicalAction.cardRef.length !== 34
      || !REFERENCE_TOKEN.test(canonicalAction.cardRef)) reject('INVALID_COMMAND');
    canonicalAction.destination = destination(canonicalAction.destination, type === 'redeploy');
    if (type === 'setScript' && canonicalAction.destination.zone !== 'back') reject('INVALID_COMMAND');
  }
  else if (type === 'executeLayered') {
    canonicalAction = exact(action, ['type', 'cardRef', 'materialRefs', 'destination'], 'INVALID_COMMAND');
    if (typeof canonicalAction.cardRef !== 'string' || canonicalAction.cardRef.length !== 34
      || !REFERENCE_TOKEN.test(canonicalAction.cardRef)) reject('INVALID_COMMAND');
    canonicalAction.materialRefs = dense(canonicalAction.materialRefs, 'INVALID_COMMAND');
    if (canonicalAction.materialRefs.length < 1
      || !canonicalAction.materialRefs.every(cardRef => typeof cardRef === 'string' && cardRef.length === 34
        && REFERENCE_TOKEN.test(cardRef))
      || new Set(canonicalAction.materialRefs).size !== canonicalAction.materialRefs.length) reject('INVALID_COMMAND');
    canonicalAction.destination = exact(canonicalAction.destination, ['zone', 'slot'], 'INVALID_COMMAND');
    if (!['front', 'back'].includes(canonicalAction.destination.zone)
      || !Number.isSafeInteger(canonicalAction.destination.slot) || canonicalAction.destination.slot < 1
      || Object.is(canonicalAction.destination.slot, -0)) reject('INVALID_COMMAND');
  }
  else if (type === 'activateAbility') {
    canonicalAction = exact(action, ['type', 'ability'], 'INVALID_COMMAND');
    canonicalAction.ability = exact(canonicalAction.ability, ['kind', 'key'], 'INVALID_COMMAND');
    if (!nonempty(canonicalAction.ability.kind) || !nonempty(canonicalAction.ability.key)) reject('INVALID_COMMAND');
    if (canonicalAction.ability.kind !== 'user' || canonicalAction.ability.key !== 'turbo') reject('ACTION_SCHEMA_UNAVAILABLE');
  }
  else if (type === 'sandboxAddCard') {
    canonicalAction = exact(action, ['type', 'definitionId', 'targetSeat'], 'INVALID_COMMAND');
    if (!nonempty(canonicalAction.definitionId) || !nonempty(canonicalAction.targetSeat)) reject('INVALID_COMMAND');
  }
  else if (type === 'sandboxSelectActiveSeat') {
    canonicalAction = exact(action, ['type', 'targetSeat'], 'INVALID_COMMAND');
    if (!nonempty(canonicalAction.targetSeat)) reject('INVALID_COMMAND');
  }
  else if (type === 'attack') {
    canonicalAction = exact(action, ['type', 'attackerRef', 'target'], 'INVALID_COMMAND');
    if (typeof canonicalAction.attackerRef !== 'string' || canonicalAction.attackerRef.length !== 34
      || !REFERENCE_TOKEN.test(canonicalAction.attackerRef)) reject('INVALID_COMMAND');
    ordinary(canonicalAction.target, 'INVALID_COMMAND');
    const kind = own(canonicalAction.target, 'kind', 'INVALID_COMMAND');
    if (kind === 'card') {
      canonicalAction.target = exact(canonicalAction.target, ['kind', 'cardRef'], 'INVALID_COMMAND');
      if (typeof canonicalAction.target.cardRef !== 'string' || canonicalAction.target.cardRef.length !== 34
        || !REFERENCE_TOKEN.test(canonicalAction.target.cardRef)) reject('INVALID_COMMAND');
    } else if (kind === 'user') {
      canonicalAction.target = exact(canonicalAction.target, ['kind', 'seatId'], 'INVALID_COMMAND');
      if (!nonempty(canonicalAction.target.seatId)) reject('INVALID_COMMAND');
    } else reject('INVALID_COMMAND');
  }
  else if (type === 'answerChoice') {
    canonicalAction = exact(action, ['type', 'choiceId', 'optionIds', 'allocation'], 'INVALID_COMMAND');
    if (!nonempty(canonicalAction.choiceId)) reject('INVALID_COMMAND');
    canonicalAction.optionIds = dense(canonicalAction.optionIds, 'INVALID_COMMAND');
    if (!canonicalAction.optionIds.every(nonempty) || new Set(canonicalAction.optionIds).size !== canonicalAction.optionIds.length) reject('INVALID_COMMAND');
    canonicalAction.allocation = dense(canonicalAction.allocation, 'INVALID_COMMAND').map(entry => {
      const value = exact(entry, ['optionId', 'amount'], 'INVALID_COMMAND');
      if (!nonempty(value.optionId) || !Number.isSafeInteger(value.amount) || value.amount < 0 || Object.is(value.amount, -0)) reject('INVALID_COMMAND');
      return value;
    });
    if (new Set(canonicalAction.allocation.map(entry => entry.optionId)).size !== canonicalAction.allocation.length) reject('INVALID_COMMAND');
  }
  else if (type === 'declineChoice') {
    canonicalAction = exact(action, ['type', 'choiceId'], 'INVALID_COMMAND');
    if (!nonempty(canonicalAction.choiceId)) reject('INVALID_COMMAND');
  }
  else if (REFERENCE_ACTIONS.has(type)) {
    canonicalAction = exact(action, ['type', 'cardRef'], 'INVALID_COMMAND');
    if (typeof canonicalAction.cardRef !== 'string' || canonicalAction.cardRef.length !== 34
      || !REFERENCE_TOKEN.test(canonicalAction.cardRef)) reject('INVALID_COMMAND');
  } else reject('INVALID_COMMAND');
  const command = { ...source, action: canonicalAction };
  return { command, canonicalPayload: canonicalJson(command) };
}
