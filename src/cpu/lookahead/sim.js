// The trusted side of a CPU that tries moves ahead (it is NOT part of any CPU): it holds the real state of the match and hands out
// states the CPU may try moves on. A CPU never gets the real state or a way to reach it; it gets what this module builds.
// (A port of SZbattlefield's src/sim.mjs, with the prior "seen" only: the other side's decklist is not read here, and there is no path that reads it.)
//
//   leanClone(state)            a copy of an engine state without the parts a try never needs (log, events, history)
//   determinize(...)            a copy in which everything the seat cannot see is re-drawn at random:
//                                 the seat's own deck order, the opponent's hand, deck order and face-down cards;
//                               the random generator is re-seeded. The seat's own cards come from its own list minus the cards it can see by the rules (rulebook 4.5:
//                               the controller of a face-down card may look at it, the opponent may not); the other side's from `seenPool`, never the real hidden cards.
//                               A card an effect created is not a deck card and is not subtracted.
//   seenPool                    where the opponent's hidden cards are drawn from: only what the seat could know. The cards of the library that the rules let a deck hold, of the
//                               colours the seat has seen of that side (every colour while it has seen none), each with a weight of 1 plus 4 for each copy the seat has seen, no more
//                               copies of a name than the rules allow (the other user card's same-name rule is public) less the copies the seat has seen.
import { BUILDABLE_CARDS, copyLimit } from '../../game/deck-builder.js';
import { hydrateCard } from '../../game/core/prepare.js';
import { runtimeRng } from '../../game/core/shared.js';
import { createRngState } from '../../game/runtime/rng.js';
import { CARD_LIBRARY, createCardInstance } from '../../data/cards.js';
import { remapReferences } from './references.js';

const now = () => globalThis.performance.now();

// The copy of the engine state used for trying moves: the engine's own copy for history, without the log, the event list and the
// history (SZbattlefield probe/probe.mjs checks: the same move gives the same state, up to the clock-made choice request ids).
export function leanClone(state) {
  const rng = state.rng;
  const copy = structuredClone({ ...state, rng: null, history: [], log: [], events: [] });
  copy.rng = copy.runtimeContext ? runtimeRng(copy.runtimeContext) : rng;
  return copy;
}

// The same copy, made about three times faster: the compiled effect of every card (a read-only structure the engine only reads) is shared
// with the original instead of copied.
const ZONES = ['deck', 'hand', 'front', 'back', 'registry', 'trash', 'ban'];
export function shareClone(state) {
  const saved = [];                       // one entry per card in traversal order: [had a compiled property, its value]
  const walk = (cards, visit) => { for (const card of cards) { visit(card); walk(card.mounted ?? [], visit); } };
  const each = (root, visit) => { for (const holder of ['player', 'ai']) for (const zone of ZONES) walk(root.players[holder][zone], visit); };
  each(state, (card) => { const had = Object.hasOwn(card, 'compiled'); saved.push([had, card.compiled]); if (had) card.compiled = undefined; });
  let copy;
  try { copy = leanClone(state); }
  finally { let i = 0; each(state, (card) => { const [had, value] = saved[i]; i += 1; if (had) card.compiled = value; }); }
  let i = 0;
  each(copy, (card) => { const [had, value] = saved[i]; i += 1; if (had && value !== undefined) card.compiled = value; });
  return copy;
}

// What the seat sees of the cards that came from the decks, by the rules, counted by owner seat and card id (the same cards the query
// shows, plus its own face-down cards, which the rulebook lets their controller look at). A card an effect created has a serial number
// above the deck cards' (the identity ledger numbers the decks first); it is not a deck card, so it is left out.
const serialOf = (card) => { const n = Number(String(card.identity?.instanceId ?? '').slice(2)); return Number.isSafeInteger(n) ? n : 0; };
const HIDDEN_ZONES = ['hand', 'front', 'back', 'registry', 'trash', 'ban'];
export function visibleCounts(state, viewerPlayer, seatIds, deckLimit) {
  const counts = { [seatIds[0]]: {}, [seatIds[1]]: {} };
  const seatOf = { player: seatIds[0], ai: seatIds[1] };
  const count = (card) => { if (serialOf(card) > deckLimit) return; const seat = seatOf[card.owner]; if (seat) counts[seat][card.id] = (counts[seat][card.id] ?? 0) + 1; };
  const walk = (card, visible) => { if (visible) count(card); for (const child of card.mounted ?? []) walk(child, visible); };
  for (const holder of ['player', 'ai']) {
    for (const zone of HIDDEN_ZONES) {
      for (const card of state.players[holder][zone]) {
        const hidden = zone === 'hand' ? holder !== viewerPlayer : card.faceDown === true && holder !== viewerPlayer;
        walk(card, !hidden);
      }
    }
  }
  return counts;
}

// The hidden slots of the viewer's view of a state: the deck always; for the opponent also its hand and its face-down cards
// (on the board, in the registry, in the trash and the ban). The viewer's own face-down cards are not hidden from it.
export function hiddenSlots(state, viewerPlayer, player) {
  const slots = [];
  const holder = state.players[player];
  holder.deck.forEach((_, index) => slots.push({ zone: 'deck', index }));
  if (player !== viewerPlayer) {
    holder.hand.forEach((_, index) => slots.push({ zone: 'hand', index }));
    for (const zone of ['front', 'back', 'registry', 'trash', 'ban']) holder[zone].forEach((card, index) => { if (card.faceDown === true) slots.push({ zone, index }); });
  }
  return slots;
}

// A list of `count` card ids for one side's hidden slots, from what the seat has seen of that side and the rules of deck building (see the head of this file).
const COPY_CAP_UNLIMITED = 6;
export function seenPool(holder, seenCounts, count, rand) {
  const deckRule = holder.user?.deckRule ?? '';
  const sameName = Number(deckRule.match(/同名(\d+)枚/)?.[1] ?? 3);
  const rule = { sameName, sameNameByUser: /同名\d+枚/.test(deckRule) };
  const library = BUILDABLE_CARDS ?? Object.values(CARD_LIBRARY).filter((card) => /^STD-\d{3}$/.test(card.id) && !card.token && !['VOb', 'Plugin'].includes(card.category));
  const limitOf = (card) => { const limit = copyLimit ? copyLimit(card, rule) : sameName; return Number.isFinite(limit) ? limit : COPY_CAP_UNLIMITED; };
  const colours = new Set(Object.keys(seenCounts).map((id) => CARD_LIBRARY[id]?.color).filter(Boolean));
  const entries = [];
  for (const card of library) {
    if (colours.size > 0 && card.color && !colours.has(card.color)) continue;
    const seenCopies = seenCounts[card.id] ?? 0;
    entries.push({ id: card.id, left: Math.max(0, limitOf(card) - seenCopies), weight: 1 + 4 * seenCopies });
  }
  const pool = [];
  let total = entries.reduce((sum, entry) => sum + (entry.left > 0 ? entry.weight : 0), 0);
  for (let n = 0; n < count && total > 0; n += 1) {
    let at = rand() * total;
    for (const entry of entries) {
      if (entry.left <= 0) continue;
      if (at < entry.weight) { pool.push(entry.id); entry.left -= 1; if (entry.left === 0) total -= entry.weight; break; }
      at -= entry.weight;
    }
  }
  return pool;
}

// engine: the real state (read to copy it and to count what the seat sees); ownList: { card id: copies } of the SEAT'S OWN deck (it knows its own list; it is the only list read);
// deckLimit: how many cards the two decks held at the start (read from the identity ledger when the match began, not from any list).
// Returns { state, plan } (plan: per owner, the pool and the slots; used by the checks).
export function determinize(engine, viewerPlayer, seatIds, ownList, deckLimit, rand) {
  const copy = shareClone(engine);
  let simSerial = 0;
  const simCard = (id, owner, ownerSeat) => {
    simSerial += 1;
    return { ...createCardInstance(id, owner, simSerial), uid: `sim:${simSerial}`, ownerSeat };
  };
  const visible = visibleCounts(engine, viewerPlayer, seatIds, deckLimit);
  const owners = [['player', seatIds[0]], ['ai', seatIds[1]]];
  const plan = owners.map(([player, seat]) => {
    const slots = hiddenSlots(copy, viewerPlayer, player);
    let pool = [];
    if (player !== viewerPlayer) {
      // the other side's list is not read; the pool is drawn in the order of the slots, so it is already shuffled
      pool = seenPool(engine.players[player], visible[seat], slots.length, rand);
    } else {
      for (const [id, copies] of Object.entries(ownList)) {
        const left = copies - (visible[seat][id] ?? 0);
        for (let i = 0; i < left; i += 1) pool.push(id);
      }
    }
    return { player, seat, pool, slots };
  });

  // The real cards that are replaced by drawn ones: what the state says about them goes to the drawn card (references.js).
  const replaced = [];
  const forget = (card, fresh) => { replaced.push({ uid: card.uid, id: card.id, name: card.name, fresh }); for (const child of card.mounted ?? []) forget(child, fresh); };
  for (const { player, seat, pool, slots } of plan) {
    for (let i = pool.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const holder = copy.players[player];
    // The seat's own list minus the seen cards does not always explain every hidden slot of its own deck. A slot the pool cannot fill gets a card drawn from its own list.
    // (the other side's pool always has a card for every slot, and no list of it is read: asking for it is an error)
    const drawFromList = player !== viewerPlayer ? () => { throw new Error('lookahead: the other side list was asked for'); } : (() => {
      const list = Object.entries(ownList);
      const listTotal = list.reduce((n, [, copies]) => n + copies, 0);
      return () => { let at = Math.floor(rand() * listTotal); for (const [id, copies] of list) { if (at < copies) return id; at -= copies; } return list[0][0]; };
    })();
    slots.forEach((slot, n) => {
      const real = holder[slot.zone][slot.index];
      const fresh = simCard(pool[n] ?? drawFromList(), player, seat);
      let placed;
      if (slot.zone === 'deck') placed = fresh;
      else if (slot.zone === 'hand') placed = hydrateCard(fresh);
      else if (slot.zone === 'registry' || slot.zone === 'trash' || slot.zone === 'ban') placed = { ...hydrateCard(fresh), faceDown: true };
      else {
        placed = { ...hydrateCard(fresh), faceDown: true, sleep: real.sleep, summoningSick: real.summoningSick,
          residentActive: real.residentActive, layerRole: real.layerRole, slot: real.slot, placementOrder: real.placementOrder };
      }
      holder[slot.zone][slot.index] = placed;
      forget(real, placed);
    });
  }
  if (copy.runtimeContext) {
    copy.runtimeContext.rngState = createRngState({ seed: Math.floor(rand() * 0x100000000) >>> 0 }).value;
    // The engine's table of uid -> card id (factory.js: runtimeContext.uidAliases) has a row for every card of both decks, the hidden ones too. A row of a card that was replaced above
    // would tell the CPU what the real card was (its card id), so those rows go; a drawn card ('sim:N') never had one, and the engine looks a row up only for a card in play.
    const gone = new Set(replaced.map((entry) => entry.uid));
    copy.runtimeContext.uidAliases = copy.runtimeContext.uidAliases.filter((row) => !gone.has(row.uid));
  }
  // The rest of what the state says about a replaced card (a window, a choice waiting, the last event, the turn it came into play) is about the drawn card now.
  remapReferences(copy, replaced);
  // The engine state also names each side's start deck (setup.js: playerDeckId, aiDeckId). The other side's is its whole list; it is set to the game's default id, which says nothing.
  const otherSide = viewerPlayer === 'player' ? 'ai' : 'player';
  copy[`${otherSide}DeckId`] = otherSide === 'player' ? 'red' : 'yellow';
  return { state: copy, plan };
}

export { now };
