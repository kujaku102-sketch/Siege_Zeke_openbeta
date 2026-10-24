import { buildMatchLog } from './match-log.js';
import { MATCH_LOGS, REPLAYS, saveStored } from './match-record-store.js';

// What happens to a match as it is left: its replay and its log are kept in this
// browser, and a finished match's log is sent when the player switched sending on.
export function archiveRetiredMatch(session, { storage, sendEnabled = false, send = null, now = new Date() }) {
  const replay = session?.matchRecord?.();
  if (!replay?.ok || !replay.value.commands.length) return { kept: false, sent: false };
  saveStored(storage, REPLAYS, { ...replay.value, savedAt: now.toISOString() });
  const viewer = replay.value.game.seatIds[0];
  const feed = session.port(viewer).value?.events({ afterEventId: null });
  if (!feed?.ok) return { kept: true, sent: false };
  const log = buildMatchLog(replay.value, feed.value.events, now);
  saveStored(storage, MATCH_LOGS, log);
  const sent = Boolean(sendEnabled && replay.value.summary.finished && send?.(log));
  return { kept: true, sent };
}
