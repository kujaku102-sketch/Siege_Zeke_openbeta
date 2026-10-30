import { compileEffectText, keywordValue } from "../../../packages/effect-compiler/index.js";
import { NEUTRON_DECK, RED_DECK, USER_CARDS, USERS, VENGEANCE_DECK, YELLOW_DECK } from "../../data/cards.js";
import { START_DECKS } from "../../data/start-decks.js";
import { TUTORIAL_BLUE_DECK, TUTORIAL_SANDBAG_DECK } from "../../data/tutorial-script.js";
import { normalizeBoardSlots } from "../board-slots.js";
import { cardRuntimeRoute } from "../card-runtime-specs.js";
import { normalizeLayerState } from "../layer-state.js";
import { expandRuntimeDeck } from "../runtime/factory.js";
import { OPENING_ORDER } from "./opening.js";
import { arrangeBlueTutorial, arrangeLab, arrangeSandbox, arrangeTutorial, arrangeVengeanceTutorial } from "./setup-arrange.js";
import { runtimeRng, shuffle } from "./shared.js";
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

export function pullCard(deck, cardId) {
  const index = deck.findIndex((card) => card.id === cardId);
  if (index < 0) throw new Error(`Tutorial card missing: ${cardId}`);
  return deck.splice(index, 1)[0];
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
