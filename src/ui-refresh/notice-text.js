import { BLOCK_MESSAGES } from './runtime-read-view.js';

// Player-facing text for the codes that reach the shell notice. A raw code never
// reaches the screen: unknown codes get the generic sentence below.
export const FALLBACK_NOTICE = 'その操作はできません';

// A tap or drop on a spot that is not a valid target is simply ignored.
// A failed effect or scene is logged to the console, not shown as a refused move.
const SILENT = new Set(['INTERACTION_TARGET_NOT_AVAILABLE', 'RUNTIME_DECORATION_FAILED']);

const MESSAGES = {
  ...BLOCK_MESSAGES,
  ACTION_NOT_ALLOWED: FALLBACK_NOTICE,
  AMBIGUOUS_INTERACTION_TARGET: '対象を絞り込めません。もう一度選んでください',
  INVALID_SELECTION: 'その選択はできません',
  // The guide says why (tutorial-mode-controller.js, TUTORIAL_STEP_GUARDS).
  TUTORIAL_CHOICE_NOT_EXPECTED: 'じぐさぽの案内に沿って選んでください',
  MATCH_SESSION_COMMAND_INFLIGHT: BLOCK_MESSAGES.RESOLVING,
  RUNTIME_CLIENT_CONTROLLER_BUSY: BLOCK_MESSAGES.RESOLVING
};

// Returns the sentence to show, or null when nothing should be shown.
export function noticeText(code) {
  if (SILENT.has(code)) return null;
  return Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : FALLBACK_NOTICE;
}
