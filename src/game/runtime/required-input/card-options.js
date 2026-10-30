import { findCard } from '../../engine.js';
import { CARD_LIBRARY } from '../../../data/cards.js';
import { buildRuntimeIdentityIndex } from '../bridge.js';
import { buildRuntimeReferenceFrame } from '../reference-frame.js';
import { findRuntimeCardReference } from '../references.js';
import { optionId } from './shared.js';

export function cardReference(engineState, referenceState, metadata, viewerSeat, uid) {
  const index = buildRuntimeIdentityIndex(engineState);
  if (!index.ok) return null;
  const alias = engineState.runtimeContext.uidAliases.find(item => item.uid === uid);
  if (!alias) return null;
  const entry = index.value.entries.find(item => item.identity.instanceId === alias.identity.instanceId);
  if (!entry) return null;
  const frame = buildRuntimeReferenceFrame(engineState);
  if (!frame.ok) return null;
  const found = findRuntimeCardReference(referenceState, {
    frame: frame.value, matchId: metadata.matchId, viewerSeat, identity: entry.identity
  });
  return found.ok ? found.value.cardRef : null;
}

export function cardOptions(engineState, referenceState, metadata, actorSeat, candidates, labels = {}, surfacePermission = false) {
  const actorId = metadata.seatIds[0] === actorSeat ? 'player' : 'ai';
  return candidates.map((uid, index) => {
    const found = findCard(engineState, uid);
    const visible = found && (found.playerId === actorId && found.zoneName === 'hand'
      || surfacePermission && found.playerId === actorId && !found.card.faceDown
      || !['hand', 'deck'].includes(found.zoneName) && !found.card.faceDown);
    const definition = visible ? CARD_LIBRARY[found.card.id] : null;
    return {
      optionId: optionId(index), kind: 'card',
      cardRef: cardReference(engineState, referenceState, metadata, actorSeat, uid),
      label: visible ? (typeof labels?.[uid] === 'string' ? labels[uid] : found.card.name) : null,
      ...(definition ? { preview: { definitionId:definition.id,name:definition.name,
        definition:{id:definition.id,name:definition.name,category:definition.category,color:definition.color ?? null,
          cost:definition.cost ?? null,atk:definition.atk ?? null,str:definition.str ?? null,text:definition.text ?? '',classes:[...(definition.classes ?? [])]} } } : {})
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
