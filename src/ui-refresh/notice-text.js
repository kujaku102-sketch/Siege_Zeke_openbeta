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
  RUNTIME_CLIENT_CONTROLLER_BUSY: BLOCK_MESSAGES.RESOLVING,
  // Online play (remote-session.js): the room did not answer, the line is down, or the move crossed a newer state.
  REMOTE_TIMEOUT: 'サーバーの応答がありません。もう一度試してください',
  REMOTE_DISCONNECTED: '接続が切れています。再接続を待ってください',
  STALE_REVISION: '盤面が更新されました。もう一度選んでください',
  MATCH_UI_PLAN_STALE: '盤面が更新されました。もう一度選んでください',
  COPY_FAILED: 'コピーできませんでした。コードを書き写してください'
};

// Returns the sentence to show, or null when nothing should be shown.
export function noticeText(code) {
  if (SILENT.has(code)) return null;
  return Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : FALLBACK_NOTICE;
}
