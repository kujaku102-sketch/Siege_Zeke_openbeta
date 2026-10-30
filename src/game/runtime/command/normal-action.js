import { normalCardEffectSelection, normalExecutionCheck, normalSpellSelection, supportsAlternateScriptSetup } from '../../engine.js';
import { isObCard } from '../../card-types.js';
import { currentReferencedCard } from './card-target.js';
import { prepared, reject } from './common.js';
import { normalCardInView, normalEffectEntries, normalPlanningView } from './normal-views.js';

export function prepareNormalAction({ source, metadata, trusted, canonical, playerId, readReferenceState }) {
  const action = canonical.value.command.action;
  const refs = readReferenceState();
  const resolve = ref => currentReferencedCard(source.engineState,refs,ref,metadata,trusted.actorSeat);
  const sourceCard = resolve(action.cardRef);
  const location = sourceCard.entry.location;
  if (sourceCard.entry.controllerSeat !== trusted.actorSeat || location.seatId !== trusted.actorSeat) reject('ACTION_NOT_ALLOWED');
  const view = normalPlanningView(source.engineState), card = normalCardInView(view,sourceCard.uid);
  if (!card || card.dragFree) reject('ACTION_NOT_ALLOWED');
  const registry = action.type === 'executeRegistry';
  if (action.type === 'activateCardEffect') {
    if (!['hand','front','back'].includes(location.zone)) reject('ACTION_NOT_ALLOWED');
    const effect = normalEffectEntries(view,playerId,card).find(item => item.effectKey === action.effectKey);
    if (!effect) reject('ACTION_NOT_ALLOWED');
    const uids = normalTargetUids(action.targets, resolve, metadata);
    const plan = normalCardEffectSelection(view,playerId,card,effect.plan.effect.id,uids);
    validateNormalTargets(plan, uids);
    if (plan.needsZone ? !plan.zones.includes(action.targetZone) : action.targetZone !== null) reject('ACTION_NOT_ALLOWED');
    return prepared(canonical,{engineFunction:'activateCardEffect',playerId,uid:sourceCard.uid,effectId:plan.effect.id,
      options:{targetUid:uids.length === 1 ? uids[0] : null,targetUids:uids.length > 1 ? uids : [],targetZone:action.targetZone}});
  }
  if (location.kind !== 'zone' || location.zone !== (registry ? 'registry' : 'hand')) reject('ACTION_NOT_ALLOWED');
  let options = {};
  const place = registry ? action.placement : action.type === 'mountCard' ? {kind:action.mountKind,hostRef:action.hostRef}
    : action.type === 'setScript' ? {kind:'asScript',slot:action.destination.slot} : {kind:'none'};
  if (place.kind === 'slot' || place.kind === 'asScript') {
    if (place.kind === 'asScript' ? !supportsAlternateScriptSetup(card) : !(isObCard(card) || ['Code','Script'].includes(card.category))) reject('ACTION_NOT_ALLOWED');
    options = {zone:place.kind === 'asScript' ? 'back' : place.zone,requestedSlot:place.slot,...(place.kind === 'asScript' ? {asScript:true} : {})};
    if (card.category === 'Script' && options.zone !== 'back') reject('ACTION_NOT_ALLOWED');
  } else if (['aboveCode','belowOb'].includes(place.kind)) {
    const host = resolve(place.hostRef);
    if (host.entry.controllerSeat !== trusted.actorSeat || host.entry.location.kind !== 'board' || host.entry.location.seatId !== trusted.actorSeat) reject('ACTION_NOT_ALLOWED');
    options = {zone:host.entry.location.zone,[place.kind === 'aboveCode' ? 'baseUid' : 'underUid']:host.uid};
  } else if (card.category !== 'Sp') reject('ACTION_NOT_ALLOWED');
  const uids = normalTargetUids(action.targets ?? [],resolve,metadata);
  if (card.category === 'Sp') {
    if (place.kind !== 'none') reject('ACTION_NOT_ALLOWED');
    const plan = normalSpellSelection(view,playerId,card);
    validateNormalTargets(plan,uids);
    if (plan.scopes.length ? !plan.scopes.includes(action.selectionScope) : action.selectionScope !== null) reject('ACTION_NOT_ALLOWED');
    Object.assign(options,{targetUid:uids.length === 1 ? uids[0] : null,targetUids:uids.length > 1 ? uids : [],selectionScope:action.selectionScope});
  } else if (uids.length || registry && action.selectionScope !== null) reject('ACTION_NOT_ALLOWED');
  if (!normalExecutionCheck(view,playerId,card,options,registry).ok) reject('ACTION_NOT_ALLOWED');
  return prepared(canonical,{engineFunction:registry ? 'executeRegistryCard' : 'playCard',playerId,uid:sourceCard.uid,options});
}
function normalTargetUids(targets, resolve, metadata) {
  return targets.map(target => {
    if (target.kind === 'card') return resolve(target.cardRef).uid;
    const index = metadata.seatIds.indexOf(target.seatId);
    if (index < 0) reject('ACTION_NOT_ALLOWED');
    return `${index === 0 ? 'player' : 'ai'}-fortress`;
  });
}
function validateNormalTargets(plan,uids) {
  if (!plan || uids.length < plan.minimum || uids.length > plan.maximum || new Set(uids).size !== uids.length
    || uids.some(uid => !plan.candidates.some(item => item.uid === uid))
    || (plan.groups ?? []).some(group => uids.filter(uid => group.some(item => item.uid === uid)).length !== 1)) reject('ACTION_NOT_ALLOWED');
}
