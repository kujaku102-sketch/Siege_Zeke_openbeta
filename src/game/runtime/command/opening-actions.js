import { canKeepOpeningHand, canOpeningMulligan } from '../../engine.js';
import { ordinary, own, prepared, reject, safeRevision, selectedArray, selectedField, selectedObject } from './common.js';
import { installTarget } from './registry-actions.js';

export function mulliganEligibilityView(engineState, playerId) {
  const code = 'INVALID_AUTHORITY';
  const active = own(engineState, 'active', code);
  const turnNumber = own(engineState, 'turnNumber', code);
  if (!['player', 'ai'].includes(active) || !safeRevision(turnNumber)) reject(code);
  const players = own(engineState, 'players', code);
  ordinary(players, code);
  const player = own(players, playerId, code);
  ordinary(player, code);
  const user = selectedField(player, 'user', code);
  const ancestors = new Set();
  selectedObject(user, code, ancestors);
  let userView;
  try {
    const abilityKey = selectedField(user, 'abilityKey', code);
    const initialHandRaw = selectedField(user, 'initialHand', code, null);
    if (typeof abilityKey !== 'string'
      || (initialHandRaw !== null && initialHandRaw !== undefined
        && (!Number.isSafeInteger(initialHandRaw) || initialHandRaw < 0 || Object.is(initialHandRaw, -0)))) reject(code);
    userView = { abilityKey, initialHand: initialHandRaw ?? 5 };
  } finally { ancestors.delete(user); }
  const openingState = Object.hasOwn(engineState, 'opening') ? own(engineState, 'opening', code) : null;
  if (openingState !== null) ordinary(openingState, code);
  const opening = openingState === null ? null : selectedField(openingState, 'status', code);
  if (opening !== null && typeof opening !== 'string') reject(code);
  const mulligansUsed = selectedField(player, 'mulligansUsed', code);
  if (!Number.isSafeInteger(mulligansUsed) || mulligansUsed < 0 || Object.is(mulligansUsed, -0)) reject(code);
  const zone = name => selectedArray(selectedField(player, name, code), code, new Set(), () => null);
  return {
    active, turnNumber, ...(opening === null ? {} : { opening: { status: opening } }),
    players: { [playerId]: {
      user: userView, mulligansUsed,
      hand: zone('hand'), front: zone('front'), back: zone('back'), registry: zone('registry'),
      trash: zone('trash'), ban: zone('ban')
    } }
  };
}

export const OPENING_ACTIONS = new Set(['openingMulligan', 'keepOpeningHand']);

// v2.4 names the cards to return and only exists while the engine holds the opening; the
// no-argument form is the legacy mulligan. A match accepts only the form of its own protocol.
export function prepareOpeningMulliganAction({ source, metadata, trusted, canonical, playerId, readReferenceState }) {
  const action = canonical.value.command.action, v24 = metadata.startOptions.openingProtocol === 'v2.4';
  if (v24 !== Object.hasOwn(action, 'cardRefs')) reject('ACTION_NOT_ALLOWED');
  const view = mulliganEligibilityView(source.engineState, playerId);
  if (v24 && !view.opening || !canOpeningMulligan(view, playerId)) reject('ACTION_NOT_ALLOWED');
  if (!v24) return prepared(canonical, { engineFunction: 'openingMulligan', playerId });
  const uids = action.cardRefs.map(cardRef => installTarget(source.engineState, readReferenceState(), cardRef, metadata, trusted.actorSeat).uid);
  return prepared(canonical, { engineFunction: 'openingMulliganCards', playerId, uids });
}

export function prepareKeepOpeningHandAction({ source, metadata, canonical, playerId }) {
  if (metadata.startOptions.openingProtocol !== 'v2.4'
    || !canKeepOpeningHand(mulliganEligibilityView(source.engineState, playerId), playerId)) reject('ACTION_NOT_ALLOWED');
  return prepared(canonical, { engineFunction: 'keepOpeningHand', playerId });
}
