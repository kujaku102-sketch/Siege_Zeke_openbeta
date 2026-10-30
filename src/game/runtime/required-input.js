import { current } from './required-input/pending-input.js';
import { failure } from './required-input/shared.js';

export { prepareRequiredInputAction } from './required-input/prepare.js';
export { applyRequiredInputAction } from './required-input/apply.js';

export function buildRequiredInput(authority, viewerSeat) {
  try {
    const input = current(authority);
    if (!input) return { ok: true, value: null };
    const canAnswer = input.actorSeat === viewerSeat;
    if (!canAnswer) return { ok: true, value: {
      kind: 'waiting', actorSeat: input.actorSeat, canAnswer: false,
      options: [], constraints: { kind: 'waiting' }
    } };
    return { ok: true, value: { ...input.dto, canAnswer: true } };
  } catch {
    return failure('REQUIRED_INPUT_INVALID_STATE');
  }
}
