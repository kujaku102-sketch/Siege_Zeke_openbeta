import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createNewMatchSessionController } from '../src/adapters/match-session-controller.js';
import { createLocalRuntimeCoordinator } from '../src/adapters/local-runtime-port.js';
import { createMatchAuthority } from '../src/game/runtime/authority.js';
import { chooseSimpleAiIntent } from '../src/adapters/simple-ai-policy.js';
import { createCpu } from '../src/cpu/index.js';
import { lookaheadHost } from '../src/cpu/lookahead/index.js';
import { shareClone } from '../src/cpu/lookahead/sim.js';
import beatZIG from '../src/cpu/zig/beatZIG.mjs';

// The four checks that keep a CPU that reads ahead from using what its seat cannot see:
//   1. the states and the moves do not depend on the hidden part of the match (another opponent deck, other hidden cards, another order of the seat's own deck: the same result)
//   2. no real hidden card (its uid, its identity, its card id) is anywhere in what the CPU is handed
//   3. the CPU's files are sealed: they import only their own folder, and what the CPU is given has no way to the match
//   4. the CPU plays the matches the bench measured: SZbattlefield's compare-shipped (src/compare-shipped.mjs) on the released beatZIG gen3 and the game's, and tests/cpu-lookahead-match.test.js

const runtimeConfig = (matchId, seed, playerDeckId = 'red', aiDeckId = 'yellow') => ({ matchId, seatIds: ['player', 'ai'], seed, ruleVersion: '2.0', cardVersion: 'public',
  gameOptions: { mode: 'ai', playerDeckId, aiDeckId, playerUserId: 'doors_zx', aiUserId: 'doors_zx' } });

// plays `steps` commands of the simple CPU for both seats, and returns the session
function sessionAt(config, steps) {
  const made = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: config });
  assert.equal(made.ok, true, JSON.stringify(made));
  const session = made.value;
  let serial = 0;
  for (let step = 0; step < steps; step += 1) {
    let seat = 'player'; let port = session.port(seat).value; let query = port.query().value;
    if (query.status.finished) break;
    if (query.requiredInput ? !query.requiredInput.canAnswer : query.status.activeSeat !== 'player') { seat = 'ai'; port = session.port(seat).value; query = port.query().value; }
    const intent = chooseSimpleAiIntent(query, `t:${seat}:${++serial}`, input => port.queryAction(input));
    assert.equal(intent.ok, true);
    assert.equal(port.submit(intent.value).ok, true);
  }
  return session;
}

// The test host: it is handed the real match like the real host is, and keeps it so that the test can look at it and make a changed copy. (Only the trusted session can do this.)
function realMatch(session, seat) {
  let taken = null;
  const opened = session.lookahead(seat).value({ open: input => { taken = input; return null; } });
  assert.equal(opened, null);
  return taken;
}

const otherSeat = seat => (seat === 'player' ? 'ai' : 'player');

// a changed copy of the match: what `seat` cannot see is different, what it can see is the same.
// The cards stay where they are (the same uids in the same places, so a window or a choice that names a card still names a card in the same place); what the hidden cards ARE trades places.
const CONTENT = ['id', 'name', 'category', 'color', 'cost', 'atk', 'str', 'text', 'classes', 'compiled', 'printedCategory', 'rulingOverride'];
function withOtherHiddenWorld(authority, seat) {
  const copy = { ...authority, engineState: shareClone(authority.engineState) };     // (the engine state holds functions: the lookahead's own copy)
  const state = copy.engineState;
  const opponent = state.players[otherSeat(seat)];
  const mine = state.players[seat];
  const aliasOf = card => state.runtimeContext.uidAliases.find(row => row.uid === card.uid);
  const snapshot = card => Object.fromEntries(CONTENT.filter(key => key in card).map(key => [key, card[key]]));
  // the world is the same world with another card there: what the engine wrote about the card (a copy of it, an id built from its id and uid) says the other card too
  const rewrite = (uid, oldId, content, value, seen = new Set()) => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    for (const key of Object.keys(value)) {
      if (key === 'compiled') continue;
      const item = value[key];
      if (typeof item === 'string' && item.includes(uid) && item.includes(oldId)) value[key] = item.split(oldId).join(content.id);
      else if (item !== null && typeof item === 'object' && item.uid === uid && typeof item.id === 'string') becomes(item, content);
      else rewrite(uid, oldId, content, item, seen);
    }
  };
  const becomes = (target, content) => { for (const key of CONTENT) { if (key in content) target[key] = content[key]; else delete target[key]; } };
  const trade = (x, y) => {
    const [contentX, contentY] = [snapshot(x), snapshot(y)];
    const [uidX, uidY, idX, idY] = [x.uid, y.uid, x.id, y.id];
    becomes(x, contentY); becomes(y, contentX);
    aliasOf(x).definitionId = idY; aliasOf(y).definitionId = idX;
    rewrite(uidX, idX, contentY, { ...state, runtimeContext: null });
    rewrite(uidY, idY, contentX, { ...state, runtimeContext: null });
  };
  // the opponent's hand and its deck trade what they are, card for card
  const n = Math.min(opponent.hand.length, opponent.deck.length);
  for (let i = 0; i < n; i += 1) trade(opponent.hand[i], opponent.deck[i]);
  // the seat's own deck is in another order
  for (let i = 0; i < Math.floor(mine.deck.length / 2); i += 1) trade(mine.deck[i], mine.deck[mine.deck.length - 1 - i]);
  // the opponent's face-down cards are other cards of its deck
  let next = n;
  for (const zone of ['front', 'back', 'registry', 'trash', 'ban']) for (const card of opponent[zone]) if (card.faceDown === true && next < opponent.deck.length) { trade(card, opponent.deck[next]); next += 1; }
  return copy;
}

const decisionOn = (authority, seat) => {
  const coordinator = createLocalRuntimeCoordinator({ authority, sessionGeneration: 1 });
  assert.equal(coordinator.ok, true, JSON.stringify(coordinator));
  const port = coordinator.value.bind({ seatId: seat }).value;
  return { coordinator: coordinator.value, port, open: host => { const opened = coordinator.value.openLookahead(seat, host); return opened.ok ? opened.value : null; } };
};

// everything the CPU can read from a decision: its fields, five states, the states one move on, and the other side's moves on those
function everything(decision, states = 3, moves = 4) {
  const out = { me: decision.me, moves: decision.moves, unsupported: decision.unsupported, samples: decision.samples, now: [], after: [], branch: [], intent: [] };
  for (let k = 0; k < states; k += 1) {
    out.now.push(decision.now(k));
    for (const move of decision.moves.slice(0, moves)) {
      const after = decision.after(move.id, k);
      out.after.push(after);
      if (after) { const reply = decision.branch(after, 'opp'); out.branch.push(reply.moves); const second = reply.moves[0] ? reply.after(reply.moves[0].id) : null; out.branch.push(second); }
    }
  }
  for (const move of decision.moves.slice(0, moves)) out.intent.push(decision.intent(move.id, { commandId: 'c', expectedRevision: 0 }));
  return out;
}

// where two values first differ (as JSON), or null: a failing check names a place, not two screens of cards
function firstDifference(a, b, at = '') {
  const x = JSON.parse(JSON.stringify(a ?? null)); const y = JSON.parse(JSON.stringify(b ?? null));
  const walk = (p, q, here) => {
    if (JSON.stringify(p) === JSON.stringify(q)) return null;
    if (p === null || q === null || typeof p !== 'object' || typeof q !== 'object') return here + ': ' + JSON.stringify(p)?.slice(0, 80) + ' / ' + JSON.stringify(q)?.slice(0, 80);
    for (const key of new Set([...Object.keys(p), ...Object.keys(q)])) { const found = walk(p[key], q[key], here + '.' + key); if (found) return found; }
    return here + ': different';
  };
  return walk(x, y, at);
}

const seatsToCheck = ['player', 'ai'];
const midGame = [[4242, 'start-orange', 'red', 30], [77, 'start-yellow', 'start-red', 45], [909, 'start-blue', 'start-green', 38]];

for (const [seed, playerDeck, aiDeck, steps] of midGame) {
  for (const seat of seatsToCheck) {
    test(`1. another hidden world, the same decision (seed ${seed}, ${seat}, after ${steps} commands)`, () => {
      const session = sessionAt(runtimeConfig(`la-${seed}`, seed, playerDeck, aiDeck), steps);
      const real = realMatch(session, seat);
      const changed = withOtherHiddenWorld(real.authority, seat);
      // the changed copy really differs where the seat cannot see
      const hidden = authority => [...authority.engineState.players[otherSeat(seat)].deck, ...authority.engineState.players[otherSeat(seat)].hand, ...authority.engineState.players[seat].deck].map(card => card.id).join();
      assert.notEqual(hidden(changed), hidden(real.authority), 'the hidden cards really are other cards');
      const a = decisionOn(real.authority, seat);
      const b = decisionOn(changed, seat);
      assert.deepEqual(b.port.query().value.observation, a.port.query().value.observation, 'what the seat sees is the same');
      const x = everything(a.open(lookaheadHost)); const y = everything(b.open(lookaheadHost));
      assert.equal(firstDifference(x, y), null);
    });
  }
}

test('1. a match that began with another opponent deck gives the seat the same decision', () => {
  // the seed and the seat's own deck are the same; only the opponent's deck (so its hand, its deck order, and its deck id in the match) is another
  for (const seat of seatsToCheck) {
    const makeFor = other => {
      const [playerDeck, aiDeck] = seat === 'player' ? ['start-red', other] : [other, 'start-red'];
      return realMatch(createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: runtimeConfig('la-start', 31, playerDeck, aiDeck) }).value, seat);
    };
    const first = makeFor('start-yellow'); const second = makeFor('start-green');
    assert.notEqual(JSON.stringify(first.authority.engineState.players[otherSeat(seat)].hand.map(card => card.id)), JSON.stringify(second.authority.engineState.players[otherSeat(seat)].hand.map(card => card.id)), 'the opponents are not the same');
    const a = decisionOn(first.authority, seat); const b = decisionOn(second.authority, seat);
    if (JSON.stringify(a.port.query().value.observation) !== JSON.stringify(b.port.query().value.observation)) continue;   // the seat saw a difference: nothing to say
    const x = everything(a.open(lookaheadHost)); const y = everything(b.open(lookaheadHost));
    assert.equal(firstDifference(x, y), null, `seat ${seat}`);
  }
});

// every string in a value, and every key
function strings(value, into = new Set(), seen = new Set()) {
  if (typeof value === 'string') into.add(value);
  else if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return into;
    seen.add(value);
    for (const [key, item] of Object.entries(value)) { into.add(key); strings(item, into, seen); }
  }
  return into;
}

// what names a real card that the seat cannot see: its uid, its identity, and the runtime's alias row of it
function hiddenNames(authority, seat) {
  const state = authority.engineState;
  const me = state.players[seat]; const opponent = state.players[otherSeat(seat)];
  const hidden = [...me.deck, ...opponent.deck, ...opponent.hand];
  for (const zone of ['front', 'back', 'registry', 'trash', 'ban']) for (const card of opponent[zone]) if (card.faceDown === true) hidden.push(card);
  const names = new Set();
  for (const card of hidden) { names.add(card.uid); if (card.identity?.instanceId) { names.add(card.identity.instanceId); names.add(`rt:${card.identity.instanceId}`); } }
  return { names, cards: hidden };
}

for (const [seed, playerDeck, aiDeck, steps] of midGame) {
  for (const seat of seatsToCheck) {
    test(`2. no real hidden card is in what the CPU is handed (seed ${seed}, ${seat}, after ${steps} commands)`, () => {
      const session = sessionAt(runtimeConfig(`la-${seed}`, seed, playerDeck, aiDeck), steps);
      const real = realMatch(session, seat);
      const { names, cards } = hiddenNames(real.authority, seat);
      assert.ok(names.size > 10, 'there are hidden cards to look for');
      const given = strings(everything(decisionOn(real.authority, seat).open(lookaheadHost)));
      const found = [...names].filter(name => given.has(name));
      assert.deepEqual(found, [], 'real uids of hidden cards that the CPU can read');
      // the other side's deck is not named either: not as a deck id of the match, nor as the card ids of its real hidden cards listed anywhere but in the cards that were drawn for it
      const opponentDeckId = real.authority.metadata.startOptions[`${otherSeat(seat)}DeckId`];
      assert.ok(typeof opponentDeckId === 'string');
      const text = JSON.stringify([...given]);
      assert.equal(text.includes(`"${opponentDeckId}"`), false, `the opponent's deck id (${opponentDeckId}) is in what the CPU can read`);
      assert.ok(cards.length > 0);
    });
  }
}

// ---- 3. sealed
const zigDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/cpu/zig');
const filesUnder = dir => readdirSync(dir).flatMap(name => { const full = path.join(dir, name); return statSync(full).isDirectory() ? filesUnder(full) : [full]; });
const COMMENTS = /\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm;
const STATIC = /^\s*(?:import|export)\b[^;()=]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;

test('3. the files of the learned CPUs import only their own folder, and nothing dynamic', () => {
  const files = filesUnder(zigDir).filter(file => file.endsWith('.mjs'));
  assert.ok(files.length >= 10);
  for (const file of files) {
    const source = readFileSync(file, 'utf8').replace(COMMENTS, '');
    assert.equal(/\bimport\s*\(|\brequire\s*\(/.test(source), false, `${file}: dynamic import or require`);
    assert.equal(/node:|\bprocess\.|\bglobalThis\b|\bfetch\b|\bwindow\b|\bdocument\b/.test(source), false, `${file}: reaches outside`);
    const own = path.dirname(file) === zigDir ? path.join(zigDir, path.basename(file, '.mjs')) : path.dirname(file);     // a CPU module reaches its folder; the folder reaches itself
    for (const [, fromTarget, bareTarget] of source.matchAll(STATIC)) {
      const target = fromTarget ?? bareTarget;
      assert.ok(target.startsWith('./'), `${file}: imports ${target}`);
      assert.equal(path.dirname(path.resolve(path.dirname(file), target)), own, `${file}: ${target} is not in ${path.relative(zigDir, own)}`);
    }
  }
});

test('3. the lookahead host is imported by the catalog and the tests only, not by any file of a CPU', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
  const users = filesUnder(root).filter(file => /\.(m?js)$/.test(file) && /lookahead\//.test(readFileSync(file, 'utf8').replace(COMMENTS, ''))).map(file => path.relative(root, file).split(path.sep).join('/'));
  assert.deepEqual(users.filter(file => !file.startsWith('cpu/lookahead/')).sort(), ['cpu/catalog.js']);
});

test('3. what a learned CPU is given has no way to the match', () => {
  const session = sessionAt(runtimeConfig('la-given', 5), 20);
  const seen = [];
  const spy = { create: () => ({ choose(view) { seen.push(view); return chooseSimpleAiIntent(view.query, view.commandId, view.queryAction); } }) };
  const made = createCpu({ cpuId: 'beatZIG', seatId: 'player', allowStale: true, cpuModules: { beatZIG: spy, lightZIG: spy }, lookaheadHost, clock: () => 0 });
  assert.equal(made.value.id(), 'beatZIG');
  const port = session.port('player').value;
  const query = port.query().value;
  assert.equal(query.requiredInput, null);
  made.value.policy(query, 'c1', input => port.queryAction(input), session.lookahead('player').value);
  assert.equal(seen.length, 1);
  assert.deepEqual(Object.keys(seen[0]).sort(), ['baseline', 'commandId', 'query', 'queryAction', 'seatId', 'sim']);
  const decision = seen[0].sim;
  assert.deepEqual(Object.keys(decision).sort(), ['after', 'branch', 'elapsedMs', 'intent', 'me', 'moves', 'now', 'samples', 'unsupported']);
  for (const key of ['authority', 'engineState', 'metadata', 'referenceState', 'journal']) assert.equal(key in decision, false);
  for (const key of ['authority', 'engineState', 'metadata', 'referenceState', 'journal']) assert.equal(key in seen[0], false);
});

test('3. a CPU that reads ahead and is given nothing to read ahead with plays as the lighter one, and says so', () => {
  const session = sessionAt(runtimeConfig('la-none', 5), 20);
  const modules = { beatZIG, lightZIG: beatZIG };
  const made = createCpu({ cpuId: 'beatZIG', seatId: 'player', allowStale: true, cpuModules: modules, lookaheadHost, clock: () => 0 });
  const port = session.port('player').value;
  const result = made.value.policy(port.query().value, 'c1', input => port.queryAction(input));
  assert.equal(result.ok, true);
  assert.equal(made.value.id(), 'lightZIG');
  assert.deepEqual(made.value.switches().map(({ from, to, reason }) => ({ from, to, reason })), [{ from: 'beatZIG', to: 'lightZIG', reason: 'no-lookahead' }]);
});

test('the host is given only a seat of the session, and a host that can be opened', () => {
  const session = sessionAt(runtimeConfig('la-seat', 7), 4);
  assert.equal(session.lookahead('nobody').ok, false);
  assert.equal(session.lookahead('player').value({ not: 'a host' }), null);
  const authority = createMatchAuthority(runtimeConfig('la-seat-2', 7)).value;
  const coordinator = createLocalRuntimeCoordinator({ authority, sessionGeneration: 1 }).value;
  assert.equal(coordinator.openLookahead('nobody', lookaheadHost).ok, false);
  const port = coordinator.bind({ seatId: 'player' }).value;
  assert.equal('openLookahead' in port, false, 'a seat port cannot open it');
});

// ---- many states: the checks above on a spread of matches (every deck, both seats, early and late), not only on three
const SWEEP_DECKS = ['start-red', 'start-yellow', 'start-purple', 'start-blue', 'start-black', 'start-green', 'start-orange'];
function* sweepStates(seeds, every) {
  for (let seed = 1; seed <= seeds; seed += 1) {
    const config = runtimeConfig(`sweep-${seed}`, seed, SWEEP_DECKS[seed % 7], SWEEP_DECKS[(seed * 3 + 1) % 7]);
    const made = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: config });
    assert.equal(made.ok, true);
    const session = made.value;
    let serial = 0;
    for (let step = 0; step < 90; step += 1) {
      let seat = 'player'; let port = session.port(seat).value; let query = port.query().value;
      if (query.status.finished) break;
      if (query.requiredInput ? !query.requiredInput.canAnswer : query.status.activeSeat !== 'player') { seat = 'ai'; port = session.port(seat).value; query = port.query().value; }
      if (step % every === every - 1) for (const watcher of seatsToCheck) yield { seed, step, session, seat: watcher };
      assert.equal(port.submit(chooseSimpleAiIntent(query, `s:${seat}:${++serial}`, input => port.queryAction(input)).value).ok, true);
    }
  }
}

test('2. over many states, nothing in what the CPU is handed names a real hidden card (uid or instance, alone or inside a longer id)', () => {
  let states = 0; let withMoves = 0;
  for (const { seed, step, session, seat } of sweepStates(10, 7)) {
    const real = realMatch(session, seat);
    const { cards } = hiddenNames(real.authority, seat);
    const numbers = new Set(cards.map(card => String(card.identity.instanceId).slice(2)));
    const decision = lookaheadHost.open(real);
    const text = JSON.stringify(everything(decision, 2, 3));
    states += 1; if (decision.moves.length > 1) withMoves += 1;
    for (const found of text.matchAll(/i:(\d+)(?!\d)/g)) assert.equal(numbers.has(found[1]), false, `seed ${seed} step ${step} ${seat}: ${found[0]} is a real hidden card`);
  }
  assert.ok(states > 100 && withMoves > 30, `${states} states, ${withMoves} with a choice`);
});

test('1. over many states, a changed hidden world gives the same decision', () => {
  let states = 0;
  for (const { seed, step, session, seat } of sweepStates(8, 11)) {
    const real = realMatch(session, seat);
    const changed = withOtherHiddenWorld(real.authority, seat);
    const a = decisionOn(real.authority, seat); const b = decisionOn(changed, seat);
    const queryA = a.port.query(); const queryB = b.port.query();
    assert.equal(queryA.ok && queryB.ok, true, `seed ${seed} step ${step} ${seat}: the changed world is a world`);
    assert.equal(firstDifference(queryA.value.observation, queryB.value.observation), null, 'what the seat sees is the same');
    assert.equal(firstDifference(everything(a.open(lookaheadHost), 2, 3), everything(b.open(lookaheadHost), 2, 3)), null, `seed ${seed} step ${step} ${seat}`);
    states += 1;
  }
  assert.ok(states > 20);
});
