// The CPUs a player can choose from, by name. A learned CPU (zig/) is a frozen copy of one made in SZbattlefield: the file that holds its weights is replaced, never edited
// (scripts/import-cpu.mjs copies a release in and writes zig/<line>.frozen.json beside it).
//
// learnedFor: the rules the weights were learned under. A learned CPU is offered only when its rule version is the game's (a changed rule is learned again); a different card
// version is shown but does not stop it (a card's wording is corrected more often than the rules change).
import { RULE_VERSION, CARD_VERSION } from '../game/runtime/versions.js';

export const DEFAULT_CPU_ID = 'simple';

// beatZIG reads ahead on states re-drawn from what the seat has seen (view.sim). The game does not open that reader for a CPU yet; without it beatZIG would play as lightZIG,
// which is not the CPU that was measured. So it is in the catalog and its code is here, but it is not offered until this is true.
export const LOOKAHEAD_READY = false;

// the order of "lighter": a CPU that is too slow on this device gives way to the next one
export const LIGHTER = Object.freeze({ beatZIG: 'lightZIG', lightZIG: 'simple', simple: null });

const ENTRIES = Object.freeze([
  Object.freeze({
    id: 'simple', name: 'simple', learned: false,
    description: 'ゲームの標準のCPU。決まった優先順で手を選ぶ。'
  }),
  Object.freeze({
    id: 'beatZIG', name: 'beatZIG', learned: true, generation: 3, needsLookahead: true,
    description: '強いCPU。lightZIGと同じモデルに、有力な手を先読みして比べる読みを足す。',
    learnedFor: Object.freeze({ ruleVersion: '2.0-public-staging.20', cardVersion: 'beta0.9.2-cards.16' }),
    load: () => import('./zig/beatZIG.mjs')
  }),
  Object.freeze({
    id: 'lightZIG', name: 'lightZIG', learned: true, generation: 3,
    description: '軽くて速いCPU。対戦から学んだ小さな学習済みモデルで、手の数値を見て選ぶ。',
    learnedFor: Object.freeze({ ruleVersion: '2.0-public-staging.20', cardVersion: 'beta0.9.2-cards.16' }),
    load: () => import('./zig/lightZIG.mjs')
  })
]);

export function catalogEntry(id) {
  return ENTRIES.find(entry => entry.id === id) ?? null;
}

// a learned CPU whose rules are not the game's is not offered (allowStale is for tests and tools only); one that needs the reader is not offered until the game opens it
export function cpuAvailable(entry, { allowStale = false } = {}) {
  if (!entry) return false;
  if (!entry.learned) return true;
  if (entry.needsLookahead && !LOOKAHEAD_READY) return false;
  return allowStale || entry.learnedFor.ruleVersion === RULE_VERSION;
}

export function listCpus() {
  return Object.freeze(ENTRIES.map(entry => Object.freeze({
    id: entry.id, name: entry.name, description: entry.description, learned: entry.learned,
    generation: entry.generation ?? null,
    available: cpuAvailable(entry),
    cardVersionMatches: entry.learned ? entry.learnedFor.cardVersion === CARD_VERSION : true
  })));
}
