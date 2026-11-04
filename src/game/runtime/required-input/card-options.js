import { findCard } from '../../engine.js';
import { CARD_LIBRARY } from '../../../data/cards.js';
import { buildRuntimeIdentityIndex } from '../bridge.js';
import { buildRuntimeReferenceFrame } from '../reference-frame.js';
import { createRuntimeReferenceLookup } from '../references.js';
import { optionId } from './shared.js';

// The card reference of a uid, or null. The identity index, the reference frame and the checked reference
// state are built on the first uid and kept for the rest: one engine state, one build.
export function cardReferenceResolver(engineState, referenceState, metadata, viewerSeat) {
  let basis;
  const build = () => {
    const index = buildRuntimeIdentityIndex(engineState);
    if (!index.ok) return null;
    const frame = buildRuntimeReferenceFrame(engineState);
    if (!frame.ok) return null;
    const lookup = createRuntimeReferenceLookup(referenceState, frame.value, viewerSeat);
    return lookup.ok ? { entries: index.value.entries, lookup: lookup.value } : null;
  };
  return uid => {
    const alias = engineState.runtimeContext.uidAliases.find(item => item.uid === uid);
    if (!alias) return null;
    basis ??= build() ?? false;
    if (!basis) return null;
    const entry = basis.entries.find(item => item.identity.instanceId === alias.identity.instanceId);
    return entry && entry.identity.matchId === metadata.matchId ? basis.lookup.find(entry.identity) : null;
  };
}

export function cardReference(engineState, referenceState, metadata, viewerSeat, uid) {
  return cardReferenceResolver(engineState, referenceState, metadata, viewerSeat)(uid);
}

const cardPreview = definition => ({ definitionId:definition.id,name:definition.name,
  definition:{id:definition.id,name:definition.name,category:definition.category,color:definition.color ?? null,
    cost:definition.cost ?? null,atk:definition.atk ?? null,str:definition.str ?? null,text:definition.text ?? '',classes:[...(definition.classes ?? [])]} });

// The card a placement choice is about: its reference (null while no reference frame covers it), its name and its preview.
// The actor sees it: it came from their hand or the trash.
export function placedCardView(engineState, referenceState, metadata, actorSeat, card) {
  const definition = CARD_LIBRARY[card.id];
  return { cardRef: cardReference(engineState, referenceState, metadata, actorSeat, card.uid), label: card.name,
    ...(definition ? { preview: cardPreview(definition) } : {}) };
}

export function cardOptions(engineState, referenceState, metadata, actorSeat, candidates, labels = {}, surfacePermission = false) {
  const actorId = metadata.seatIds[0] === actorSeat ? 'player' : 'ai';
  const reference = cardReferenceResolver(engineState, referenceState, metadata, actorSeat);
  return candidates.map((uid, index) => {
    const found = findCard(engineState, uid);
    const visible = found && (found.playerId === actorId && found.zoneName === 'hand'
      || surfacePermission && found.playerId === actorId && !found.card.faceDown
      || !['hand', 'deck'].includes(found.zoneName) && !found.card.faceDown);
    const definition = visible ? CARD_LIBRARY[found.card.id] : null;
    return {
      optionId: optionId(index), kind: 'card',
      cardRef: reference(uid),
      label: visible ? (typeof labels?.[uid] === 'string' ? labels[uid] : found.card.name) : null,
      ...(definition ? { preview: cardPreview(definition) } : {})
    };
  });
}

const CARD_IDS_BY_NAME = new Map(Object.values(CARD_LIBRARY).map(definition => [definition.name, definition.id]));
// Continuations name their card in several ways: by id, by the card on the board, by name, or by a card-specific type.
export function effectSource(engineState, continuation) {
  const uid = continuation?.sourceUid ?? continuation?.scriptUid;
  const typed = /^(std|sztb)(\d{3})/i.exec(continuation?.type ?? '');
  const id = [continuation?.sourceId, uid ? findCard(engineState, uid)?.card?.id : null,
    CARD_IDS_BY_NAME.get(continuation?.sourceName), typed ? `${typed[1].toUpperCase()}-${typed[2]}` : null]
    .find(candidate => typeof candidate === 'string' && Object.hasOwn(CARD_LIBRARY, candidate));
  const definition = id ? CARD_LIBRARY[id] : null;
  return definition ? { definitionId: definition.id, name: definition.name, text: definition.text ?? '' } : null;
}
