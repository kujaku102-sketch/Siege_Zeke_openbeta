import { DECK_OPTIONS } from '../game/engine.js';
import { CARD_LIBRARY, USER_CARDS } from '../data/cards.js';
import { runtimeLogRows } from '../ui-refresh/runtime-log-view.js';

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
export function buildMatchLog(replay, events, now = new Date()) {
  const { game, summary } = replay;
  const [you, opponent] = game.seatIds;
  const options = game.gameOptions;
  const player = (seat, userId, recipe, deckId) => ({ seat,
    user: { id: userId, name: USER_CARDS[userId]?.name ?? userId }, deck: deckOf(recipe, deckId) });
  const winner = summary.outcome?.kind === 'win' ? summary.outcome.winnerSeat === you ? 'you' : 'opponent' : null;
  return {
    kind: MATCH_LOG_KIND, schemaVersion: MATCH_LOG_VERSION,
    matchId: game.matchId, endedAt: now.toISOString(),
    ruleVersion: game.ruleVersion, cardVersion: game.cardVersion,
    mode: options.mode, finished: summary.finished,
    result: summary.outcome?.kind === 'draw' ? 'draw' : winner ?? 'none', turns: summary.turns,
    players: {
      you: player(you, options.playerUserId, options.playerDeckRecipe, options.playerDeckId),
      opponent: player(opponent, options.aiUserId, options.aiDeckRecipe, options.aiDeckId)
    },
    log: runtimeLogRows(events, you)
  };
}
