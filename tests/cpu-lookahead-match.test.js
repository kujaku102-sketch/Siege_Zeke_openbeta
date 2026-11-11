import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createNewMatchSessionController } from '../src/adapters/match-session-controller.js';
import { chooseSimpleAiIntent } from '../src/adapters/simple-ai-policy.js';
import { CARD_VERSION, RULE_VERSION } from '../src/game/runtime/versions.js';
import { createCpu, preloadCpu } from '../src/cpu/index.js';

// The beatZIG the game ships plays the matches that SZbattlefield's released beatZIG gen3 played (the fourth check of tests/cpu-lookahead.test.js, kept here in the game's own suite):
// the same match names, the same seeds, the same decks, and the hash of every command, the outcome and the turns is the same. The hashes are the bench's (src/play.mjs).
// The whole table is compared with SZbattlefield's src/compare-shipped.mjs (the released file against cpus/game-cpu.mjs?cpu=beatZIG); this is a few matches of it that run with the game.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/cpu-beatzig-bench.json', import.meta.url), 'utf8'));
const SEATS = ['seat-a', 'seat-b'];

function playBenchMatch({ deckA, deckB, seed, cpuSeat }, cpu) {
  const name = SEATS.map(seat => (seat === cpuSeat ? 'cpu' : 'simple')).join('.');
  const made = createNewMatchSessionController({ sessionGeneration: 1, runtimeConfig: {
    matchId: `bench:${name}/${deckA}/${deckB}/${seed}`, seatIds: SEATS, seed, ruleVersion: RULE_VERSION, cardVersion: CARD_VERSION,
    gameOptions: { mode: 'ai', playerDeckId: deckA, aiDeckId: deckB, openingProtocol: 'v2.4' }
  } });
  assert.equal(made.ok, true, JSON.stringify(made));
  const session = made.value;
  let serial = 0;
  for (let step = 0; step < 3000; step += 1) {
    const queries = Object.fromEntries(SEATS.map(seat => [seat, session.port(seat).value.query().value]));
    if (queries['seat-a'].status.finished) break;
    const actor = SEATS.find(seat => queries[seat].requiredInput?.canAnswer) ?? queries['seat-a'].status.activeSeat;
    const port = session.port(actor).value;
    const commandId = `c${++serial}`;
    const queryAction = input => port.queryAction(input);
    const intent = actor === cpuSeat ? cpu.policy(queries[actor], commandId, queryAction, session.lookahead(actor).value) : chooseSimpleAiIntent(queries[actor], commandId, queryAction);
    assert.equal(intent.ok, true, `${actor}: ${JSON.stringify(intent)}`);
    assert.equal(port.submit(intent.value).ok, true);
  }
  let taken = null;
  session.lookahead(SEATS[0]).value({ open: input => { taken = input; return null; } });
  const locked = taken.authority.engineState.victory?.lockedOutcome ?? null;
  const outcome = locked === null ? null : locked === 'draw' ? { kind: 'draw' } : { kind: 'win', winnerSeat: taken.authority.metadata.seatIds[locked === 'player' ? 0 : 1] };
  const turns = taken.authority.engineState.turnNumber;
  const record = session.matchRecord().value;
  return { hash: createHash('sha256').update(JSON.stringify([record.commands, outcome, turns])).digest('hex').slice(0, 16), turns, outcome };
}

test('beatZIG as the game ships it plays the matches the released beatZIG gen3 played, hash for hash', async () => {
  assert.equal((await preloadCpu('beatZIG')).ok, true);
  assert.ok(fixture.matches.length >= 10);
  for (const expected of fixture.matches) {
    const cpu = createCpu({ cpuId: 'beatZIG', seatId: expected.cpuSeat, clock: () => 0 });
    assert.equal(cpu.value.id(), 'beatZIG');
    const got = playBenchMatch(expected, cpu.value);
    assert.deepEqual(got, { hash: expected.hash, turns: expected.turns, outcome: expected.outcome }, `${expected.deckA} vs ${expected.deckB}, seed ${expected.seed}, the CPU on ${expected.cpuSeat}`);
    assert.equal(cpu.value.id(), 'beatZIG', 'it was not replaced during the match');
    assert.deepEqual(cpu.value.switches(), []);
  }
});
