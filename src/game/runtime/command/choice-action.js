import { prepareRequiredInputAction } from '../required-input.js';
import { prepared, reject } from './common.js';

export const CHOICE_ACTIONS = new Set(['answerChoice', 'declineChoice']);

export function prepareChoiceAction({ authority, trusted, canonical }) {
  const result = prepareRequiredInputAction(authority, trusted.actorSeat, canonical.value.command.action);
  if (!result.ok) reject(result.error.code);
  return prepared(canonical, result.value);
}
