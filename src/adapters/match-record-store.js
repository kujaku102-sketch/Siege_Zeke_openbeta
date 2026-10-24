import { MATCH_RECORD_KIND } from '../game/runtime/match-record.js';
import { MATCH_LOG_KIND } from './match-log.js';

// Replays and match logs kept in this browser only, newest first.
const REPLAY_STORAGE_KEY = 'sz-replays';
const MATCH_LOG_STORAGE_KEY = 'sz-match-logs';
export const MAX_STORED_MATCHES = 20;

const shelf = (key, kind) => ({ key, kind });
export const REPLAYS = shelf(REPLAY_STORAGE_KEY, MATCH_RECORD_KIND);
export const MATCH_LOGS = shelf(MATCH_LOG_STORAGE_KEY, MATCH_LOG_KIND);
const matchIdOf = item => item.game?.matchId ?? item.matchId;

export function loadStored(storage, { key, kind }) {
  try {
    const items = JSON.parse(storage.getItem(key) ?? '[]');
    return Array.isArray(items) ? items.filter(item => item?.kind === kind) : [];
  } catch { return []; }
}

// One entry per match; when storage is full the oldest entries give way.
export function saveStored(storage, place, item) {
  if (item?.kind !== place.kind) return false;
  let items = [item, ...loadStored(storage, place).filter(other => matchIdOf(other) !== matchIdOf(item))].slice(0, MAX_STORED_MATCHES);
  while (items.length) {
    try { storage.setItem(place.key, JSON.stringify(items)); return true; }
    catch { items = items.slice(0, -1); }
  }
  return false;
}

export function storedExport(place, items) {
  return JSON.stringify({ kind: `${place.kind}s`, items }, null, 2);
}
