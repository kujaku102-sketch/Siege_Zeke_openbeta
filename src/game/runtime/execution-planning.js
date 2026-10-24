import { canDirectRelogAtSlot, canPlayLayeredCard, getLayeredSelectionPlan, normalExecutionCheck, normalSpellSelection, normalCardEffectSelection, relogPreparationKind, supportsAlternateScriptSetup } from '../engine.js';
import { isObCard } from '../card-types.js';
import { runtimePlanningReads } from './command-bridge.js';
import { layeredSpecFor } from '../layered-specs.js';

function slots(context, zones = ['front', 'back']) {
  const player = context.state.players[context.playerId];
  return zones.flatMap(zone => Array.from({ length: player.user[`${zone}Limit`] }, (_, index) => ({ zone, slot: index + 1 })));
}

export function executionDestinations(context, entry, materialRefs = []) {
  const source = context.resolve(entry.base.cardRef);
  if (!source || source.entry.controllerSeat !== context.viewerSeat) return [];
  const { card, entry: location } = source;
  if (entry.actionType === 'executeLayered') {
    const materials = materialRefs.map(ref => context.resolve(ref));
    if (materials.some(item => !item)) return [];
    const uids = materials.map(item => item.card.uid);
    if (new Set(uids).size !== uids.length || uids.includes(card.uid)) return [];
    return slots(context).filter(destination => canPlayLayeredCard(context.view('layered'), context.playerId,
      card.uid, uids, destination.zone, destination.slot).ok);
  }
  const view = context.view('normal');
  const cardView = runtimePlanningReads.normalCardInView(view,card.uid);
  if (entry.actionType === 'executeCard' || entry.actionType === 'setScript') {
    if (location.location.kind !== 'zone' || location.location.zone !== 'hand'
      || !cardView || cardView.dragFree || entry.actionType === 'setScript' && !supportsAlternateScriptSetup(cardView)
      || entry.actionType === 'executeCard' && !(isObCard(cardView) || ['Code','Script'].includes(cardView.category))) return [];
    const open = slots(context, entry.actionType === 'setScript' || cardView.category === 'Script' ? ['back'] : ['front','back'])
      .filter(destination => normalExecutionCheck(view,context.playerId,cardView,
        {zone:destination.zone,requestedSlot:destination.slot,...(entry.actionType === 'setScript' ? {asScript:true} : {})}).ok);
    // Mounting is a state, not a separate route: executing from hand also lists the Code (or Ob) to stack on.
    if (entry.actionType !== 'executeCard') return open;
    return [...open, ...executionPlacements(context,{...entry,actionType:'mountCard'})
      .filter(place => ['aboveCode','belowOb'].includes(place.kind))];
  }
  if (entry.actionType === 'redeploy') {
    if (location.location.kind !== 'board') return [];
    const sourceZone = location.location.zone;
    const layerCount = runtimePlanningReads.selectedLayerCount(card, 'INVALID_AUTHORITY');
    if (relogPreparationKind(cardView,layerCount) === 'registry') return canDirectRelogAtSlot(view,context.playerId,cardView,
      {sourceZone,zone:sourceZone === 'front' ? 'back' : 'front',requestedSlot:null,layerCount}).ok ? [{zone:'registry'}] : [];
    const targetZone = sourceZone === 'front' ? 'back' : 'front';
    const open = slots(context, [targetZone]).filter(destination => canDirectRelogAtSlot(view,
      context.playerId, cardView, { sourceZone, zone: destination.zone, requestedSlot: destination.slot, layerCount }).ok);
    // An Ob can also be re-executed onto a Code already in the target area.
    const codes = isObCard(cardView) ? view.players[context.playerId][targetZone].filter(host => !host.faceDown && host.category === 'Code')
      .map(host => ({ host, hostRef: context.refFor(host) })).filter(({ host, hostRef }) => hostRef && canDirectRelogAtSlot(view,
        context.playerId, cardView, { sourceZone, zone: targetZone, requestedSlot: null, layerCount, baseUid: host.uid }).ok)
      .map(({ hostRef }) => ({ zone: targetZone, hostRef })) : [];
    return [...open, ...codes];
  }
  return [];
}

function normalSource(context,entry) {
  const source = context.resolve(entry.base.cardRef);
  if (!source || source.entry.controllerSeat !== context.viewerSeat || source.entry.location.seatId !== context.viewerSeat) return null;
  const view = context.view('normal');
  const card = runtimePlanningReads.normalCardInView(view,source.card.uid);
  return card && !card.dragFree ? {source,view,card} : null;
}
export function executionPlacements(context,entry) {
  const family = normalSource(context,entry);
  if (!family) return [];
  const {source,view,card} = family, registry = entry.actionType === 'executeRegistry';
  if (source.entry.location.kind !== 'zone' || source.entry.location.zone !== (registry ? 'registry' : 'hand')) return [];
  const check = options => normalExecutionCheck(view,context.playerId,card,options,registry).ok;
  if (card.category === 'Sp') return entry.actionType !== 'mountCard' && check({}) ? [{kind:'none'}] : [];
  const placements = [];
  if (registry && (isObCard(card) || ['Code','Script'].includes(card.category))) {
    for (const destination of slots(context,card.category === 'Script' ? ['back'] : ['front','back'])) {
      if (check({zone:destination.zone,requestedSlot:destination.slot})) placements.push({kind:'slot',...destination});
    }
    if (supportsAlternateScriptSetup(card)) for (const destination of slots(context,['back'])) {
      if (check({zone:'back',requestedSlot:destination.slot,asScript:true})) placements.push({kind:'asScript',slot:destination.slot});
    }
  }
  for (const zone of ['front','back']) for (const host of view.players[context.playerId][zone]) {
    const hostRef = context.refFor(host);
    if (!hostRef || host.faceDown) continue;
    const kind = isObCard(card) && host.category === 'Code' ? 'aboveCode' : card.category === 'Code' && isObCard(host) ? 'belowOb' : null;
    if (kind && check({zone,[kind === 'aboveCode' ? 'baseUid' : 'underUid']:host.uid})) placements.push({kind,hostRef});
  }
  return placements;
}
export function executionTargetPlan(context,entry,effectKey = null,targets = []) {
  const family = normalSource(context,entry);
  if (!family) return null;
  const {view,card} = family;
  if (entry.actionType !== 'activateCardEffect') return normalSpellSelection(view,context.playerId,card);
  const effect = runtimePlanningReads.normalEffectEntries(view,context.playerId,card).find(item => item.effectKey === effectKey);
  if (!effect) return null;
  return normalCardEffectSelection(view,context.playerId,card,effect.plan.effect.id,targets.map(target => target.kind === 'card'
    ? context.resolve(target.cardRef)?.card.uid : `${context.metadata.seatIds[0] === target.seatId ? 'player' : 'ai'}-fortress`));
}
export function executionEffects(context,entry) {
  const family = normalSource(context,entry);
  return family ? runtimePlanningReads.normalEffectEntries(family.view,context.playerId,family.card).map(({effectKey,label}) => ({effectKey,label})) : [];
}
export function targetOptions(context,plan) {
  if (!plan) return [];
  return plan.candidates.flatMap(card => {
    if (card.category === 'User') {
      const playerId = card.uid === 'player-fortress' ? 'player' : card.uid === 'ai-fortress' ? 'ai' : null;
      return playerId ? [{kind:'user',seatId:context.metadata.seatIds[playerId === 'player' ? 0 : 1],label:card.name}] : [];
    }
    const cardRef = context.refFor(card);
    return cardRef ? [{kind:'card',cardRef}] : [];
  });
}

export function layeredMaterials(context, entry) {
  const source = context.resolve(entry.base.cardRef);
  if (!source || !layeredSpecFor(source.card)) return null;
  const view = context.view('layered');
  const card = view.players[context.playerId].hand.find(item => item.uid === source.card.uid);
  if (!card) return null;
  const plan = getLayeredSelectionPlan(view, context.playerId, card);
  if (!plan) return null;
  const entries = plan.entries.filter(item => context.refFor(item.card));
  const visible = new Set(entries);
  return { ...plan, entries, maximum: Math.min(plan.maximum, entries.length),
    groups: plan.groups.map(group => ({ ...group, entries: group.entries.filter(item => visible.has(item)) })) };
}

export function executionIntents(context) {
  const player = context.state.players[context.playerId];
  const intents = [];
  for (const card of player.hand) {
    const cardRef = context.refFor(card);
    if (!cardRef) continue;
    const entry = { kind: 'intent', actionType: 'executeCard', base: { cardRef }, readiness: 'ready' };
    if (executionDestinations(context, entry).length) intents.push(entry);
    if (card.category === 'Sp') {
      const spell = {kind:'intent',actionType:'executeSpell',base:{cardRef},readiness:'requiresSelection'};
      const plan = executionTargetPlan(context,spell);
      if (executionPlacements(context,spell).length && plan && targetOptions(context,plan).length >= plan.minimum) intents.push(spell);
    }
    const script = {kind:'intent',actionType:'setScript',base:{cardRef},readiness:'requiresSelection'};
    if (executionDestinations(context,script).length) intents.push(script);
    const layered = { kind: 'intent', actionType: 'executeLayered', base: { cardRef }, readiness: 'requiresSelection' };
    const plan = layeredMaterials(context, layered);
    if (plan && plan.entries.length >= plan.minimum) intents.push(layered);
  }
  for (const card of player.registry) {
    const cardRef = context.refFor(card); if (!cardRef) continue;
    const entry = {kind:'intent',actionType:'executeRegistry',base:{cardRef},readiness:'requiresSelection'};
    const plan = card.category === 'Sp' ? executionTargetPlan(context,entry) : null;
    if (executionPlacements(context,entry).length && (card.category !== 'Sp' || plan && targetOptions(context,plan).length >= plan.minimum)) intents.push(entry);
  }
  for (const card of [...player.hand,...player.front,...player.back]) {
    const cardRef = context.refFor(card); if (!cardRef || card.faceDown) continue;
    const entry = {kind:'intent',actionType:'activateCardEffect',base:{cardRef},readiness:'requiresSelection'};
    if (executionEffects(context,entry).length) intents.push(entry);
  }
  for (const card of [...player.front, ...player.back]) {
    const cardRef = context.refFor(card);
    if (!cardRef) continue;
    const entry = { kind: 'intent', actionType: 'redeploy', base: { cardRef }, readiness: 'ready' };
    if (executionDestinations(context, entry).length) intents.push(entry);
  }
  return intents;
}

export function completeExecution(entry, destination, materialRefs = []) {
  if (entry.actionType === 'executeCard' && destination.hostRef) return { type: 'mountCard', cardRef: entry.base.cardRef,
    hostRef: destination.hostRef, mountKind: destination.kind };
  return { type: entry.actionType, cardRef: entry.base.cardRef,
    ...(entry.actionType === 'executeLayered' ? { materialRefs } : {}), destination };
}
