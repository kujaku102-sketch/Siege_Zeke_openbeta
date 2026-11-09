import { buildMatchLog } from './match-log.js';
import { MATCH_LOGS, REPLAYS, saveStored } from './match-record-store.js';

// What happens to a match as it is left: its replay and its log are kept in this
// browser, and a finished match's log is sent when the player switched sending on.
// cpu: the match's CPU timing (src/cpu createCpu().stats()), put in its log when it is this match's.
export function archiveRetiredMatch(session, { storage, sendEnabled = false, send = null, now = new Date(), cpu = null }) {
  const replay = session?.matchRecord?.();
  // A match begun from a stored point (the skipped tutorial) is kept and sent once finished, even with no command played.
  const worth = replay?.ok && (replay.value.commands.length > 0 || Object.hasOwn(replay.value, 'startedFrom') && replay.value.summary.finished);
  if (!worth) return { kept: false, sent: false };
  saveStored(storage, REPLAYS, { ...replay.value, savedAt: now.toISOString() });
  const viewer = replay.value.viewerSeat ?? replay.value.game.seatIds[0];
  const feed = session.port(viewer).value?.events({ afterEventId: null });
  if (!feed?.ok) return { kept: true, sent: false };
  const log = buildMatchLog(cpu && cpu.matchId === replay.value.game.matchId ? { ...replay.value, cpu } : replay.value, feed.value.events, now);
  saveStored(storage, MATCH_LOGS, log);
  const sent = Boolean(sendEnabled && replay.value.summary.finished && send?.(log));
  return { kept: true, sent };
}
