import { cardOptions, effectSource } from './card-options.js';
import { selectionConstraints, selectionPresentationKey } from './constraints.js';
import { choiceId, optionId, seatForPlayer } from './shared.js';

export function selectionInput(engineState, referenceState, metadata, revision, pending) {
  const request = pending.request;
  const playerId = request?.continuation?.playerId;
  if (!['player', 'ai'].includes(playerId) || !request || typeof request.mode !== 'string') return null;
  const actorSeat = seatForPlayer(metadata, playerId);
  const source = effectSource(engineState, request.continuation);
  const scope = request.mode === 'scope';
  const candidates = scope ? request.scopeOptions : request.candidates;
  if (!Array.isArray(candidates)) return null;
  const options = request.mode === 'random' ? [] : scope
    ? candidates.map((value, index) => ({ optionId: optionId(index), kind: 'value', label: String(value) }))
    : cardOptions(engineState, referenceState, metadata, actorSeat, candidates, request.candidateLabels,
      ['runtime-access-reference','access-to-hand','access-drag','access-distribute','selection-module-look'].includes(request.continuation?.type));
  return {
    source: 'selection', playerId, actorSeat, rawOptions: [...candidates],
    dto: {
      choiceId: choiceId(revision, 'selection'), kind: request.spec?.kind === 'allocation' ? 'allocation' : 'selection',
      presentationKey: selectionPresentationKey(request), actorSeat,
      // What kind of window it is when the engine opens it for a rule of its own (a CPU answers such a window by its purpose, not by the card).
      ...(request.continuation?.type === "attack-declaration-cost" ? { purpose: "attack-declaration-cost" } : {}),
      // The engine's prompt line names what the pick is for; the actor already knows its own source.
      ...(typeof request.label === 'string' && request.label ? { title: request.label } : {}),
      // The card whose effect is asking, so the chooser can see which clause is resolving.
      ...(source ? { source } : {}),
      optional: request.mode !== 'random' && Number(request.minimum ?? 1) === 0,
      minimum: request.mode === 'random' ? 0 : Number(request.minimum ?? 0),
      maximum: request.mode === 'random' ? 0 : Number(request.maximum ?? request.count ?? 1), options,
      constraints: selectionConstraints(request, candidates)
    }
  };
}
