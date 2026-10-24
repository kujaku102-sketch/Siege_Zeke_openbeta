// A match replay: how it started and every accepted command, enough to play it
// again. Card refs are random per session, so commands keep the card's
// instance id instead and get a fresh ref back when they are replayed.
export const MATCH_RECORD_KIND = 'siege-zeke.replay';
export const MATCH_RECORD_VERSION = 1;

const CARD_REF = /^r:[0-9a-f]{32}$/;
const failure = code => ({ ok: false, error: { code } });

function mapStrings(value, map) {
  if (typeof value === 'string') return map(value);
  if (Array.isArray(value)) return value.map(item => mapStrings(item, map));
  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = mapStrings(item, map);
    return result;
  }
  return value;
}

export function encodeRecordedAction(authority, actorSeat, action) {
  const entries = authority.referenceState.entries.filter(entry => entry.viewerSeat === actorSeat);
  let missing = false;
  const encoded = mapStrings(action, text => {
    if (!CARD_REF.test(text)) return text;
    const entry = entries.find(item => item.cardRef === text);
    if (!entry) { missing = true; return text; }
    return `card:${entry.identity.instanceId}`;
  });
  return missing ? failure('RECORD_UNKNOWN_REF') : { ok: true, value: encoded };
}

export function decodeRecordedAction(authority, actorSeat, encoded) {
  const entries = authority.referenceState.entries.filter(entry => entry.viewerSeat === actorSeat);
  let missing = false;
  const action = mapStrings(encoded, text => {
    if (!text.startsWith('card:')) return text;
    const entry = entries.find(item => item.identity.instanceId === text.slice(5));
    if (!entry) { missing = true; return text; }
    return entry.cardRef;
  });
  return missing ? failure('RECORD_UNKNOWN_CARD') : { ok: true, value: action };
}

// Engine cards carry their instance id; this finds which card an action named.
function definitionOf(engineState, instanceId) {
  const uid = `rt:${instanceId}`;
  const stack = [...Object.values(engineState.players ?? {})];
  while (stack.length) {
    const item = stack.pop();
    if (!item || typeof item !== 'object') continue;
    if (item.uid === uid && typeof item.id === 'string') return item.id;
    for (const value of Object.values(item)) if (value && typeof value === 'object') stack.push(value);
  }
  return null;
}

export function recordedCardDefinition(engineState, encoded) {
  const ref = typeof encoded?.cardRef === 'string' && encoded.cardRef.startsWith('card:') ? encoded.cardRef.slice(5) : null;
  return ref ? definitionOf(engineState, ref) : null;
}

export function createMatchRecord(authority) {
  const { metadata, engineState } = authority;
  const seed = engineState.runtimeContext?.rngState?.seed;
  if (authority.revision !== 0 || !Number.isSafeInteger(seed)) return failure('RECORD_NOT_AT_START');
  return { ok: true, value: {
    kind: MATCH_RECORD_KIND, schemaVersion: MATCH_RECORD_VERSION,
    game: { matchId: metadata.matchId, seatIds: [...metadata.seatIds], seed,
      ruleVersion: metadata.ruleVersion, cardVersion: metadata.cardVersion,
      gameOptions: structuredClone(metadata.startOptions) },
    commands: []
  } };
}

// What happened, without replaying: result, length, decks and which cards were used.
export function summarizeMatchRecord(record, authority, outcome) {
  const { startOptions } = authority.metadata;
  const [first, second] = record.game.seatIds;
  const deck = (recipe, id) => recipe ? { recipe: structuredClone(recipe) } : { deckId: id };
  // Cards a seat put to use (executed, installed, activated...), and how often each attacked.
  const cardsUsed = Object.fromEntries(record.game.seatIds.map(seat => [seat, {}]));
  const attacks = Object.fromEntries(record.game.seatIds.map(seat => [seat, {}]));
  for (const command of record.commands) {
    if (!command.card) continue;
    const tally = (command.action.type === 'attack' ? attacks : cardsUsed)[command.seat];
    tally[command.card] = (tally[command.card] ?? 0) + 1;
  }
  return {
    mode: startOptions.mode,
    finished: authority.engineState.victory?.finished === true,
    outcome,
    turns: authority.engineState.turnNumber,
    commandCount: record.commands.length,
    users: { [first]: startOptions.playerUserId, [second]: startOptions.aiUserId },
    decks: { [first]: deck(startOptions.playerDeckRecipe, startOptions.playerDeckId),
      [second]: deck(startOptions.aiDeckRecipe, startOptions.aiDeckId) },
    cardsUsed,
    attacks
  };
}
