// The trusted side of a CPU that looks ahead (see sim.js). The session holds the real match; for one decision of one seat it opens a `decision` and gives the CPU only that:
// (A port of SZbattlefield's src/sim-host.mjs; the same names, the same moves, the same draws.)
//
//   decision.me          'player' | 'ai': the seat's side in the engine states below
//   decision.moves       the seat's moves: [{ id, type, uids, zone, targetKind }]  (moves.js; the real engine calls and actions stay on this side)
//   decision.unsupported the types of candidates that have no engine call yet (so nothing is silently dropped)
//   decision.samples     how many re-drawn states there are
//   decision.now(k)      re-drawn state k: what the seat cannot see is re-drawn (sim.js); read it, do not keep it
//   decision.after(id,k) a copy of re-drawn state k with move `id` applied, or null if the engine refuses it
//   decision.branch(state, who)  the moves of 'me' or 'opp' on any state this decision handed out (a result of after() or branch().after()): { moves, after(id) }. This is how a CPU
//                        reads further than one move; the states are all re-drawn ones, nothing of the real match is in them.
//   decision.intent(id)  the runtime intent for move `id`, to be returned from choose()
//   decision.elapsedMs() time since the decision was opened
//
// A state is handed out as a view of it (see \`showing\` below): the cards of both sides' zones, the STR and memory, whose turn it is, who has won. The rest of the engine state (windows,
// choices waiting, events, texts) stays on this side: it is what the engine tries a move on, and a CPU that reads ahead has no use for it.
//
// Nothing here gives a CPU the real engine state, the authority, the opponent's hidden cards or the means to reach them.
import { applyPreparedRuntimeAction } from '../../game/runtime/transaction-actions.js';
import { createPlanningContext } from '../../game/runtime/planning-context.js';
import { hydrateCard } from '../../game/core/prepare.js';
import { DECK_OPTIONS } from '../../game/core/setup.js';
import { catalog as moveCatalog, engineContext, entriesOf } from './candidates.js';
import { expand } from './moves.js';
import { determinize, shareClone } from './sim.js';

const now = () => globalThis.performance.now();
const mulberry32 = (seed) => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = Math.imul(seed ^ (seed >>> 15), seed | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hashOf = (text) => { let h = 2166136261; for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

// The list of the SEAT'S OWN deck: its recipe of [card id, copies] pairs, or the recipe of its deck id (the same way the game builds the deck: setup.js). The other side's deck is never
// looked up: this is the only place a decklist is read.
function ownDeckList(startOptions, me) {
  const recipe = me === 'player' ? startOptions.playerDeckRecipe : startOptions.aiDeckRecipe;
  const id = me === 'player' ? startOptions.playerDeckId : startOptions.aiDeckId;
  return Object.fromEntries(recipe ?? (DECK_OPTIONS[id] ?? (me === 'player' ? DECK_OPTIONS.red : DECK_OPTIONS.yellow)).recipe);
}

// A state, as a CPU is handed it: the cards of both sides' zones (with their STR and memory), whose turn it is, who has won. It is a view; the engine state it shows stays here.
const shown = new WeakMap();
const showing = (state) => {
  const view = Object.freeze({ players: state.players, winner: state.winner, active: state.active, turnNumber: state.turnNumber, phase: state.phase, firstPlayer: state.firstPlayer, mode: state.mode });
  shown.set(view, state);
  return view;
};
// the engine state behind a view this decision handed out (a state that is not one is an error: a CPU cannot make a state of its own to try moves on)
const stateOf = (view) => {
  const state = shown.get(view);
  if (!state) throw new Error('lookahead: not a state of this decision');
  return state;
};
// for the tests of this folder: the state behind a view
export const engineStateBehind = stateOf;

// authority: the real match (never handed out); seat: the deciding seat; samples: how many re-drawn states to offer;
// deckLimit: how many cards the two decks held when the match began (the identity ledger numbers them first), given by the coordinator that holds the match.
export function open({ authority, seat, deckLimit, samples = 4 }) {
  if (!Number.isSafeInteger(deckLimit) || deckLimit < 0) throw new Error('lookahead: deckLimit is the number of cards the decks held at the start');
  const started = now();
  const engine = authority.engineState;
  const metadata = authority.metadata;
  const seatIds = metadata.seatIds;
  const me = seat === seatIds[0] ? 'player' : 'ai';
  const ownList = ownDeckList(metadata.startOptions, me);
  const rand = mulberry32(hashOf(`${metadata.matchId}|${authority.revision}|${seat}`));
  const states = [];
  const sample = (k) => states[k] ??= determinize(engine, me, seatIds, ownList, deckLimit, rand).state;
  const sampleViews = [];
  const sampleView = (k) => sampleViews[k] ??= showing(sample(k));
  // The engine's own checks (can this card be played here?) may write to the state they are given (a log line, a message), so moves are
  // found on a copy of the first re-drawn state (the set is the same as on the real state), never on the real match.
  const planned = shareClone(sample(0));
  const context = engineContext(planned, metadata, seat);
  const entries = context.allowed ? moveCatalog(planned, metadata, seat) : [];
  const expanded = expand(context, entries);
  // Moves that differ only in which free slot of a zone they take are the same move for a CPU that looks one move ahead: one of each is kept.
  const seen = new Set();
  const moves = expanded.moves.filter((move) => {
    const key = [move.type, [...move.uids].sort().join(','), move.action.destination?.zone ?? '', move.action.target?.kind ?? ''].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((move, id) => ({ ...move, id }));
  const unsupported = expanded.unsupported;

  // The runtime's names for cards (needed only to submit the chosen move), built once and only when a move is chosen.
  let rename = null;
  const renamer = () => {
    if (rename) return rename;
    const runtime = createPlanningContext(authority, seat);
    const refs = new Map();
    for (const { card } of entriesOf(engine, seatIds).values()) { const ref = runtime.refFor(card); if (ref) refs.set(card.uid, ref); }
    const walk = (value) => typeof value === 'string' ? (refs.get(value) ?? value)
      : Array.isArray(value) ? value.map(walk) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)])) : value;
    return (rename = walk);
  };

  const apply = (copy, move) => {
    const result = applyPreparedRuntimeAction(copy, move.adapter, { metadata, referenceState: authority.referenceState });
    return result.ok && ['applied-complete', 'applied-awaiting-input'].includes(result.value.kind) ? copy : null;
  };

  return {
    me,
    // zone (where a card goes) and targetKind (what an attack goes for) are public parts of the move; the action itself stays on this side
    moves: moves.map(({ id, type, uids, action }) => ({ id, type, uids, zone: action.destination?.zone ?? null, targetKind: action.target?.kind ?? null })),
    unsupported,
    samples,
    now: (k) => sampleView(k),
    after(id, k) {
      const move = moves[id];
      const done = move ? apply(shareClone(sample(k)), move) : null;
      return done === null ? null : showing(done);
    },
    // the moves of one side on a state of this decision (a re-drawn one, or one reached from it by moves). Nothing is offered when it is not that side's turn or a choice is open.
    branch(shown, who) {
      const state = stateOf(shown);
      const seatFor = who === 'me' ? seat : seatIds[seatIds[0] === seat ? 1 : 0];
      // a card drawn from a re-drawn deck has no compiled effect yet (the deck cards are not hydrated): the cards in hand get it before their moves are looked for
      for (const holder of ['player', 'ai']) { const cards = state.players[holder].hand; cards.forEach((card, index) => { if (!card.compiled) cards[index] = hydrateCard(card); }); }
      const planned = shareClone(state);
      const ctx = engineContext(planned, metadata, seatFor);
      const found = ctx.allowed ? moveCatalog(planned, metadata, seatFor) : [];
      const expandedHere = expand(ctx, found);
      const seenHere = new Set();
      const list = expandedHere.moves.filter((move) => {
        const key = [move.type, [...move.uids].sort().join(','), move.action.destination?.zone ?? '', move.action.target?.kind ?? ''].join('|');
        if (seenHere.has(key)) return false;
        seenHere.add(key);
        return true;
      }).map((move, id) => ({ ...move, id }));
      return {
        moves: list.map(({ id, type, uids, action }) => ({ id, type, uids, zone: action.destination?.zone ?? null, targetKind: action.target?.kind ?? null })),
        after(id) {
          const move = list[id];
          const done = move ? apply(shareClone(state), move) : null;
          return done === null ? null : showing(done);
        }
      };
    },
    intent(id, { commandId, expectedRevision }) {
      const move = moves[id];
      if (!move) return null;
      return { commandId, expectedRevision, action: renamer()(move.action) };
    },
    elapsedMs: () => now() - started
  };
}
