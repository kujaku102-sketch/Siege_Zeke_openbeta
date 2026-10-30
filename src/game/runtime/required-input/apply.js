import {
  activateResponse, activateScript, cardHasKeyword, configurePlugin, declinePrompt, declineResponse, endTurn,
  resolveAccessDragPlacement, resolveCardSelection, resolveTriggerChoice, restSecurity
} from '../../engine.js';
import { canConfirmSelection, confirmSelection } from '../../selection-model.js';
import { current } from './pending-input.js';

function applySelection(engineState, input, adapter) {
  const request = engineState.pending.request;
  const draft = structuredClone(request);
  if (request.mode === 'scope') draft.selectedScope = input.rawOptions[adapter.optionIndexes[0]] ?? null;
  else if (request.mode !== 'random') draft.selected = adapter.optionIndexes.map(index => input.rawOptions[index]);
  if (request.spec?.kind === 'allocation') {
    draft.allocation = Object.fromEntries(input.rawOptions.map(value => [value, 0]));
    for (const entry of adapter.allocation) {
      if (entry.optionIndex < 0 || !Number.isSafeInteger(entry.amount) || entry.amount < 0) return false;
      draft.allocation[input.rawOptions[entry.optionIndex]] = entry.amount;
    }
    draft.selected = input.rawOptions.filter(value => draft.allocation[value] > 0);
  }
  if (!canConfirmSelection(draft)) return false;
  const result = confirmSelection(draft, engineState.rng);
  return result !== null && resolveCardSelection(engineState, request.continuation, result);
}

export function applyRequiredInputAction(engineState, metadata, referenceState, adapter, decline = false) {
  const input = current({ engineState, metadata, referenceState, revision: adapter.revision });
  if (!input || input.playerId !== adapter.playerId) return false;
  if (decline) {
    if (!input.dto.optional) return false;
    if (input.source === 'script-activation') return declinePrompt(engineState);
    if (input.source === 'response-window') return declineResponse(engineState, input.playerId);
    // endTurn deletes this window before opening a later end-of-turn choice.
    // A consumed window is accepted even when the turn is not complete yet.
    if (input.source === 'security-rest') return endTurn(engineState) || engineState.securityRestWindow == null;
    if (input.source === 'selection' && engineState.pending.request.mode !== 'scope') {
      return resolveCardSelection(engineState, engineState.pending.request.continuation, { selected: [] });
    }
    return false;
  }
  if (input.source === 'selection') return applySelection(engineState, input, adapter);
  const selected = input.rawOptions[adapter.optionIndexes[0]];
  if (selected === undefined || adapter.optionIndexes.length !== 1) return false;
  if (input.source === 'plugin-number') return configurePlugin(engineState, input.playerId, engineState.prompt.pluginUid, selected);
  if (input.source === 'script-activation') return activateScript(engineState, input.playerId, engineState.prompt.scriptUid);
  if (input.source === 'response-window') return activateResponse(engineState, input.playerId, selected);
  if (input.source === 'response-target') return activateResponse(engineState, input.playerId, engineState.pending.cardUid, selected);
  if (input.source === 'trigger-order') return resolveTriggerChoice(engineState, selected);
  if (input.source === 'placement') return resolveAccessDragPlacement(engineState, input.playerId, selected.zone, selected.underUid ?? null);
  if (input.source === 'security-rest') {
    if (!restSecurity(engineState, input.playerId, selected)) return false;
    // With nothing left to rest, the turn end carries on instead of asking again with no options.
    const remaining = engineState.players[input.playerId].front
      .some(card => !card.faceDown && !card.sleep && cardHasKeyword(card, 'SECURITY'));
    if (!remaining) endTurn(engineState);
    return true;
  }
  return false;
}
