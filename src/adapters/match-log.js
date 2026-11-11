import { DECK_OPTIONS } from '../game/engine.js';
import { CARD_LIBRARY, USER_CARDS } from '../data/cards.js';
import { runtimeLogRows } from '../ui-refresh/runtime-log-rows.js';

// A finished match as people read it: the battle log as the player saw it, plus who
// played which deck. It is what gets sent when sending is switched on.
export const MATCH_LOG_KIND = 'siege-zeke.match-log';
const MATCH_LOG_VERSION = 1;

function deckOf(recipe, deckId) {
  const rows = recipe ?? DECK_OPTIONS[deckId]?.recipe ?? [];
  return { name: recipe ? 'カスタム' : DECK_OPTIONS[deckId]?.label ?? deckId,
    cards: rows.map(([id, count]) => ({ id, name: CARD_LIBRARY[id]?.name ?? id, count })) };
}

// replay: a session's replay record (its game and summary); events: the viewer's event feed.
// The viewer is the seat whose feed `events` is: replay.viewerSeat (an online match is seen from either seat), else the first seat.
export function buildMatchLog(replay, events, now = new Date()) {
  const { game, summary } = replay;
  const you = game.seatIds.includes(replay.viewerSeat) ? replay.viewerSeat : game.seatIds[0];
  const opponent = game.seatIds.find(seat => seat !== you);
  const options = game.gameOptions;
  // The first seat plays the options' player side, the second the ai side (also in a match between two people).
  const side = seat => game.seatIds.indexOf(seat) === 0
    ? { userId: options.playerUserId, recipe: options.playerDeckRecipe, deckId: options.playerDeckId }
    : { userId: options.aiUserId, recipe: options.aiDeckRecipe, deckId: options.aiDeckId };
  const player = seat => { const { userId, recipe, deckId } = side(seat);
    return { seat, user: { id: userId, name: USER_CARDS[userId]?.name ?? userId }, deck: deckOf(recipe, deckId) }; };
  const winner = summary.outcome?.kind === 'win' ? summary.outcome.winnerSeat === you ? 'you' : 'opponent' : null;
  return {
    kind: MATCH_LOG_KIND, schemaVersion: MATCH_LOG_VERSION,
    matchId: game.matchId, endedAt: now.toISOString(),
    ruleVersion: game.ruleVersion, cardVersion: game.cardVersion,
    mode: options.mode === 'versus' ? 'online' : options.mode, finished: summary.finished,
    ...(replay.startedFrom ? { startedFrom: structuredClone(replay.startedFrom) } : {}),
    result: summary.outcome?.kind === 'draw' ? 'draw' : winner ?? 'none', turns: summary.turns,
    players: {
      you: player(you),
      opponent: player(opponent)
    },
    log: runtimeLogRows(events, you),
    // The opponent CPU of a CPU match (replay.cpu: createCpu().stats()): the one chosen, the time each one that played
    // took per decision (ms), and any switch to a lighter one. Phones' real numbers come from here.
    ...(replay.cpu ? { cpu: { chosen: replay.cpu.chosen, played: (replay.cpu.played ?? []).map(({ id, n, median, p95, max }) => ({ id, n, median, p95, max })), switches: structuredClone(replay.cpu.switches ?? []) } } : {})
  };
}
