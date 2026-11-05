import { addLog, otherPlayer } from "./shared.js";

export const FORFEIT_REASONS = Object.freeze(["concede", "disconnect"]);

// Keys the engine keeps while an effect is in flight. All of them are cleared when a game ends by forfeit.
const NULLED = ["pending", "prompt", "effectResolution", "mandatoryDrawContinuation", "resolvingDeclaredEffect",
  "deferredDeclaredResponseCleanup", "deferredDeclaredScriptCleanup", "placementCostBatch", "triggerThread", "deferredAttack"];
const EMPTIED = ["selectionQueue", "triggerQueue", "scriptActivationQueue", "declaredEffects", "responseEventQueue", "victoryFacts",
  "activationWindows", "deferredTrashMoves", "independentEffects"];
const DROPPED = ["deferredDestruction", "deferredSpellCleanup", "std230AmbushCleanup", "std142DestroyBatch", "std211DestructionBatch",
  "std094TurnEndQueue", "std141TurnEndQueue", "std142TurnEndQueue", "securityRestWindow", "attackResumeStage",
  "drainingIndependentEffects", "resolvingStd165", "skipSavageTurnEnd"];

const isCard = (value) => value !== null && typeof value === "object" && typeof value.uid === "string" && typeof value.id === "string" && typeof value.category === "string";

// Every card object reachable from `value` (a card in flight sits inside a pending choice, a cleanup record, a batch...).
function collectCards(value, found, seen) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (isCard(value)) found.set(value.uid, found.get(value.uid) ?? value);
  for (const item of Array.isArray(value) ? value : Object.values(value)) collectCards(item, found, seen);
}

// A card an unresolved effect was holding (an Sp whose text is still open, a card being decoded) is in no zone. Once the effect is dropped nothing
// would own it, so it goes to its owner's trash, where an Sp ends anyway.
function settleInFlightCards(state, holders, fallbackOwner) {
  const placed = new Map();
  collectCards(state.players, placed, new Set());
  const inFlight = new Map();
  collectCards(holders, inFlight, new Set());
  for (const [uid, card] of inFlight) {
    if (placed.has(uid)) continue;
    const owner = state.players[card.owner] ? card.owner : fallbackOwner;
    state.players[owner].trash.push(card);
  }
}

// Rulebook 1.2 「降参」(a user declares forfeit) and 「続行不能」(the system judges a user defeated: a lost connection).
// The game ends now, whatever is open: declared effects and choices still waiting are not resolved. This is not an effect, so
// the "locked result waits for declared effects" rule of effect victories does not apply. 文豪「投了・切断は負けにする」: the forfeiting
// user loses even when an effect had already locked a result (even one in their favour, or a draw); the forfeit replaces that result.
// `loserId` is the forfeiting user. Returns false when the game is already finished or the input is not valid.
export function forfeitGame(state, loserId, reason) {
  if (!FORFEIT_REASONS.includes(reason) || !state?.players?.[loserId] || state.victory?.finished) return false;
  state.winner = otherPlayer(loserId);
  state.victory = { lockedOutcome: state.winner, lockedAtEffectId: null, finished: false };
  settleInFlightCards(state, [...NULLED, ...EMPTIED, ...DROPPED].filter((key) => Object.hasOwn(state, key)).map((key) => state[key]), loserId);
  for (const key of NULLED) if (Object.hasOwn(state, key)) state[key] = null;
  for (const key of EMPTIED) if (Object.hasOwn(state, key)) state[key] = [];
  for (const key of DROPPED) delete state[key];
  state.processingTriggers = false;
  state.resolvingResponse = false;
  state.effectDepth = 0;
  state.victory.finished = true;
  state.victory.finishReason = reason;
  const name = state.players[loserId].user.name;
  addLog(state, reason === "concede" ? `${name}が投了。` : `${name}が接続を失い、続行不能。`, "win");
  return true;
}
