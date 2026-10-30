import { cardRuntimeRoute } from "../card-runtime-specs.js";
import { compileEffectText, keywordValue } from "../../../packages/effect-compiler/index.js";
import { normalizeLayerState } from "../layer-state.js";
import { TUTORIAL_BLUE_DECK, TUTORIAL_BLUE_HAND, TUTORIAL_OPPONENT_STR, TUTORIAL_RED_HAND, TUTORIAL_SANDBAG_DECK } from "../../data/tutorial-script.js";
import { createRuntimeCard, expandRuntimeDeck } from "../runtime/factory.js";
import { CARD_LIBRARY, LAB_CARD_IDS, NEUTRON_DECK, RED_DECK, USER_CARDS, USERS, VENGEANCE_DECK, YELLOW_DECK } from "../../data/cards.js";
import { START_DECKS } from "../../data/start-decks.js";
import { normalizeBoardSlots } from "../board-slots.js";
import { addLog, fail, runtimeRng, shuffle } from "./shared.js";
import { emitUserAbilityFeedback } from "./triggers.js";
import { drawCardRaw, startTurn } from "./turn.js";

function normalizeClasses(instance) {
  const values = instance.classes ?? instance.cardClass ?? instance.className ?? instance.class
    ?? instance.affiliation ?? instance.tribe ?? instance.species ?? instance["所属"] ?? instance["種族"] ?? [];
  return [...new Set((Array.isArray(values) ? values : String(values).split(/[\/／]/))
    .map((value) => String(value).trim()).filter(Boolean))];
}

export function hydrateCard(instance) {
  if (!cardRuntimeRoute(instance.id)) throw new Error(`Unregistered card runtime: ${instance.id}`);
  const compiled = compileEffectText(instance.text, { category: instance.category, id: instance.id });
  const printedCategory = instance.printedCategory ?? instance.category;
  return normalizeLayerState({
    ...instance,
    category: instance.category === "LOb" ? "Ob" : instance.category,
    printedCategory,
    classes: normalizeClasses(instance),
    compiled,
    faceDown: instance.faceDown === true,
    protect: Number(instance.protect ?? keywordValue({ ...instance, compiled }, "PROTECT") ?? 0)
  });
}

function buildPlayer(id, user, deck) {
  return {
    id,
    user: { ...user },
    fortressStr: user.maxStr,
    baseMemory: user.memory,
    permanentMemory: 0,
    memory: user.memory,
    turboActive: false,
    turboUsed: false,
    userAbilityUsed: false,
    mulligansUsed: 0,
    firstRegistryInstallResolved: false,
    firstObExecutionTurn: null,
    deck: deck.map(hydrateCard),
    hand: [],
    front: [],
    back: [],
    registry: [],
    trash: [],
    ban: [],
    virtual: [],
    incidentsTriggered: [],
    installedThisTurn: false,
    registryActionUsed: false,
    scriptUsage: {},
    triggerUsage: {},
    turnsTaken: 0,
    forceAttack: false
  };
}

function pullCard(deck, cardId) {
  const index = deck.findIndex((card) => card.id === cardId);
  if (index < 0) throw new Error(`Tutorial card missing: ${cardId}`);
  return deck.splice(index, 1)[0];
}

// 赤(基本操作)。台本どおりの初手: グレン(インストール用)・兵士(無色)・切込隊長アツト・ジャンクパーツ。
// 相手は黄の席だが手札はセキュリティのObガードマン1枚だけ(山札の並びや引きには頼らない)。
function arrangeTutorial(players, runtimeContext = null) {
  players.ai.fortressStr = TUTORIAL_OPPONENT_STR;
  players.player.hand = TUTORIAL_RED_HAND.map((id, index) => hydrateCard(createRuntimeCard(runtimeContext, id, "player", 501 + index)));
  players.ai.hand = [hydrateCard(createRuntimeCard(runtimeContext, "STD-022", "ai", 511))];
}

function arrangeVengeanceTutorial(players, runtimeContext = null) {
  players.ai.fortressStr = TUTORIAL_OPPONENT_STR;
  players.player.hand = [
    hydrateCard(createRuntimeCard(runtimeContext, "STD-191", "player", 301)),
    hydrateCard(createRuntimeCard(runtimeContext, "STD-195", "player", 302)),
    hydrateCard(createRuntimeCard(runtimeContext, "STD-194", "player", 303)),
    hydrateCard(createRuntimeCard(runtimeContext, "STD-192", "player", 304)),
    hydrateCard(createRuntimeCard(runtimeContext, "STD-202", "player", 307))
  ];
  players.player.front = [
    hydrateCard(createRuntimeCard(runtimeContext, "STD-189", "player", 305)),
    hydrateCard(createRuntimeCard(runtimeContext, "STD-189", "player", 306))
  ];
  for (const card of players.player.front) card.summoningSick = false;
  players.player.baseMemory = 15;
  players.player.memory = 15;
  players.player.user.memory = 15;
  players.player.user.color = "紫";
  players.ai.hand = ["STD-125", "STD-131", "STD-149"].map((id) => pullCard(players.ai.deck, id));
}

// 青(セキュリティ・ハッキング・暗号化)。手札はルチル・漣・フラウ・セキュリティウォールの4枚、場・レジストリは空。
// 山札(オフェンスプロトコル1枚とアサルトプログラム)の並びには頼らない: ルチルのアクセスで山札は混ぜられるが、
// 手札に移るのはオフェンスプロトコルだけなので、残りはすべてアサルトプログラムになる。
// 相手は無色のサンドバッグデッキで、手札は装甲兵 メルク(STD-043)1枚だけ。
function arrangeBlueTutorial(players, runtimeContext = null) {
  players.ai.fortressStr = TUTORIAL_OPPONENT_STR;
  players.player.hand = TUTORIAL_BLUE_HAND.map((id, index) => hydrateCard(createRuntimeCard(runtimeContext, id, "player", 401 + index)));
  players.ai.hand = [hydrateCard(createRuntimeCard(runtimeContext, "STD-043", "ai", 411))];
}

function arrangeSandbox(players, { useConfiguredDecks = false } = {}, runtimeContext = null) {
  if (useConfiguredDecks) {
    for (const player of Object.values(players)) {
      player.hand = [];
      player.front = [];
      player.back = [];
      for (let index = 0; index < Number(player.user.initialHand ?? 4); index += 1) drawCardRaw(player);
      player.baseMemory = 99;
      player.memory = 99;
      player.user.memory = 99;
    }
    return;
  }
  const dummyIds = ["STD-022", "STD-023", "STD-024", "STD-025", "STD-031"];
  players.player.deck = Array.from({ length: 10 }, (_, index) => hydrateCard(createRuntimeCard(runtimeContext, dummyIds[index % dummyIds.length], "player", 7000 + index)));
  players.player.hand = [];
  players.player.front = [hydrateCard(createRuntimeCard(runtimeContext, "STD-020", "player", 101))];
  players.player.back = [];
  players.player.baseMemory = 99;
  players.player.memory = 99;
  players.player.user.memory = 99;

  const mountedHost = hydrateCard(createRuntimeCard(runtimeContext, "STD-131", "ai", 201));
  const mountedCode = hydrateCard(createRuntimeCard(runtimeContext, "STD-078", "ai", 202));
  mountedCode.layerRole = "mount";
  mountedHost.mounted.push(mountedCode);
  const hiddenScript = hydrateCard(createRuntimeCard(runtimeContext, "STD-036", "ai", 203));
  hiddenScript.faceDown = true;
  players.ai.deck = Array.from({ length: 10 }, (_, index) => hydrateCard(createRuntimeCard(runtimeContext, dummyIds[index % dummyIds.length], "ai", 8000 + index)));
  players.ai.hand = [];
  players.ai.front = [
    hydrateCard(createRuntimeCard(runtimeContext, "STD-127", "ai", 204)),
    mountedHost,
    hydrateCard(createRuntimeCard(runtimeContext, "STD-020", "ai", 205))
  ];
  players.ai.back = [
    hiddenScript,
    hydrateCard(createRuntimeCard(runtimeContext, "STD-078", "ai", 206))
  ];
  players.ai.baseMemory = 99;
  players.ai.memory = 99;
  players.ai.user.memory = 99;
}

function arrangeLab(players, runtimeContext = null) {
  players.player.deck = [];
  players.player.hand = LAB_CARD_IDS.map((id, index) => hydrateCard(createRuntimeCard(runtimeContext, id, "player", index + 1)));
  players.player.front = [hydrateCard(createRuntimeCard(runtimeContext, "STD-020", "player", 101))];
  players.player.back = [];
  players.player.baseMemory = 99;
  players.player.memory = 99;
  players.player.user.memory = 99;

  const mountedHost = hydrateCard(createRuntimeCard(runtimeContext, "STD-131", "ai", 201));
  const mountedCode = hydrateCard(createRuntimeCard(runtimeContext, "STD-078", "ai", 202));
  mountedCode.layerRole = "mount";
  mountedHost.mounted.push(mountedCode);
  const hiddenScript = hydrateCard(createRuntimeCard(runtimeContext, "STD-036", "ai", 203));
  hiddenScript.faceDown = true;
  players.ai.deck = [];
  players.ai.hand = [];
  players.ai.front = [
    hydrateCard(createRuntimeCard(runtimeContext, "STD-127", "ai", 204)),
    mountedHost,
    hydrateCard(createRuntimeCard(runtimeContext, "STD-020", "ai", 205))
  ];
  players.ai.back = [hiddenScript, hydrateCard(createRuntimeCard(runtimeContext, "STD-078", "ai", 206))];
  players.ai.baseMemory = 99;
  players.ai.memory = 99;
  players.ai.user.memory = 99;
}

export function canAddSandboxCardToHand(state, playerId, cardId) {
  return Boolean(state && ["lab", "sandbox"].includes(state.mode)
    && state.players && typeof state.players === "object" && Object.hasOwn(state.players, playerId)
    && typeof cardId === "string" && cardId.length > 0 && Object.hasOwn(CARD_LIBRARY, cardId));
}

export function addSandboxCardToHand(state, playerId, cardId) {
  if (!canAddSandboxCardToHand(state, playerId, cardId)) return false;
  const card = hydrateCard(createRuntimeCard(state.runtimeContext ?? null, cardId, playerId, ++state.tokenSerial + 9000));
  state.players[playerId].hand.push(card);
  addLog(state, `ALL CARD LISTから${state.players[playerId].user.name}の手札へ「${card.name}」を追加。`, "system");
  return true;
}

// 開始手順(規則書2.4)。openingProtocol="v2.4" の試合だけ、ゲーム開始前に各ユーザーが1回(BIGBOSSは最大3回)
// 手札の任意枚数を山札の下へ戻して同数引き直せる。決定は seat 順(player→ai)に1人ずつ行い、最後の決定の中で
// ダイスを振って先攻を決め、ターンを開始する。未指定("legacy")は従来どおり先攻=player固定で、BIGBOSSだけ全手札を引き直せる。
const OPENING_ORDER = Object.freeze(["player", "ai"]);

const openingMulliganLimit = (player) => (player.user.abilityKey === "watching_you" ? 3 : 1);

export function canOpeningMulligan(state, playerId) {
  const player = state.players[playerId];
  if (state.opening) {
    return Boolean(player && state.opening.status === "mulligan" && state.active === playerId
      && Number(player.mulligansUsed ?? 0) < openingMulliganLimit(player) && player.hand.length > 0);
  }
  return Boolean(player
    && player.user.abilityKey === "watching_you"
    && state.turnNumber === 1 && state.active === playerId
    && Number(player.mulligansUsed ?? 0) < 3
    && player.front.length === 0 && player.back.length === 0 && player.registry.length === 0
    && player.trash.length === 0 && player.ban.length === 0
    && player.hand.length === Number(player.user.initialHand ?? 5));
}

export function canKeepOpeningHand(state, playerId) {
  return Boolean(state.opening && state.opening.status === "mulligan" && state.active === playerId && state.players[playerId]);
}

// 現在のユーザーの決定を終え、次のユーザーへ。全員が終わったらダイスで先攻を決めてターンを開始する。
function finishOpeningDecision(state) {
  const opening = state.opening;
  opening.index += 1;
  if (opening.index < opening.order.length) {
    state.active = opening.order[opening.index];
    return;
  }
  const first = state.rng() < 0.5 ? opening.order[0] : opening.order[1];
  delete state.opening;
  state.firstPlayer = first;
  state.active = first;
  state.phase = "main";
  addLog(state, `ダイス: ${state.players[first].user.name}（${first === "player" ? "自分" : "相手"}）が先攻。`, "system");
  startTurn(state, first);
}

export function openingMulligan(state, playerId, { uids } = {}) {
  if (!canOpeningMulligan(state, playerId)) return fail(state, "マリガン可能な開始状態ではない。", false);
  const player = state.players[playerId];
  if (state.opening) {
    const chosen = Array.isArray(uids) ? [...new Set(uids)] : [];
    if (!chosen.length || chosen.length !== uids.length || !chosen.every((uid) => player.hand.some((card) => card.uid === uid))) {
      return fail(state, "引き直すカードを手札から1枚以上選んで。", false);
    }
    const returned = chosen.map((uid) => player.hand.splice(player.hand.findIndex((card) => card.uid === uid), 1)[0]);
    player.deck.unshift(...returned);
    for (let index = 0; index < returned.length; index += 1) drawCardRaw(player);
    player.deck = shuffle(player.deck, state.rng);
    player.mulligansUsed += 1;
    state.selectedUid = null;
    const limit = openingMulliganLimit(player);
    addLog(state, `${player.user.name}: ${returned.length}枚を山札の下へ戻して引き直し（${player.mulligansUsed}/${limit}）。`, "effect");
    if (player.user.abilityKey === "watching_you") emitUserAbilityFeedback(state, "watching_you", playerId, playerId, {
      branch: "mulligan", amount: Number(player.mulligansUsed), steps: [{ kind: "transfer", from: { kind: "zone_count", playerId, zone: "hand" }, to: { kind: "zone_count", playerId, zone: "deck" }, count: returned.length }, { kind: "transfer", from: { kind: "zone_count", playerId, zone: "deck" }, to: { kind: "zone_count", playerId, zone: "hand" }, count: returned.length }]
    });
    if (player.mulligansUsed >= limit) finishOpeningDecision(state);
    return true;
  }
  player.deck.push(...player.hand.splice(0));
  player.deck = shuffle(player.deck, state.rng);
  for (let index = 0; index < Number(player.user.initialHand ?? 5); index += 1) drawCardRaw(player);
  player.mulligansUsed += 1;
  state.selectedUid = null;
  addLog(state, `${player.user.name}: マリガン ${player.mulligansUsed}/3。`, "effect");
  emitUserAbilityFeedback(state, "watching_you", playerId, playerId, {
    branch: "mulligan", amount: Number(player.mulligansUsed), steps: [{ kind: "transfer", from: { kind: "zone_count", playerId, zone: "hand" }, to: { kind: "zone_count", playerId, zone: "deck" }, count: Number(player.user.initialHand ?? 5) }, { kind: "transfer", from: { kind: "zone_count", playerId, zone: "deck" }, to: { kind: "zone_count", playerId, zone: "hand" }, count: player.hand.length }]
  });
  return true;
}

export function keepOpeningHand(state, playerId) {
  if (!canKeepOpeningHand(state, playerId)) return fail(state, "手札をキープできる開始状態ではない。", false);
  addLog(state, `${state.players[playerId].user.name}: 手札をキープ。`, "effect");
  finishOpeningDecision(state);
  return true;
}

// 選べるのは7色のスタートデッキ。旧固定デッキ(hidden)はチュートリアルと過去の対戦記録の再生用に残す。
export const DECK_OPTIONS = Object.freeze({
  ...Object.fromEntries(START_DECKS.map((deck) => [deck.id, {
    label: deck.name, color: deck.color, recipe: Object.freeze(Object.entries(deck.cards).map(([id, count]) => Object.freeze([id, count])))
  }])),
  red: { label: "レッドパンクス・赤", color: "赤", recipe: RED_DECK, hidden: true },
  yellow: { label: "NOM・黄", color: "黄", recipe: YELLOW_DECK, hidden: true },
  vengeance: { label: "ヴェンジェンス・紫", color: "紫", recipe: VENGEANCE_DECK, hidden: true },
  neutron: { label: "ニュートロン・セキュリティ・青", color: "青", recipe: NEUTRON_DECK, hidden: true },
  "tutorial-blue": { label: "青チュートリアル・青", color: "青", recipe: TUTORIAL_BLUE_DECK, hidden: true },
  "tutorial-sandbag": { label: "サンドバッグ・無色", color: "無", recipe: TUTORIAL_SANDBAG_DECK, hidden: true }
});

export function createGame({ mode = "ai", tutorialId = "basics", playerDeckId = "red", aiDeckId = "yellow", playerDeckRecipe = null, aiDeckRecipe = null, playerUserId = "doors_zx", aiUserId = "doors_zx", sandboxDeckSetup = false, rng = Math.random, runtimeContext = null, openingProtocol = "legacy" } = {}) {
  if (runtimeContext !== null) rng = runtimeRng(runtimeContext);
  const isVengeanceTutorial = mode === "tutorial" && tutorialId === "vengeance";
  const isBlueTutorial = mode === "tutorial" && tutorialId === "blue";
  const selectedPlayerDeck = isVengeanceTutorial ? DECK_OPTIONS.vengeance : isBlueTutorial ? DECK_OPTIONS["tutorial-blue"] : (DECK_OPTIONS[playerDeckId] ?? DECK_OPTIONS.red);
  const selectedAiDeck = isBlueTutorial ? DECK_OPTIONS["tutorial-sandbag"] : (DECK_OPTIONS[aiDeckId] ?? DECK_OPTIONS.yellow);
  const skipInitialDecks = runtimeContext !== null && (mode === "lab" || (mode === "sandbox" && !sandboxDeckSetup));
  const red = skipInitialDecks ? [] : expandRuntimeDeck(runtimeContext, playerDeckRecipe ?? selectedPlayerDeck.recipe, "player");
  const yellow = skipInitialDecks ? [] : expandRuntimeDeck(runtimeContext, aiDeckRecipe ?? selectedAiDeck.recipe, "ai");
  const playerUser = USER_CARDS[playerUserId] ?? USERS.player;
  const aiUser = USER_CARDS[aiUserId] ?? USERS.ai;
  const players = {
    player: buildPlayer("player", { ...playerUser, color: selectedPlayerDeck.color }, mode === "tutorial" ? red : shuffle(red, rng)),
    ai: buildPlayer("ai", { ...aiUser, color: selectedAiDeck.color }, mode === "tutorial" ? yellow : shuffle(yellow, rng))
  };
  if (mode === "tutorial") {
    if (isVengeanceTutorial) arrangeVengeanceTutorial(players, runtimeContext);
    else if (isBlueTutorial) arrangeBlueTutorial(players, runtimeContext);
    else arrangeTutorial(players, runtimeContext);
  }
  else if (mode === "lab") arrangeLab(players, runtimeContext);
  else if (mode === "sandbox") arrangeSandbox(players, { useConfiguredDecks: sandboxDeckSetup }, runtimeContext);
  else {
    for (let i = 0; i < Number(players.player.user.initialHand ?? 4); i += 1) drawCardRaw(players.player);
    for (let i = 0; i < Number(players.ai.user.initialHand ?? 4); i += 1) drawCardRaw(players.ai);
  }

  const state = {
    ...(runtimeContext === null ? {} : { runtimeContext }),
    mode,
    tutorialId,
    playerDeckId: isVengeanceTutorial ? "vengeance" : isBlueTutorial ? "tutorial-blue" : playerDeckId,
    aiDeckId: isBlueTutorial ? "tutorial-sandbag" : aiDeckId,
    playerUserId,
    aiUserId,
    players,
    active: "player",
    firstPlayer: "player",
    turnNumber: 1,
    phase: "main",
    winner: null,
    victory: { lockedOutcome: null, lockedAtEffectId: null, finished: false },
    projectionSerial: 0,
    projectionSlotRevision: { pending: 0, prompt: 0 },
    selectionQueueSerial: 0,
    selectionQueue: [],
    legacyProjectionOwnerSerial: 0,
    // A resolution is deliberately data-only: a save/history JSON roundtrip can
    // resume an internal choice without treating unrelated trigger work as part
    // of the same card text.
    effectResolution: null,
    effectSerial: 0,
    victoryFacts: [],
    selectedUid: null,
    openAdmin: null,
    pending: null,
    prompt: null,
    mandatoryDrawContinuation: null,
    message: "",
    log: [],
    history: [],
    tokenSerial: 0,
    provisional: [],
    events: [],
    activationWindows: [],
    scriptActivationQueue: [],
    lastEventContext: null,
    triggerQueue: [],
    triggerSerial: 0,
    processingTriggers: false,
    effectDepth: 0,
    turnStats: { destroyedOb: 0, destroyedCards: 0, destroyedSacredTreeScripts: 0 },
    delayedEffects: [],
    declaredEffects: [],
    declarationSerial: 0,
    resolvingDeclaredEffect: null,
    deferredDeclaredResponseCleanup: null,
    deferredDeclaredScriptCleanup: null,
    placementCostBatch: null,
    responseEventQueue: [],
    resolvingResponse: false,
    triggerThread: null,
    threadNotice: null,
    interactive: false,
    rng
  };
  if (["lab", "sandbox"].includes(mode)) {
    state.sandboxUi = { query: "", expansion: "all", catalogOwner: "player", opponentControl: "manual", actor: "player" };
  }
  if (runtimeContext !== null) normalizeBoardSlots(state);
  if (openingProtocol === "v2.4" && mode === "ai") {
    // 開始前フェーズ: 先攻はまだ決まっていない(最後の決定でダイス)。player から順に手札の確認を行う。
    state.opening = { status: "mulligan", order: [...OPENING_ORDER], index: 0 };
    state.phase = "opening";
    return state;
  }
  startTurn(state, state.active);
  return state;
}
