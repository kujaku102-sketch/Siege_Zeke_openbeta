import "./styles.css";
import {
  activateTurbo,
  openingMulligan,
  addSandboxCardToHand,
  activateScript,
  activateCardEffect,
  activateResponse,
  addLog,
  attack,
  configurePlugin,
  cloneForHistory,
  createGame,
  declinePrompt,
  declineResponse,
  endTurn,
  executeRegistryCard,
  findCard,
  getAttackTargets,
  getEffectTargets,
  getActivatableEffects,
  getEffectActivationTargets,
  getLayeredCandidates,
  getLayeredRequirement,
  installCard,
  playCard,
  playLayeredCard,
  recoverRegistryCard,
  relogCard,
  remember,
  resolveTriggerChoice,
  dismissThreadNotice,
  resolveLuckyShotAdditional,
  resolveCardSelection,
  resolveAccessDragPlacement,
  resolveSamLogin,
  restSecurity,
  spellNeedsTarget,
  undo
} from "./game/engine.js";
import { canConfirmSelection, collectDeckScopeOptions, confirmSelection, createSelectionRequest, setAllocation, setSelectionScope, toggleSelection } from "./game/selection-model.js";
import { resolveAutomatedAiChoices, runSimpleAiTurnSteps } from "./game/ai.js";
import { acceptTutorialAction, advanceTutorialIntroduction, createTutorialFlow, isTutorialActionExpected, tutorialAdvanceAction } from "./data/tutorial.js";
import { renderApp } from "./ui/render.js";
import { applyVisualEffects, planVisualEffects, snapshotVisualState } from "./ui/visual-effects.js";
import { MAX_SAVED_DECKS, deckToRecipe, loadSavedDecks, normalizeSavedDeck, recommendDeck, saveDeckCollection, validateDeck } from "./game/deck-builder.js";
import { registerPwa } from "./pwa.js";
import { liveHtml, liveInteractionHtml } from "./ui-refresh/live-view.js";
import { createInteractionPatcher, updateSelectionMarkers } from "./ui-refresh/selection-render.js";
import { patchHtml } from "./ui-refresh/dom-patch.js";
import { createWorkCache, createFrameScheduler } from "./ui-refresh/work-cache.js";
import { actorFor, avoidFocus, canLeaveTutorial, dismissBoardSelection, executionSlots, isDownwardHandSwipe, livePlacementSlots, leaveTutorial, mobileConsoleScale, requestTurnEnd, resolutionBusy, shouldAutoStartAiTurn, stepBackInput } from "./ui-refresh/session.js";
import { fitBoard, placePopup, readSavedView, resolveView, saveView } from "./ui-refresh/model.js";
import { currentTutorialPresentation } from "./data/tutorial.js";
import { tutorialFocusSelector } from "./ui/render.js";
import { isFullscreen, toggleFullscreen } from "./ui-refresh/fullscreen.js";
import { syncEntryLogoGlitch } from "./ui-refresh/entry-logo-glitch.js";
import { syncEntryCrtViewport } from "./ui-refresh/entry-crt-viewport.js";
import { syncLiveInputLocks } from "./ui-refresh/input-lock.js";
import { syncResultFx } from "./ui-refresh/result-fx.js";
import { fitGuideContent } from "./ui-refresh/guide.js";
import { captureDeckViewport, restoreDeckViewport } from "./ui/deck-viewport.js";
import { isObCard } from "./game/card-types.js";
import { installAbilityHelp } from "./ui/ability-help.js";
import "./ui/ability-help.css";

const root = document.querySelector("#app");
installAbilityHelp(root);
const refreshed = document.documentElement.dataset.ui === "r2";
const live = { screen: "entry", view: resolveView({ pathname: location.pathname, saved: readSavedView(localStorage), mobile: navigator.userAgentData?.mobile, userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints }).view, detailUid: null, draft: null, selectionCollapsedFor: null, handOpen: true, options: false, uniqueOpen: false, tapDetails: true, log: false, catalog: false, notice: "" };
const currentPending = () => live.draft ?? state.pending;
const prepareInput = pending => { if (refreshed) { live.draft = { ...pending, uiDraft: true }; live.detailUid = null; } else state.pending = pending; };
const clearInput = () => { if (refreshed && live.draft) live.draft = null; else state.pending = null; };
const syncInputLocks = () => syncLiveInputLocks(root, {
  optionsOpen: live.options,
  uniqueOpen: live.uniqueOpen,
  resultOpen: Boolean(root.querySelector(".r2-result")),
  entryCrtReady: Boolean(root.querySelector(".r2-entry-crt-ready"))
});
let state;
let tutorialFlow;
let selectedTutorial = "basics";
let selectedPlayerDeck = "red";
let selectedAiDeck = "yellow";
let selectedPlayerUser = "doors_zx";
let selectedAiUser = "doors_zx";
let savedDecks = loadSavedDecks();
let deckBuilder = { open: false, query: "", color: "all", recommendColor: "赤", strategy: "balanced", recommendationNote: "", draft: normalizeSavedDeck({ id: "", name: "新規デッキ", userId: "doors_zx", cards: {} }, "") };
const EFFECTS_STORAGE_KEY = "sz-ui-effects";
const mobileUi = { handOpen: false, menuOpen: true, artPreviewUid: null, aiPacing: null, tutorialOverlayOpen: false, tutorialPresentedStep: null, tutorialOverlayPosition: "bottom", effectsEnabled: localStorage.getItem(EFFECTS_STORAGE_KEY) === "on" };
mobileUi.masterVolume = Math.max(0, Math.min(10, Number.parseInt(localStorage.getItem("sz-master-volume") ?? "7", 10) || 0));
const entryCrtActive = () => mobileUi.effectsEnabled && live.screen === "entry" && !deckBuilder.open
  && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
mobileUi.logoNoiseProfile = localStorage.getItem('sz-logo-noise-profile') || 'random';
let entryLogoVideoFile = null;
let visualSnapshot = null;
let presentationQueue = [];
let mobileDetailOutsideHandler = null;
let artPreviewKeyHandler = null;
let aiPacingRun = 0;
let aiTurnIterator = null;
let aiResumeScheduled = false;
let aiAutoStartScheduled = false;
let aiStartedState = null;
let aiStartedTurn = 0;
const AI_STEP_DELAY_MS = 420;
const AI_TURN_MINIMUM_MS = 2800;
const savedScroll = { hand: 0, catalog: 0, board: null, deckBuilder: 0, deckCards: 0 };
const interactionPatcher = createInteractionPatcher();
const detailCache = createWorkCache(16), layoutCache = createWorkCache();
const layoutFrame = createFrameScheduler(() => positionLive(), requestAnimationFrame, cancelAnimationFrame);
let observedStage = null, observedLegacy = null;
const boardResizeObserver = refreshed && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
  layoutCache.invalidate("board-fit"); layoutFrame.schedule();
}) : null;
let interactionContext = null;
const renderBindings = new Map();
let deckPressSuppressedUntil = 0;
const bindOn = (node, event, handler) => {
  if (!node) return;
  if (!renderBindings.has(node)) renderBindings.set(node, new AbortController());
  node.addEventListener(event, handler, { signal: renderBindings.get(node).signal });
};
function clearRenderBindings(detachedOnly = false) {
  for (const [node, controller] of renderBindings) {
    if (detachedOnly && (!(node instanceof Element) || root.contains(node))) continue;
    controller.abort(); renderBindings.delete(node);
  }
}
const controlledPlayerId = () => state?.mode === "sandbox" ? (state.sandboxUi?.actor ?? "player") : "player";
const opposingPlayerId = () => controlledPlayerId() === "player" ? "ai" : "player";

function init(mode = "tutorial", tutorialId = selectedTutorial) {
  if (mode !== "tutorial") {
    const invalid = savedDecks.find(deck => [selectedPlayerDeck, selectedAiDeck].includes(`custom:${deck.id}`) && !validateDeck(deck).valid);
    if (invalid) {
      // Keep the current match intact; an old saved deck must be repaired first.
      deckBuilder.open = true;
      deckBuilder.draft = structuredClone(invalid);
      deckBuilder.recommendationNote = `「${invalid.name}」は構築規定の修正が必要です。内容は保持しています。`;
      syncDeckUi();
      return false;
    }
  }
  aiPacingRun += 1;
  aiTurnIterator = null;
  aiStartedState = null;
  aiStartedTurn = 0;
  live.draft = null; live.detailUid = null; live.selectionCollapsedFor = null; live.options = false; live.screen = "game"; live.notice = "";
  visualSnapshot = null;
  presentationQueue = [];
  if (mode === "tutorial") selectedTutorial = tutorialId;
  const playerSaved = selectedPlayerDeck.startsWith("custom:") ? savedDecks.find((deck) => `custom:${deck.id}` === selectedPlayerDeck) : null;
  const aiSaved = selectedAiDeck.startsWith("custom:") ? savedDecks.find((deck) => `custom:${deck.id}` === selectedAiDeck) : null;
  state = createGame({ mode, tutorialId: selectedTutorial, playerDeckId: playerSaved ? "red" : selectedPlayerDeck, aiDeckId: aiSaved ? "yellow" : selectedAiDeck,
    playerDeckRecipe: playerSaved ? deckToRecipe(playerSaved) : null, aiDeckRecipe: aiSaved ? deckToRecipe(aiSaved) : null,
    playerUserId: playerSaved?.userId ?? selectedPlayerUser, aiUserId: aiSaved?.userId ?? selectedAiUser,
    sandboxDeckSetup: mode === "sandbox" });
  state.playerDeckId = selectedPlayerDeck;
  state.aiDeckId = selectedAiDeck;
  state.savedDecks = savedDecks;
  state.deckBuilder = deckBuilder;
  state.interactive = true;
  if (refreshed && state.mode === "sandbox") state.sandboxUi.alternateTurns = true;
  mobileUi.handOpen = false;
  mobileUi.menuOpen = mode === "tutorial";
  mobileUi.artPreviewUid = null;
  mobileUi.aiPacing = null;
  mobileUi.tutorialOverlayOpen = mode === "tutorial";
  mobileUi.tutorialPresentedStep = mode === "tutorial" ? `${selectedTutorial}:0` : null;
  mobileUi.tutorialOverlayPosition = "bottom";
  savedScroll.board = null;
  tutorialFlow = mode === "tutorial" ? createTutorialFlow(selectedTutorial) : null;
  render();
}

// Browser E2E harness. Production UI does not call these exports.
export function resetE2E(mode = "lab") { init(mode); }
export function getE2EState() { return state; }
export function renderE2E() { render(); }
export function getRenderWorkE2E() { return { html: detailCache.snapshot(), layout: layoutCache.snapshot() }; }
if (new URLSearchParams(location.search).has("userfx-matrix")) window.__SZ_USERFX_MATRIX__ = (events, { effectsEnabled = true } = {}) => {
  const stateBefore = JSON.stringify(state);
  const previous = cloneForHistory(state);
  const synthetic = cloneForHistory(state);
  const fixtureUid = "userfx-public-ob";
  synthetic.players.player.front.push({ uid: fixtureUid, id: "USERFX-PUBLIC-OB", category: "Ob", faceDown: false, atk: 3 });
  const fixture = document.createElement("span");
  fixture.className = "userfx-matrix-fixture";
  fixture.innerHTML = `<span data-card-uid="${fixtureUid}"><span class="cost" data-vfx-anchor="hand-cost" data-owner="player" data-zone="hand">0</span></span>`;
  root.append(fixture);
  synthetic.events = events.map((event, index) => ({ id: `USERFX-MATRIX-${index}`, type: "user_ability_feedback", ...event }));
  const transition = planVisualEffects(root, snapshotVisualState({ ...previous, events: [] }), synthetic);
  if (effectsEnabled) applyVisualEffects(root, transition);
  setTimeout(() => fixture.remove(), 1200);
  return {
    // The fixture deliberately enters the board so the discount target exists.
    // Keep that real deploy presentation in the transition, but matrix evidence
    // serializes only the synthetic ability events it supplied.
    effects: transition.effects.filter((effect) => effect.type === "user-ability").map((effect) => ({ sourceEventId: effect.sourceEventId, abilityKey: effect.abilityKey, branch: effect.branch, ownerPlayerId: effect.ownerPlayerId, profile: effect.profile, steps: (effect.steps ?? []).map((step) => step.kind), targets: (effect.steps ?? []).flatMap((step) => [step.target, step.from, step.to].filter(Boolean).map((target) => `${target.kind}:${target.playerId}:${target.metric ?? target.zone ?? target.status}:${target.cardUid ?? ""}`)), label: effect.label })),
    records: [...document.querySelectorAll(".vfx-ability-anchor")].map((overlay) => ({ sourceEventId: overlay.dataset.vfxSourceEventId, abilityKey: overlay.dataset.vfxAbilityKey, branch: overlay.dataset.vfxBranch, ownerPlayerId: overlay.dataset.vfxOwner, affectedPlayerId: overlay.dataset.vfxAffectedPlayer, targetPlayerId: overlay.dataset.vfxTargetPlayer, target: overlay.dataset.vfxTarget, cardUid: overlay.dataset.vfxCardUid, stepIndex: overlay.dataset.vfxStepIndex, role: overlay.dataset.vfxEndpointRole, text: overlay.textContent.replace(/\s+/g, " ").trim() })),
    stateBefore,
    stateAfter: JSON.stringify(state),
    stateUnchanged: stateBefore === JSON.stringify(state)
  };
};

const waitForPresentation = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function runPacedAiTurn(playerId = "ai", timings = {}) {
  if (mobileUi.aiPacing?.active || state.winner || state.active !== playerId) return false;
  aiStartedState = state;
  aiStartedTurn = state.turnNumber;
  const runId = ++aiPacingRun;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stepDelay = reducedMotion ? 0 : Math.max(0, Number(timings.stepDelay ?? AI_STEP_DELAY_MS));
  const minimumDuration = reducedMotion ? 0 : Math.max(0, Number(timings.minimumDuration ?? AI_TURN_MINIMUM_MS));
  const startedAt = performance.now();
  mobileUi.aiPacing = { active: true, index: 0, label: "行動を選択中" };
  render();
  aiTurnIterator ??= runSimpleAiTurnSteps(state, playerId);
  for (let next = aiTurnIterator.next(); !next.done; next = aiTurnIterator.next()) {
    const step = next.value;
    if (runId !== aiPacingRun) return false;
    if (step.type === "await-input") {
      mobileUi.aiPacing = null;
      live.notice = "待機中の選択・発動確認を終えるとCPUが再開します。";
      render();
      return false;
    }
    mobileUi.aiPacing = { active: true, index: mobileUi.aiPacing.index + 1, label: step.label, type: step.type };
    render();
    if (stepDelay) await waitForPresentation(stepDelay);
    if (runId !== aiPacingRun) return false;
  }
  if (runId !== aiPacingRun) return false;
  aiTurnIterator = null;
  const remaining = minimumDuration - (performance.now() - startedAt);
  if (remaining > 0) await waitForPresentation(remaining);
  if (runId !== aiPacingRun) return false;
  mobileUi.aiPacing = null;
  render();
  return true;
}

function render() {
  const aiControlled = state && (state.mode === "ai" || state.mode === "sandbox" && state.sandboxUi?.opponentControl === "ai");
  const choiceOwner = state?.pending?.type === "selection"
    ? state.pending.request?.continuation?.playerId : state?.pending?.playerId;
  if (aiControlled && choiceOwner === "ai") resolveAutomatedAiChoices(state, "ai");
  deckBuilder.view = refreshed ? live.view : "pc";
  deckBuilder.effectsEnabled = mobileUi.effectsEnabled;
  if (refreshed) completeDeferredTutorialAction();
  if (refreshed && state.mode === "tutorial" && tutorialFlow?.complete && canLeaveTutorial(state)) {
    leaveTutorial(state);
    tutorialFlow = null;
    live.draft = null;
    live.notice = "チュートリアル完了。その盤面のまま両側を手動操作できます。";
  }
  if (refreshed) {
    const visualTransition = planVisualEffects(root, visualSnapshot, state, presentationQueue);
    const presentation = state.mode === "tutorial" && tutorialFlow ? currentTutorialPresentation(tutorialFlow) : null;
    if (presentation?.focus?.some(item => item.kind === "card" && item.zone === "hand")) live.handOpen = true;
    const scroll = root.querySelector(".hand-scroll")?.scrollLeft ?? 0;
    const deckViewport = captureDeckViewport(root);
    // Engine objects mutate in place. Never reuse projections across a game render.
    detailCache.invalidate(); layoutCache.invalidate();
    const entryCrtEnabled = entryCrtActive();
    const html = liveHtml(state, tutorialFlow, { ...mobileUi, ...live, entryCrtMenu: entryCrtEnabled, playerDeckId: selectedPlayerDeck, aiDeckId: selectedAiDeck, playerUserId: selectedPlayerUser, aiUserId: selectedAiUser, fullscreen: isFullscreen(document) }, detailCache);
    clearRenderBindings();
    // Mode/layout/new-match changes remount; normal game updates keep the shell.
    if (interactionContext?.state === state && interactionContext.view === live.view && interactionContext.screen === live.screen) patchHtml(root, html);
    else root.innerHTML = html;
    interactionPatcher.reset();
    interactionContext = { state, actor: actorFor(state), view: live.view, screen: live.screen };
    document.body.dataset.view = live.view;
    syncEntryLogoGlitch(root, mobileUi.effectsEnabled && live.screen === "entry" && !deckBuilder.open,
      { profile: mobileUi.logoNoiseProfile, videoFile: entryLogoVideoFile, capture: entryCrtEnabled });
    syncEntryCrtViewport(root, entryCrtEnabled, { menuOpen: live.options, view: live.view, fullscreen: isFullscreen(document), tapDetails: live.tapDetails, effectsEnabled: mobileUi.effectsEnabled, masterVolume: mobileUi.masterVolume, onReadyChange: syncInputLocks });
    syncResultFx(root, mobileUi.effectsEnabled);
    bindEvents();
    bindLiveEvents();
    syncInputLocks();
    const hand = root.querySelector(".hand-scroll");
    if (hand) hand.scrollLeft = scroll;
    positionLive();
    restoreDeckViewport(root, deckViewport);
    if (mobileUi.effectsEnabled) applyVisualEffects(root, visualTransition);
    presentationQueue = [];
    visualSnapshot = visualTransition.next;
    if (aiTurnIterator && !mobileUi.aiPacing?.active && !resolutionBusy(state) && !aiResumeScheduled) {
      aiResumeScheduled = true;
      setTimeout(() => { aiResumeScheduled = false; if (aiTurnIterator) void runPacedAiTurn("ai"); }, 0);
    }
    // An end-phase choice may itself advance into the CPU turn. Its handler
    // only renders the continuation, so start that new turn here exactly once.
    if (shouldAutoStartAiTurn(state, { iterator: aiTurnIterator, pacing: mobileUi.aiPacing?.active, startedState: aiStartedState, startedTurn: aiStartedTurn }) && !aiAutoStartScheduled) {
      aiAutoStartScheduled = true;
      setTimeout(() => {
        aiAutoStartScheduled = false;
        if (shouldAutoStartAiTurn(state, { iterator: aiTurnIterator, pacing: mobileUi.aiPacing?.active, startedState: aiStartedState, startedTurn: aiStartedTurn })) void runPacedAiTurn("ai");
      }, 0);
    }
    return;
  }
  const tutorialStepKey = state.mode === "tutorial" && tutorialFlow
    ? tutorialFlow.introComplete ? `${tutorialFlow.tutorialId}:${tutorialFlow.index}` : `intro:${tutorialFlow.introIndex}`
    : null;
  if (tutorialStepKey && mobileUi.tutorialPresentedStep !== tutorialStepKey) {
    mobileUi.tutorialPresentedStep = tutorialStepKey;
    mobileUi.tutorialOverlayOpen = true;
  }
  const visualTransition = planVisualEffects(root, visualSnapshot, state, presentationQueue);
  clearRenderBindings();
  const hand = root.querySelector?.(".hand-scroll");
  const catalog = root.querySelector?.(".catalog-scroll");
  const deckBuilderPanel = root.querySelector?.(".deck-builder");
  const deckCardList = root.querySelector?.(".deck-card-list");
  if (hand) savedScroll.hand = hand.scrollLeft;
  if (catalog) savedScroll.catalog = catalog.scrollTop;
  if (deckBuilderPanel) savedScroll.deckBuilder = deckBuilderPanel.scrollTop;
  if (deckCardList) savedScroll.deckCards = deckCardList.scrollTop;
  renderApp(root, state, tutorialFlow, mobileUi);
  bindEvents();
  if (mobileUi.tutorialOverlayOpen) requestAnimationFrame(() => root.querySelector("[data-tutorial-overlay-dismiss]")?.focus());
  const nextHand = root.querySelector(".hand-scroll");
  const nextCatalog = root.querySelector(".catalog-scroll");
  const nextDeckBuilderPanel = root.querySelector(".deck-builder");
  const nextDeckCardList = root.querySelector(".deck-card-list");
  const nextBoard = root.querySelector(".battle-board");
  if (nextHand) nextHand.scrollLeft = savedScroll.hand;
  if (nextCatalog) nextCatalog.scrollTop = savedScroll.catalog;
  if (nextDeckBuilderPanel) nextDeckBuilderPanel.scrollTop = savedScroll.deckBuilder;
  if (nextDeckCardList) nextDeckCardList.scrollTop = savedScroll.deckCards;
  if (nextBoard) {
    if (savedScroll.board === null && window.matchMedia("(orientation: landscape) and (max-width: 1180px) and (max-height: 600px)").matches) {
      requestAnimationFrame(() => {
        const opponentBack = nextBoard.querySelector(".side.opponent .zone-back");
        const desired = opponentBack ? opponentBack.offsetTop + opponentBack.offsetHeight * .7 : (nextBoard.scrollHeight - nextBoard.clientHeight) / 2;
        nextBoard.scrollTop = Math.max(0, Math.min(nextBoard.scrollHeight - nextBoard.clientHeight, desired));
        savedScroll.board = nextBoard.scrollTop;
      });
    } else if (savedScroll.board !== null) {
      nextBoard.scrollTop = savedScroll.board;
    }
    nextBoard.addEventListener("scroll", () => { savedScroll.board = nextBoard.scrollTop; }, { passive: true });
  }
  if (mobileUi.effectsEnabled) applyVisualEffects(root, visualTransition);
  presentationQueue = [];
  visualSnapshot = visualTransition.next;
}

function renderSelection() {
  // Deferred tutorial transitions and engine-owned choices retain the old path.
  if (!refreshed || live.screen !== "game" || live.options || live.catalog || live.log || state.deckBuilder?.open
      || resolutionBusy(state) || mobileUi.aiPacing?.active || tutorialFlow?.pendingAction || tutorialFlow?.complete
      || interactionContext?.state !== state || interactionContext.actor !== actorFor(state) || interactionContext.view !== live.view) return render();
  const ui = { ...mobileUi, ...live, fullscreen: isFullscreen(document) };
  const regions = interactionPatcher.patch(root, liveInteractionHtml(state, tutorialFlow, ui, detailCache));
  regions.push(...updateSelectionMarkers(root, { ...state, viewerId: actorFor(state), pending: live.draft ?? state.pending }));
  clearRenderBindings(true);
  for (const scope of regions) { bindEvents(scope); bindLiveEvents(scope); }
  root.querySelectorAll("main, .r2-utilities, .r2-overlays").forEach(node => { node.inert = live.uniqueOpen; });
  const hand = root.querySelector('[data-layer="hand"]');
  if (hand) hand.hidden = !live.handOpen;
  const toggle = root.querySelector('[data-live="hand"]');
  if (toggle) toggle.textContent = live.handOpen ? "手札を畳む" : "手札を開く";
  positionLive();
}

function syncDeckUi() {
  state.savedDecks = savedDecks;
  state.deckBuilder = deckBuilder;
  render();
}

function newDeckDraft() {
  deckBuilder.draft = normalizeSavedDeck({ id: "", name: "新規デッキ", userId: "doors_zx", cards: {} }, "");
}

function tutorialCommit(action, mutate) {
  live.draft = null;
  if (refreshed && state.mode === "tutorial" && !tutorialFlow?.complete && !isTutorialActionExpected(tutorialFlow, action)) {
    acceptTutorialAction(state, tutorialFlow, action);
    render();
    return false;
  }
  remember(state);
  const ok = mutate();
  if (!ok) {
    state.history.pop();
    if (refreshed) live.notice = state.message || "操作条件を満たしていません。";
    render();
    return false;
  }
  if (state.mode === "tutorial" && tutorialFlow?.complete) {
    render();
    return true;
  }
  if (state.mode === "tutorial" && (state.pending || refreshed && resolutionBusy(state))) {
    if (!isTutorialActionExpected(tutorialFlow, action)) {
      state = undo(state);
      state.pending = null;
      acceptTutorialAction(state, tutorialFlow, action);
      render();
      return false;
    }
    tutorialFlow.pendingAction = action;
    render();
    return true;
  }
  if (state.mode === "tutorial" && !acceptTutorialAction(state, tutorialFlow, action)) {
    state = undo(state);
    state.pending = null;
    render();
    return false;
  }
  render();
  return true;
}

function completeDeferredTutorialAction() {
  if (state.mode !== "tutorial" || resolutionBusy(state) || !tutorialFlow?.pendingAction) return false;
  const action = tutorialFlow.pendingAction;
  if (action.type === "end-turn" && state.active === "player") return false;
  tutorialFlow.pendingAction = null;
  return acceptTutorialAction(state, tutorialFlow, action);
}

function prepareAttack(card) {
  const playerId = controlledPlayerId();
  const validTargets = getAttackTargets(state, playerId, card).map((item) => item.uid);
  // チュートリアルでは「ユーザーを攻撃宣言→セキュリティへ強制変更」の順番を体験させる。
  if (state.mode === "tutorial" && !validTargets.includes("ai-fortress")) validTargets.push("ai-fortress");
  prepareInput({ type: "attack", sourceUid: card.uid, validTargets });
  state.selectedUid = card.uid;
  renderSelection();
}

function prepareSpell(card, continuationType = "play-card") {
  if (card.id === "STD-211") {
    const request = createSelectionRequest({
      mode: "scope", scopeField: "class", scopeOptions: collectDeckScopeOptions(state, "class"),
      label: "破壊するクラスを指定", message: "両者のデッキ内容に存在するクラスから選択。",
      continuation: { type: "play-card", sourceUid: card.uid, targetArgument: "selectionScope" }
    });
    prepareInput({ type: "selection", validTargets: [], request });
  } else if (card.id === "STD-203") {
    const playerId = controlledPlayerId();
    const opponentId = opposingPlayerId();
    const own = [...state.players[playerId].front, ...state.players[playerId].back].filter(isObCard).map((item) => item.uid);
    const enemy = [...state.players[opponentId].front, ...state.players[opponentId].back].filter(isObCard).map((item) => item.uid);
    const request = createSelectionRequest({
      mode: "exact", candidates: [...own, ...enemy], count: 2,
      label: "破壊する自分Obと、ダメージ対象の相手Obを選択", message: card.text,
      groups: [
        { id: "own", label: "自分Ob", candidates: own, minimum: 1, maximum: 1 },
        { id: "enemy", label: "相手Ob", candidates: enemy, minimum: 1, maximum: 1 }
      ],
      continuation: { type: continuationType, sourceUid: card.uid, targetArgument: "targetUids" }
    });
    prepareInput({ type: "selection", validTargets: request.candidates, request });
  } else {
    const targetPlayerId = card.id === "STD-111" ? controlledPlayerId() : opposingPlayerId();
    const candidates = getEffectTargets(state, targetPlayerId, card).map((item) => item.uid);
    if (card.id === "STD-015" && candidates.length === 0) {
      tutorialCommit({ type: "play", cardId: card.id }, () => playCard(state, controlledPlayerId(), card.uid));
      render();
      return;
    }
    const request = createSelectionRequest({
      mode: "single", candidates, count: 1, label: "スペルの対象を1枚選択", message: card.text,
      continuation: { type: continuationType, sourceUid: card.uid, targetArgument: "targetUid" }
    });
    prepareInput({ type: "selection", validTargets: request.candidates, request });
  }
  state.selectedUid = card.uid;
  renderSelection();
}

function prepareMount(card) {
  const playerId = controlledPlayerId();
  prepareInput({
    type: "mount-base",
    sourceUid: card.uid,
    validTargets: [...state.players[playerId].front, ...state.players[playerId].back]
      .filter((item) => item.category === "Code")
      .map((item) => item.uid)
  });
  state.selectedUid = card.uid;
  renderSelection();
}

function prepareCodeUnder(card) {
  const playerId = controlledPlayerId();
  prepareInput({
    type: "code-under",
    sourceUid: card.uid,
    validTargets: [...state.players[playerId].front, ...state.players[playerId].back]
      .filter(isObCard)
      .map((item) => item.uid)
  });
  state.selectedUid = card.uid;
  renderSelection();
}

function prepareLayered(card, zone) {
  const candidates = getLayeredCandidates(state, controlledPlayerId(), card);
  const requirement = getLayeredRequirement(card);
  prepareInput({
    type: "layered-select",
    sourceUid: card.uid,
    zone,
    validTargets: candidates.map((entry) => entry.card.uid),
    selectedTargets: [],
    requirement
  });
  state.selectedUid = card.uid;
  renderSelection();
}

function prepareEffectChoice(card) {
  const effects = getActivatableEffects(state, controlledPlayerId(), card);
  if (!effects.length) return;
  prepareInput({ type: "effect-choice", sourceUid: card.uid, effects });
  state.selectedUid = card.uid;
  renderSelection();
}

function chooseEffect(effectId) {
  const pending = currentPending();
  if (pending?.type !== "effect-choice") return;
  const source = findCard(state, pending.sourceUid)?.card;
  const effect = pending.effects.find((item) => item.id === effectId);
  if (!source || !effect?.enabled) return;
  const playerId = controlledPlayerId();
  const targets = getEffectActivationTargets(state, playerId, source, effectId);
  if (source.id === "STD-196") {
    const request = createSelectionRequest({
      mode: "exact", candidates: targets.map((card) => card.uid), count: 2,
      label: "効果の対象を2体選択", message: "必ず2体選択してから確定。",
      continuation: { type: "activate-effect", sourceUid: source.uid, effectId, targetArgument: "targetUids" }
    });
    prepareInput({ type: "selection", validTargets: request.candidates, request });
  } else if (targets.length) {
    const request = createSelectionRequest({
      mode: "single", candidates: targets.map((card) => card.uid), count: 1,
      label: "効果の対象を1体選択", message: "対象を選んで確定。",
      continuation: { type: "activate-effect", sourceUid: source.uid, effectId, targetArgument: "targetUid" }
    });
    prepareInput({ type: "selection", validTargets: request.candidates, request });
  } else if (source.id === "STD-200") {
    prepareInput({ type: "effect-move-zone", sourceUid: source.uid, effectId, targetUid: source.uid });
  } else {
    tutorialCommit({ type: "activate-effect", cardId: source.id, effectId }, () => activateCardEffect(state, playerId, source.uid, effectId));
    return;
  }
  renderSelection();
}

function resolvePendingTarget(targetUid, targetType = "card") {
  const playerId = controlledPlayerId();
  const pending = currentPending();
  if (!pending?.validTargets.includes(targetUid)) return;
  const source = findCard(state, pending.sourceUid)?.card;
  if (!source) return;
  clearInput();
  if (pending.type === "attack") {
    tutorialCommit({ type: "attack", cardId: source.id, targetType }, () => attack(state, playerId, source.uid, targetUid));
  } else if (pending.type === "spell") {
    const target = findCard(state, targetUid)?.card;
    tutorialCommit({ type: "play", cardId: source.id, targetCardId: target?.id }, () => playCard(state, playerId, source.uid, { targetUid }));
  } else if (pending.type === "mount-base") {
    const base = findCard(state, targetUid);
    if (!base || !["front", "back"].includes(base.zoneName)) return render();
    tutorialCommit(
      { type: "play", cardId: source.id, zone: base.zoneName },
      () => playCard(state, playerId, source.uid, { zone: base.zoneName, baseUid: targetUid })
    );
  } else if (pending.type === "code-under") {
    const upper = findCard(state, targetUid);
    if (!upper || !["front", "back"].includes(upper.zoneName)) return render();
    const ok = playCard(state, playerId, source.uid, {
      zone: upper.zoneName,
      underUid: targetUid,
      free: Boolean(source.dragFree)
    });
    if (ok) state.selectedUid = targetUid;
    render();
  } else if (pending.type === "lucky-sacrifice") {
    resolveLuckyShotAdditional(state, playerId, targetUid);
    state.selectedUid = null;
    completeDeferredTutorialAction();
    render();
  } else if (pending.type === "sam-discard") {
    resolveSamLogin(state, playerId, targetUid);
    state.selectedUid = pending.sourceUid;
    render();
  } else if (pending.type === "effect-target") {
    state.pending = { type: "effect-move-zone", sourceUid: source.uid, effectId: pending.effectId, targetUid };
    render();
  } else if (pending.type === "response-target") {
    activateResponse(state, pending.playerId, pending.cardUid, targetUid);
    state.selectedUid = null;
    render();
  }
}

function bindEvents(scope = root) {
  if (mobileUi.aiPacing?.active) return;
  scope.querySelectorAll("[data-tutorial-position]").forEach((button) => bindOn(button, "click", () => {
    mobileUi.tutorialOverlayPosition = button.dataset.tutorialPosition === "top" ? "top" : "bottom";
    render();
  }));
  scope.querySelectorAll("[data-mobile-hand-toggle]").forEach((button) => bindOn(button, "click", () => { mobileUi.handOpen = !mobileUi.handOpen; render(); }));
  scope.querySelectorAll("[data-art-preview-open]").forEach((button) => bindOn(button, "click", () => {
    mobileUi.artPreviewUid = button.dataset.artPreviewOpen;
    render();
    requestAnimationFrame(() => root.querySelector(".art-preview-dialog [data-art-preview-close]")?.focus());
  }));
  scope.querySelectorAll("[data-art-preview-close]").forEach((element) => bindOn(element, "click", (event) => {
    event.stopPropagation();
    mobileUi.artPreviewUid = null;
    render();
    requestAnimationFrame(() => root.querySelector(`[data-art-preview-open="${CSS.escape(state.selectedUid ?? "")}"]`)?.focus());
  }));
  scope.querySelectorAll(".art-preview-dialog").forEach((dialog) => bindOn(dialog, "click", (event) => event.stopPropagation()));
  if (artPreviewKeyHandler) window.removeEventListener("keydown", artPreviewKeyHandler);
  artPreviewKeyHandler = (event) => {
    if (event.key !== "Escape" || !mobileUi.artPreviewUid) return;
    mobileUi.artPreviewUid = null;
    render();
  };
  bindOn(window, "keydown", artPreviewKeyHandler);
  if (mobileDetailOutsideHandler) root.removeEventListener("click", mobileDetailOutsideHandler);
  mobileDetailOutsideHandler = (event) => {
    if (!root.querySelector("[data-mobile-detail-layer]")) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".mobile-inspector,[data-card-uid],[data-fortress]")) return;
    state.selectedUid = null;
    render();
  };
  bindOn(root, "click", mobileDetailOutsideHandler);
  scope.querySelectorAll("[data-deck-open]").forEach((button) => bindOn(button, "click", () => { live.options = false; deckBuilder.open = true; syncDeckUi(); }));
  scope.querySelectorAll("[data-toggle-effects]").forEach((button) => bindOn(button, "click", () => {
    mobileUi.effectsEnabled = !mobileUi.effectsEnabled;
    localStorage.setItem(EFFECTS_STORAGE_KEY, mobileUi.effectsEnabled ? "on" : "off");
    render();
  }));
  scope.querySelectorAll("[data-volume]").forEach((button) => bindOn(button, "click", () => {
    const step = Number(button.dataset.volume);
    mobileUi.masterVolume = mobileUi.masterVolume === step ? step - 1 : step;
    localStorage.setItem("sz-master-volume", String(mobileUi.masterVolume));
    render();
  }));
  scope.querySelectorAll("[data-title-tap-details]").forEach((button) => bindOn(button, "click", () => {
    live.tapDetails = !live.tapDetails;
    render();
  }));
  scope.querySelectorAll('[data-logo-profile]').forEach(select => bindOn(select, 'change', () => {
    mobileUi.logoNoiseProfile = select.value;
    localStorage.setItem('sz-logo-noise-profile', select.value);
    render();
  }));
  scope.querySelectorAll('[data-logo-video]').forEach(input => bindOn(input, 'change', () => {
    entryLogoVideoFile = input.files?.[0] ?? null;
    mobileUi.logoVideoName = entryLogoVideoFile?.name ?? '';
    render();
  }));
  scope.querySelectorAll('[data-logo-video-clear]').forEach(button => bindOn(button, 'click', () => {
    entryLogoVideoFile = null; mobileUi.logoVideoName = ''; render();
  }));
  scope.querySelectorAll("[data-deck-close]").forEach((button) => bindOn(button, "click", () => { deckBuilder.open = false; deckBuilder.detailId = null; syncDeckUi(); }));
  scope.querySelectorAll("[data-deck-management]").forEach((button) => bindOn(button, "click", () => { deckBuilder.managementOpen = !deckBuilder.managementOpen; syncDeckUi(); }));
  scope.querySelectorAll("[data-deck-category]").forEach((button) => bindOn(button, "click", () => { deckBuilder.category = button.dataset.deckCategory; syncDeckUi(); }));
  scope.querySelectorAll("[data-deck-detail]").forEach((button) => bindOn(button, "click", () => { deckBuilder.detailId = button.dataset.deckDetail; syncDeckUi(); root.querySelector("[data-deck-detail-close]")?.focus(); }));
  scope.querySelectorAll("[data-deck-detail-close]").forEach((button) => bindOn(button, "click", () => { deckBuilder.detailId = null; syncDeckUi(); }));
  scope.querySelectorAll(".deck-mobile-card, .deck-catalog-card, .deck-summary-card[data-deck-summary-id]").forEach((tile) => {
    let timer, start;
    const cancel = () => { clearTimeout(timer); start = null; };
    const open = () => { if (!tile.isConnected) return; deckPressSuppressedUntil = performance.now() + 800; deckBuilder.detailId = tile.dataset.deckCardId ?? tile.dataset.deckSummaryId; syncDeckUi(); root.querySelector("[data-deck-detail-close]")?.focus(); };
    bindOn(tile, "pointerdown", event => { if (!event.isPrimary || event.button !== 0) return; start = [event.clientX,event.clientY]; timer = setTimeout(open,480); });
    bindOn(tile, "pointermove", event => { if (start && Math.hypot(event.clientX-start[0],event.clientY-start[1]) > 8) cancel(); });
    for (const name of ["pointerup","pointercancel","pointerleave"]) bindOn(tile,name,cancel);
    bindOn(tile,"contextmenu",event=>{event.preventDefault();cancel();open();});
  });
  scope.querySelectorAll(".deck-detail-overlay").forEach(overlay => bindOn(overlay,"keydown",event=>{
    if(event.key === "Escape"){event.preventDefault();deckBuilder.detailId=null;syncDeckUi();}
    if(event.key === "Tab") {const buttons=[...overlay.querySelectorAll('button:not(:disabled)')];const first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  }));
  scope.querySelectorAll("[data-deck-new]").forEach((button) => bindOn(button, "click", () => { newDeckDraft(); syncDeckUi(); }));
  scope.querySelectorAll("[data-deck-load]").forEach((select) => bindOn(select, "change", () => {
    const found = savedDecks.find((deck) => deck.id === select.value); deckBuilder.draft = found ? structuredClone(found) : normalizeSavedDeck({}, ""); syncDeckUi();
  }));
  scope.querySelectorAll("[data-deck-name]").forEach((input) => bindOn(input, "input", () => { deckBuilder.draft.name = input.value; }));
  scope.querySelectorAll("[data-deck-user]").forEach((select) => bindOn(select, "change", () => { deckBuilder.draft.userId = select.value; syncDeckUi(); }));
  scope.querySelectorAll("[data-deck-query]").forEach((input) => bindOn(input, "input", () => { deckBuilder.query = input.value; syncDeckUi(); root.querySelector("[data-deck-query]")?.focus(); }));
  scope.querySelectorAll("[data-deck-color]").forEach((select) => bindOn(select, "change", () => { deckBuilder.color = select.value; syncDeckUi(); }));
  scope.querySelectorAll("[data-deck-recommend-color]").forEach((select) => bindOn(select, "change", () => { deckBuilder.recommendColor = select.value; syncDeckUi(); }));
  scope.querySelectorAll("[data-deck-strategy]").forEach((select) => bindOn(select, "change", () => { deckBuilder.strategy = select.value; syncDeckUi(); }));
  scope.querySelectorAll("[data-deck-recommend]").forEach((button) => bindOn(button, "click", () => {
    const result = recommendDeck({ userId: deckBuilder.draft.userId, color: deckBuilder.recommendColor, strategy: deckBuilder.strategy });
    deckBuilder.draft.cards = result.cards; deckBuilder.recommendationNote = result.explanation; syncDeckUi();
  }));
  scope.querySelectorAll("[data-deck-plus]").forEach((button) => bindOn(button, "click", () => { if(performance.now()<deckPressSuppressedUntil)return; const id = button.dataset.deckPlus; deckBuilder.draft.cards[id] = Number(deckBuilder.draft.cards[id] ?? 0) + 1; syncDeckUi(); }));
  scope.querySelectorAll("[data-deck-minus]").forEach((button) => bindOn(button, "click", () => { if(performance.now()<deckPressSuppressedUntil)return; const id = button.dataset.deckMinus; deckBuilder.draft.cards[id] = Math.max(0, Number(deckBuilder.draft.cards[id] ?? 0) - 1); syncDeckUi(); }));
  scope.querySelectorAll("[data-deck-save]").forEach((button) => bindOn(button, "click", () => {
    const draft = normalizeSavedDeck(deckBuilder.draft, deckBuilder.draft.id || `deck-${Date.now()}`);
    if (!validateDeck(draft).valid) return;
    const index = savedDecks.findIndex((deck) => deck.id === draft.id);
    if (index < 0 && savedDecks.length >= MAX_SAVED_DECKS) return;
    if (index >= 0) savedDecks[index] = draft; else savedDecks.push(draft);
    savedDecks = saveDeckCollection(savedDecks); deckBuilder.draft = structuredClone(draft); syncDeckUi();
  }));
  scope.querySelectorAll("[data-deck-delete]").forEach((button) => bindOn(button, "click", () => {
    savedDecks = saveDeckCollection(savedDecks.filter((deck) => deck.id !== deckBuilder.draft.id)); newDeckDraft(); syncDeckUi();
  }));
  scope.querySelectorAll("[data-deck-export]").forEach((button) => bindOn(button, "click", () => {
    const blob = new Blob([JSON.stringify(savedDecks, null, 2)], { type: "application/json" }); const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = "simple-zeke-decks.json"; link.click(); URL.revokeObjectURL(link.href);
  }));
  scope.querySelectorAll("[data-deck-import]").forEach((input) => bindOn(input, "change", async () => {
    try { const parsed = JSON.parse(await input.files?.[0]?.text()); if (!Array.isArray(parsed)) return; savedDecks = saveDeckCollection(parsed); newDeckDraft(); syncDeckUi(); } catch { /* invalid JSON is ignored */ }
  }));
  scope.querySelectorAll("[data-mode]").forEach((button) => bindOn(button, "click", () => init(button.dataset.mode)));
  scope.querySelectorAll("[data-tutorial-select]").forEach((select) => bindOn(select, "change", () => init("tutorial", select.value)));
  scope.querySelectorAll("[data-player-deck]").forEach((select) => bindOn(select, "change", () => {
    selectedPlayerDeck = select.value;
    const custom = savedDecks.find((deck) => `custom:${deck.id}` === select.value); if (custom) selectedPlayerUser = custom.userId;
    if (refreshed && live.screen === "entry") render(); else init(state.mode === "sandbox" ? "sandbox" : "ai");
  }));
  scope.querySelectorAll("[data-ai-deck]").forEach((select) => bindOn(select, "change", () => {
    selectedAiDeck = select.value;
    const custom = savedDecks.find((deck) => `custom:${deck.id}` === select.value); if (custom) selectedAiUser = custom.userId;
    if (refreshed && live.screen === "entry") render(); else init(state.mode === "sandbox" ? "sandbox" : "ai");
  }));
  scope.querySelectorAll("[data-player-user]").forEach((select) => bindOn(select, "change", () => {
    selectedPlayerUser = select.value;
    if (refreshed && live.screen === "entry") render(); else init(state.mode === "sandbox" ? "sandbox" : "ai");
  }));
  scope.querySelectorAll("[data-ai-user]").forEach((select) => bindOn(select, "change", () => {
    selectedAiUser = select.value;
    if (refreshed && live.screen === "entry") render(); else init(state.mode === "sandbox" ? "sandbox" : "ai");
  }));
  scope.querySelectorAll("[data-card-uid]").forEach((button) => bindOn(button, "click", () => {
    if (refreshed && live.suppressClick) return;
    mobileUi.artPreviewUid = null;
    if (button.closest(".hand")) mobileUi.handOpen = false;
    const uid = button.dataset.cardUid;
    const pending = currentPending();
    if (pending?.type === "selection" && pending.validTargets.includes(uid)) {
      toggleSelection(pending.request, uid);
      return renderSelection();
    }
    if (pending?.type === "layered-select" && pending.validTargets.includes(uid)) {
      const selected = pending.selectedTargets;
      pending.selectedTargets = selected.includes(uid) ? selected.filter((item) => item !== uid) : [...selected, uid];
      return renderSelection();
    }
    if (pending?.type === "effect-target-multi" && pending.validTargets.includes(uid)) {
      const selected = pending.selectedTargets;
      pending.selectedTargets = selected.includes(uid) ? selected.filter((item) => item !== uid) : [...selected, uid];
      return renderSelection();
    }
    if (pending && pending.validTargets?.includes(uid)) return resolvePendingTarget(uid, "card");
    if (state.pending) return;
    if (refreshed && resolutionBusy(state)) return;
    if (refreshed) {
      // A normal tap transfers the operation; long-press only changes inspection.
      live.draft = null;
      if (live.tapDetails) live.detailUid = uid;
    }
    state.selectedUid = refreshed || button.classList.contains("admin-list-card") ? uid : (state.selectedUid === uid ? null : uid);
    renderSelection();
  }));
  scope.querySelectorAll("[data-fortress]").forEach((button) => bindOn(button, "click", () => {
    const playerId = button.dataset.fortress;
    if (currentPending()?.validTargets?.includes(`${playerId}-fortress`)) return resolvePendingTarget(`${playerId}-fortress`, "fortress");
    if (state.pending) return;
    state.selectedUid = `${playerId}-user-card`;
    if (refreshed) live.detailUid = state.selectedUid;
    renderSelection();
  }));
  scope.querySelectorAll("[data-admin-zone]").forEach((button) => bindOn(button, "click", () => {
    const next = { playerId: button.dataset.owner, zoneName: button.dataset.adminZone };
    state.openAdmin = state.openAdmin?.playerId === next.playerId && state.openAdmin?.zoneName === next.zoneName ? null : next;
    render();
  }));
  scope.querySelectorAll("[data-plugin-number]").forEach((button) => bindOn(button, "click", () => {
    const prompt = state.prompt;
    if (prompt?.type === "plugin-number") configurePlugin(state, prompt.playerId, prompt.pluginUid, Number(button.dataset.pluginNumber));
    render();
  }));
  scope.querySelectorAll("[data-effect-id]").forEach((button) => bindOn(button, "click", () => chooseEffect(button.dataset.effectId)));
  scope.querySelectorAll("[data-response-card]").forEach((button) => bindOn(button, "click", () => {
    const playerId = state.pending?.playerId;
    const uid = button.dataset.responseCard;
    if (activateResponse(state, playerId, uid)) presentationQueue.push({ type: "response-declared", uid, playerId, label: "RESPONSE" });
    render();
  }));
  scope.querySelectorAll("[data-trigger-item]").forEach((button) => bindOn(button, "click", () => {
    const uid = state.triggerThread?.items?.find((item) => item.id === button.dataset.triggerItem)?.trigger?.source?.card?.uid;
    if (resolveTriggerChoice(state, button.dataset.triggerItem)) presentationQueue.push({ type: "trigger-declared", uid, label: "TRIGGER" });
    render();
  }));
  scope.querySelectorAll("[data-selection-scope]").forEach((select) => bindOn(select, "change", () => {
    if (currentPending()?.type === "selection") setSelectionScope(currentPending().request, select.value);
    renderSelection();
  }));
  scope.querySelectorAll('[data-live="selection-fold"]').forEach((button) => bindOn(button, "click", () => {
    const request = currentPending()?.type === "selection" ? currentPending().request : null;
    if (!request) return;
    live.selectionCollapsedFor = live.selectionCollapsedFor === request ? null : request;
    renderSelection();
  }));
  scope.querySelectorAll("[data-selection-option]").forEach((button) => bindOn(button, "click", () => {
    if (live.suppressClick) { live.suppressClick = false; return; }
    if (currentPending()?.type === "selection") toggleSelection(currentPending().request, button.dataset.selectionOption);
    renderSelection();
  }));
  scope.querySelectorAll("[data-selection-allocation]").forEach((input) => bindOn(input, "change", () => {
    if (currentPending()?.type === "selection") setAllocation(currentPending().request, input.dataset.selectionAllocation, input.value);
    renderSelection();
  }));
  scope.querySelectorAll("[data-access-host]").forEach((button) => bindOn(button, "click", () => {
    if (resolveAccessDragPlacement(state, controlledPlayerId(), button.dataset.accessZone, button.dataset.accessHost)) {
      completeDeferredTutorialAction();
      render();
    }
  }));
  scope.querySelectorAll("[data-catalog-card]").forEach((button) => bindOn(button, "click", () => {
    if (addSandboxCardToHand(state, state.sandboxUi?.catalogOwner ?? "player", button.dataset.catalogCard)) render();
  }));
  scope.querySelectorAll("[data-catalog-query]").forEach((input) => bindOn(input, "input", () => {
    state.sandboxUi.query = input.value;
    render();
    root.querySelector("[data-catalog-query]")?.focus();
  }));
  scope.querySelectorAll("[data-catalog-expansion]").forEach((select) => bindOn(select, "change", () => {
    state.sandboxUi.expansion = select.value;
    savedScroll.catalog = 0;
    render();
  }));
  scope.querySelectorAll("[data-catalog-owner]").forEach((select) => bindOn(select, "change", () => {
    state.sandboxUi.catalogOwner = select.value;
    render();
  }));
  scope.querySelectorAll("[data-sandbox-actor]").forEach((select) => bindOn(select, "change", () => {
    if (refreshed && (resolutionBusy(state) || live.draft)) return;
    state.sandboxUi.actor = select.value;
    state.active = select.value;
    state.selectedUid = null;
    state.pending = null;
    render();
  }));
  scope.querySelectorAll("[data-opponent-control]").forEach((select) => bindOn(select, "change", () => {
    if (refreshed && (resolutionBusy(state) || live.draft)) return;
    state.sandboxUi.opponentControl = select.value;
    if (select.value === "ai") {
      state.sandboxUi.actor = "player";
      if (!refreshed) state.active = "player";
    }
    state.selectedUid = null;
    render();
    if (refreshed && select.value === "ai" && state.active === "ai") void runPacedAiTurn("ai");
  }));
  scope.querySelectorAll("[data-action]").forEach((button) => bindOn(button, "click", () => handleAction(button.dataset.action)));
}

function handleAction(action) {
  const playerId = controlledPlayerId();
  const selected = state.selectedUid ? findCard(state, state.selectedUid) : null;
  if (action === "toggle-mobile-menu") {
    mobileUi.menuOpen = !mobileUi.menuOpen;
    return render();
  }
  if (action === "dismiss-tutorial-overlay") {
    if (state.mode === "tutorial" && tutorialFlow && !tutorialFlow.introComplete) {
      advanceTutorialIntroduction(tutorialFlow);
      mobileUi.tutorialOverlayOpen = true;
      return render();
    }
    mobileUi.tutorialOverlayOpen = false;
    return render();
  }
  if (action === "tutorial-advance") {
    acceptTutorialAction(state, tutorialFlow, tutorialAdvanceAction());
    mobileUi.menuOpen = false;
    return render();
  }
  if (action === "cancel") {
    if (refreshed) return cancelLiveInput();
    if (state.mode === "tutorial" && tutorialFlow?.pendingAction) {
      tutorialFlow.pendingAction = null;
      state = undo(state);
      state.pending = null;
      return render();
    }
    state.pending = null;
    return render();
  }
  if (action === "confirm-selection") {
    const pending = currentPending();
    if (pending?.type !== "selection" || !canConfirmSelection(pending.request)) return;
    const result = confirmSelection(pending.request);
    const continuation = pending.request.continuation;
    if (!result || !continuation) return;
    if (continuation.type === "activate-effect" && continuation.targetArgument === "targetUid") {
      const source = findCard(state, continuation.sourceUid)?.card;
      if (source?.id === "STD-192") {
        prepareInput({ type: "effect-move-zone", sourceUid: source.uid, effectId: continuation.effectId, targetUid: result.selected[0] });
        return render();
      }
      clearInput();
      return tutorialCommit(
        { type: "activate-effect", cardId: source?.id, effectId: continuation.effectId },
        () => activateCardEffect(state, playerId, continuation.sourceUid, continuation.effectId, { targetUid: result.selected[0] })
      );
    }
    if (continuation.type === "activate-effect" && continuation.targetArgument === "targetUids") {
      const source = findCard(state, continuation.sourceUid)?.card;
      clearInput();
      return tutorialCommit(
        { type: "activate-effect", cardId: source?.id, effectId: continuation.effectId },
        () => activateCardEffect(state, playerId, continuation.sourceUid, continuation.effectId, { targetUids: result.selected })
      );
    }
    if (continuation.type === "play-card") {
      const source = findCard(state, continuation.sourceUid)?.card;
      clearInput();
      const options = continuation.targetArgument === "selectionScope"
        ? { selectionScope: result.scope }
        : continuation.targetArgument === "targetUids" ? { targetUids: result.selected } : { targetUid: result.selected[0] };
      return tutorialCommit(
        { type: "play", cardId: source?.id, targetCardId: findCard(state, result.selected?.[0])?.card?.id },
        () => playCard(state, playerId, continuation.sourceUid, options)
      );
    }
    if (continuation.type === "execute-registry") {
      const source = findCard(state, continuation.sourceUid)?.card;
      clearInput();
      const options = continuation.targetArgument === "targetUids" ? { targetUids: result.selected } : { targetUid: result.selected[0] };
      return tutorialCommit({ type: "registry-execute", cardId: source?.id }, () => executeRegistryCard(state, playerId, continuation.sourceUid, options));
    }
    if (continuation.type === "sam-discard") {
      return resolveSamLogin(state, playerId, result.selected[0]) && render();
    }
    if (continuation.type === "lucky-additional") {
      state.pending = null;
      if (!result.selected.length) {
        addLog(state, "ラッキー☆ショットの任意追加効果を使わなかった。", "effect");
        completeDeferredTutorialAction();
        return render();
      }
      resolveLuckyShotAdditional(state, playerId, result.selected[0]);
      completeDeferredTutorialAction();
      return render();
    }
    if (resolveCardSelection(state, continuation, result)) {
      completeDeferredTutorialAction();
      return render();
    }
  }
  if (["access-drag-front", "access-drag-back"].includes(action)) {
    const zone = action.endsWith("back") ? "back" : "front";
    if (resolveAccessDragPlacement(state, playerId, zone)) {
      completeDeferredTutorialAction();
      return render();
    }
  }
  if (action === "dismiss-thread") {
    dismissThreadNotice(state);
    return render();
  }
  if (action === "undo") {
    if (tutorialFlow) tutorialFlow.pendingAction = null;
    state = undo(state);
    return render();
  }
  if (action === "close-admin") {
    state.openAdmin = null;
    return render();
  }
  if (action === "prompt-decline") {
    declinePrompt(state);
    return render();
  }
  if (action === "response-decline") {
    declineResponse(state, state.pending?.playerId);
    return render();
  }
  if (action === "prompt-activate") {
    const prompt = state.prompt;
    if (prompt?.type === "script-activation") activateScript(state, prompt.playerId, prompt.scriptUid);
    return render();
  }
  if (action === "activate-effect") return prepareEffectChoice(selected?.card);
  if (["effect-move-front", "effect-move-back"].includes(action)) {
    const pending = currentPending();
    if (pending?.type !== "effect-move-zone") return;
    const source = findCard(state, pending.sourceUid)?.card;
    const zone = action === "effect-move-front" ? "front" : "back";
    clearInput();
    return tutorialCommit(
      { type: "activate-effect", cardId: source?.id, effectId: pending.effectId, zone },
      () => activateCardEffect(state, playerId, pending.sourceUid, pending.effectId, { targetUid: pending.targetUid, targetZone: zone })
    );
  }
  if (action === "confirm-effect-targets") {
    const pending = currentPending();
    if (pending?.type !== "effect-target-multi" || pending.selectedTargets.length !== pending.required) return;
    const source = findCard(state, pending.sourceUid)?.card;
    clearInput();
    return tutorialCommit(
      { type: "activate-effect", cardId: source?.id, effectId: pending.effectId },
      () => activateCardEffect(state, playerId, pending.sourceUid, pending.effectId, { targetUids: pending.selectedTargets })
    );
  }
  if (action === "turbo") { live.uniqueOpen = false; return tutorialCommit({ type: "turbo" }, () => activateTurbo(state, playerId)); }
  if (action === "opening-mulligan") return tutorialCommit({ type: "opening-mulligan" }, () => openingMulligan(state, playerId));
  if (action === "lucky-no") {
    addLog(state, "ラッキー☆ショットの任意追加効果を使わなかった。", "effect");
    state.pending = null;
    completeDeferredTutorialAction();
    return render();
  }
  if (action === "lucky-yes") {
    state.pending = {
      type: "lucky-sacrifice",
      sourceUid: state.pending.sourceUid,
      validTargets: [...state.players[playerId].front, ...state.players[playerId].back].map((card) => card.uid)
    };
    return render();
  }
  if (["place-junk-front", "place-junk-back"].includes(action)) {
    const source = findCard(state, state.pending?.sourceUid)?.card;
    if (!source) return;
    const zone = action === "place-junk-back" ? "back" : "front";
    state.pending = null;
    const ok = playCard(state, playerId, source.uid, { zone, free: true });
    if (ok) state.selectedUid = source.uid;
    if (ok) completeDeferredTutorialAction();
    return render();
  }
  if (action === "place-junk-under") {
    const source = findCard(state, state.pending?.sourceUid)?.card;
    if (!source) return;
    return prepareCodeUnder(source);
  }
  if (!selected && !["end-turn", "opening-mulligan"].includes(action)) return;

  if (action === "install") {
    return tutorialCommit({ type: "install", cardId: selected.card.id }, () => installCard(state, playerId, selected.card.uid));
  }
  if (action === "recover-registry") {
    return tutorialCommit({ type: "registry-recover", cardId: selected.card.id }, () => recoverRegistryCard(state, playerId, selected.card.uid));
  }
  if (action === "execute-registry") {
    if (spellNeedsTarget(selected.card)) return prepareSpell(selected.card, "execute-registry");
    if (refreshed && selected.card.category !== "Sp") {
      live.draft = { type: "placement", sourceUid: selected.card.uid, kind: "registry", uiDraft: true }; return renderSelection();
    }
    return tutorialCommit({ type: "registry-execute", cardId: selected.card.id }, () => executeRegistryCard(state, playerId, selected.card.uid));
  }
  if (action === "activate-script") return tutorialCommit({ type: "script-activate", cardId: selected.card.id }, () => activateScript(state, playerId, selected.card.uid));
  if (action === "set-script") return tutorialCommit({ type: "play", cardId: selected.card.id, zone: "back" }, () => playCard(state, playerId, selected.card.uid, { zone: "back" }));
  if (action === "set-std184-script") {
    if (refreshed) { live.draft = { type: "placement", sourceUid: selected.card.uid, options: { asScript: true }, uiDraft: true }; return renderSelection(); }
    return tutorialCommit({ type: "play", cardId: selected.card.id, zone: "back", asScript: true }, () => playCard(state, playerId, selected.card.uid, { zone: "back", asScript: true }));
  }
  if (action === "layered-front") return prepareLayered(selected.card, "front");
  if (action === "layered-back") return prepareLayered(selected.card, "back");
  if (action === "confirm-layered") {
    const pending = currentPending();
    if (pending?.type !== "layered-select") return;
    if (refreshed) {
      const next = { type: "placement", kind: "layered", sourceUid: pending.sourceUid, zone: pending.zone, materialUids: [...pending.selectedTargets], uiDraft: true };
      if (!livePlacementSlots(state, next).length) { live.notice = "素材・メモリ・配置条件を確認してください。"; return render(); }
      live.draft = next; return renderSelection();
    }
    return tutorialCommit(
      { type: "layered", cardId: selected.card.id, zone: pending.zone },
      () => {
        clearInput();
        const ok = playLayeredCard(state, playerId, pending.sourceUid, pending.selectedTargets, pending.zone);
        if (!ok) prepareInput(pending);
        return ok;
      }
    );
  }
  if (action === "prepare-mount") return prepareMount(selected.card);
  if (action === "prepare-code-under") return prepareCodeUnder(selected.card);
  if (["play-front", "play-back"].includes(action)) {
    if (spellNeedsTarget(selected.card) || selected.card.id === "STD-211") return prepareSpell(selected.card);
    const zone = action === "play-back" ? "back" : "front";
    return tutorialCommit({ type: "play", cardId: selected.card.id, zone }, () => playCard(state, playerId, selected.card.uid, { zone }));
  }
  if (refreshed && ["relog-front", "relog-back"].includes(action) && !["STD-215", "STD-220"].includes(selected.card.id)) {
    live.draft = { type: "placement", kind: "relog", sourceUid: selected.card.uid, zone: action === "relog-front" ? "front" : "back", uiDraft: true }; return renderSelection();
  }
  if (action === "relog-front") return tutorialCommit({ type: "relog", cardId: selected.card.id, zone: "front" }, () => relogCard(state, playerId, selected.card.uid, "front"));
  if (action === "relog-back") return tutorialCommit({ type: "relog", cardId: selected.card.id, zone: "back" }, () => relogCard(state, playerId, selected.card.uid, "back"));
  if (action === "prepare-attack") return prepareAttack(selected.card);
  if (action === "security-rest") {
    if (refreshed) { restSecurity(state, playerId, selected.card.uid); return render(); }
    return tutorialCommit({ type: "security-rest", cardId: selected.card.id }, () => restSecurity(state, playerId, selected.card.uid));
  }
  if (action === "end-turn") {
    if (refreshed) {
      if (live.draft || state.active !== playerId) return;
      if (state.mode === "tutorial" && !isTutorialActionExpected(tutorialFlow, { type: "end-turn" })) {
        acceptTutorialAction(state, tutorialFlow, { type: "end-turn" }); return render();
      }
      const outcome = requestTurnEnd(state);
      if (state.mode === "tutorial" && outcome === "advanced") acceptTutorialAction(state, tutorialFlow, { type: "end-turn" });
      else if (state.mode === "tutorial" && outcome === "waiting" && state.pending) tutorialFlow.pendingAction = { type: "end-turn" };
      render();
      if (state.active === "ai" && (state.mode === "ai" || state.sandboxUi?.opponentControl === "ai")) void runPacedAiTurn("ai");
      return outcome !== "blocked";
    }
    const committed = tutorialCommit({ type: "end-turn" }, () => {
      endTurn(state);
      if (state.mode === "sandbox" && state.sandboxUi?.opponentControl === "manual") state.sandboxUi.actor = state.active;
      return true;
    });
    if (committed && (state.mode === "ai" || (state.mode === "sandbox" && state.sandboxUi?.opponentControl === "ai")) && state.active === "ai" && !state.winner) {
      void runPacedAiTurn("ai");
    }
    return committed;
  }
}

function cancelLiveInput() {
  if (live.options || state.deckBuilder?.open || !stepBackInput(state, live, mobileUi.aiPacing?.active)) return;
  renderSelection();
}

function bindLiveEvents(scope = root) {
  scope.querySelectorAll("[data-live]").forEach(button => bindOn(button, "click", () => {
    const action = button.dataset.live;
    if (action === "fullscreen") {
      void toggleFullscreen(document).then(result => { if (!result.ok) live.notice = result.message; render(); });
      return;
    }
    if (action === "options" || action === "close-options") live.options = action === "options";
    else if (action === "unique-effect" || action === "close-unique") {
      live.uniqueOpen = action === "unique-effect";
      renderSelection();
      root.querySelector(live.uniqueOpen ? '[data-live="close-unique"]' : '[data-live="unique-effect"]')?.focus();
      return;
    }
    else if (action === "close-detail") { live.detailUid = null; return renderSelection(); }
    else if (action === "hand") live.handOpen = !live.handOpen;
    else if (["log", "close-log"].includes(action)) {
      live.log = action === "log";
      if (live.log) { live.options = false; live.catalog = false; }
    }
    else if (["catalog", "close-catalog"].includes(action)) live.catalog = action === "catalog";
    else if (action === "cancel") return cancelLiveInput();
    else if (action === "rematch") return init(state.mode === "lab" ? "sandbox" : state.mode, state.tutorialId);
    else if (action === "home") {
      if (resolutionBusy(state) || mobileUi.aiPacing?.active) { live.notice = "現在の選択・処理を終えてから入口へ戻れます。"; }
      else { live.screen = "entry"; live.options = false; live.draft = null; live.detailUid = null; state.selectedUid = null; }
    } else if (action === "skip") {
      if (!leaveTutorial(state)) return;
      tutorialFlow = null; live.draft = null; live.detailUid = null;
      live.notice = "案内をスキップ。その盤面のまま両側を手動操作できます。";
    } else if (action === "execute") {
      if (resolutionBusy(state) || mobileUi.aiPacing?.active) return;
      const slots = executionSlots(state, actorFor(state), state.selectedUid);
      if (!slots.length) live.notice = "実行できるマスがありません。メモリ・シンボル・配置条件を確認してください。";
      else { live.draft = { type: "placement", sourceUid: state.selectedUid, uiDraft: true }; live.detailUid = null; live.handOpen = false; }
    }
    if (action === "execute" || action === "hand") renderSelection();
    else render();
    if (action === "log") {
      const timeline = root.querySelector(".action-log-timeline");
      if (timeline) timeline.scrollTop = timeline.scrollHeight;
    }
  }));
  scope.querySelectorAll("[data-view]").forEach(button => bindOn(button, "click", () => { live.view = button.dataset.view; saveView(localStorage, live.view); render(); }));
  bindOn(scope.querySelector("[data-tap-details]"), "change", event => { live.tapDetails = event.target.checked; });
  scope.querySelectorAll("[data-security-uid]").forEach(button => bindOn(button, "click", () => { restSecurity(state, actorFor(state), button.dataset.securityUid); render(); }));
  scope.querySelectorAll(".r2-detail .inspector-actions").forEach(node => node.remove());
  syncInputLocks();
}

function positionLive() {
  if (!refreshed) return;
  layoutFrame.cancel();
  const portrait = live.view === "mobile" && innerHeight > innerWidth;
  const content = root.querySelector(".r2-content");
  if (!content) return;
  const safe = getComputedStyle(content);
  const left = parseFloat(safe.paddingLeft) || 0, right = parseFloat(safe.paddingRight) || 0;
  const top = parseFloat(safe.paddingTop) || 0, bottom = parseFloat(safe.paddingBottom) || 0;
  const safeViewport = { left, top, width: innerWidth - left - right, height: innerHeight - top - bottom };
  if (live.view === "mobile") content.style.setProperty("--mobile-console-scale", String(mobileConsoleScale(innerHeight, top, bottom)));
  else content.style.removeProperty("--mobile-console-scale");
  content.inert = portrait;
  content.classList.toggle("r2-portrait-blocked", portrait);
  root.querySelector(".r2-rotate").hidden = !portrait;
  const stage = root.querySelector(".r2-stage"), board = root.querySelector(".r2-board");
  if (!stage || !board) {
    boardResizeObserver?.disconnect(); observedStage = null; observedLegacy = null;
    return;
  }
  const canvas = board.querySelector(".r2-board-fit"), legacy = board.querySelector(".battle-board");
  if (stage !== observedStage || legacy !== observedLegacy) {
    boardResizeObserver?.disconnect();
    boardResizeObserver?.observe(stage); boardResizeObserver?.observe(legacy);
    observedStage = stage; observedLegacy = legacy;
  }
  const stageWidth = stage.clientWidth, stageHeight = stage.clientHeight;
  layoutCache.reuse("board-fit", [board, canvas, legacy, stageWidth, stageHeight], () => {
    const size = fitBoard(stageWidth, stageHeight);
    board.style.width = `${size.width}px`; board.style.height = `${size.height}px`;
    const height = legacy.offsetHeight;
    canvas.style.height = `${height}px`;
    canvas.style.transform = `translate(-50%, -50%) scale(${Math.min(size.width / 1000, size.height / height)})`;
  });
  layoutCache.reuse("placement", [board, actorFor(state), JSON.stringify(live.draft ?? null)], () => {
    board.querySelectorAll("[data-live-slot]").forEach(node => node.remove());
    board.querySelectorAll(".r2-legal-slot").forEach(node => node.classList.remove("r2-legal-slot"));
    board.classList.toggle("r2-choosing-placement", live.draft?.type === "placement");
    if (live.draft?.type === "placement") {
      for (const slot of livePlacementSlots(state, live.draft)) {
        const host = board.querySelector(`.zone-${slot.zone}[data-player="${actorFor(state)}"] [data-slot-index="${slot.slot}"]`);
        if (!host) continue;
        host.classList.add("r2-legal-slot");
        const button = document.createElement("button"); button.dataset.liveSlot = `${slot.zone}:${slot.slot}`; button.className = "r2-place-slot";
        button.textContent = slot.options.baseUid || slot.options.underUid ? "マウント" : "ここに実行";
        button.setAttribute("aria-label", `${slot.zone === "front" ? "フロント" : "バック"} ${slot.slot} に実行`);
        button.addEventListener("click", event => {
          event.stopPropagation();
          const draft = live.draft, uid = draft?.sourceUid;
          const latest = livePlacementSlots(state, draft).find(item => item.zone === slot.zone && item.slot === slot.slot);
          const card = findCard(state, uid)?.card;
          if (!latest || !card) return;
          const kind = draft.kind;
          tutorialCommit({ type: kind === "layered" ? "layered" : kind === "relog" ? "relog" : kind === "registry" ? "registry-execute" : "play", cardId: card.id, zone: slot.zone }, () => kind === "layered"
            ? playLayeredCard(state, actorFor(state), uid, draft.materialUids, slot.zone, latest.options)
            : kind === "relog" ? relogCard(state, actorFor(state), uid, slot.zone, latest.options)
            : kind === "registry" ? executeRegistryCard(state, actorFor(state), uid, latest.options)
            : playCard(state, actorFor(state), uid, latest.options));
        });
        host.append(button);
      }
    }
  });
  const popup = root.querySelector(".r2-popup");
  if (popup) {
    const anchor = [...root.querySelectorAll(".r2-stage [data-card-uid], .r2-hand [data-card-uid], .admin-drawer [data-card-uid]")].find(node => node.dataset.cardUid === state.selectedUid);
    popup.hidden = !anchor || Boolean(anchor.closest("[hidden]"));
    if (!popup.hidden) {
      const pos = placePopup(anchor.getBoundingClientRect(), popup.getBoundingClientRect(), safeViewport);
      popup.style.left = `${pos.left}px`; popup.style.top = `${Math.max(top + 8, Math.min(pos.top, innerHeight - bottom - popup.offsetHeight - 8))}px`;
    }
  }
  const guide = root.querySelector(".live-guide");
  if (guide && tutorialFlow) {
    layoutCache.reuse("guide-fit", [guide, safeViewport.width, safeViewport.height, guide.querySelector(".live-guide-text").innerHTML], () => fitGuideContent(guide, safeViewport));
    root.querySelectorAll(".live-focus").forEach(node => { node.classList.remove("live-focus"); delete node.dataset.tutorialFocusLabel; });
    const focus = currentTutorialPresentation(tutorialFlow)?.focus ?? [];
    const targets = focus.flatMap(item => {
      const selector = tutorialFocusSelector(item);
      const matches = selector ? [...root.querySelectorAll(selector)].filter(node => !node.closest(".live-guide,.r2-detail")) : [];
      for (const node of matches) node.dataset.tutorialFocusLabel = item.label ?? "";
      return matches;
    });
    for (const node of targets) node.classList.add("live-focus");
    const protectedRects = [...targets, ...root.querySelectorAll(".r2-console,.selection-panel,.r2-detail,.r2-zone-drawer,.r2-hand-toggle,.r2-utilities"), ...(popup ? [popup] : [])].map(node => node.getBoundingClientRect()).filter(rect => rect.width && rect.height);
    const pos = avoidFocus(guide.getBoundingClientRect(), protectedRects, safeViewport);
    guide.style.left = `${pos.left}px`; guide.style.top = `${pos.top}px`; guide.style.right = "auto"; guide.style.bottom = "auto";
    guide.dataset.overlap = String(pos.overlap);
  }
}

if (refreshed) {
  document.addEventListener("fullscreenchange", () => render());
  let press = null, timer = null, handSwipe = null;
  const clearPress = () => { clearTimeout(timer); timer = null; press = null; };
  root.addEventListener("pointerdown", event => {
    clearPress(); live.suppressClick = false;
    handSwipe = live.view === "mobile" && live.handOpen && event.target.closest(".r2-mobile-hand")
      && (event.pointerType === "touch" || event.pointerType === "pen")
      ? { x: event.clientX, y: event.clientY, pointerId: event.pointerId, pointerType: event.pointerType } : null;
    if (!event.isPrimary || event.button !== 0) return;
    const card = event.target.closest(".r2-stage [data-card-uid], .r2-hand [data-card-uid], .admin-drawer [data-card-uid], .selection-card[data-selection-option]");
    if (!card) return;
    press = { x: event.clientX, y: event.clientY, uid: card.dataset.cardUid ?? card.dataset.selectionOption };
    timer = setTimeout(() => {
      if (!press || live.options || state.deckBuilder?.open) return;
      live.detailUid = press.uid; live.suppressClick = true; clearPress(); renderSelection();
    }, 500);
  });
  root.addEventListener("pointermove", event => { if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) { live.suppressClick = true; clearPress(); } }, { passive: true });
  root.addEventListener("pointerup", event => {
    const start = handSwipe;
    handSwipe = null;
    if (!start || start.pointerId !== event.pointerId || !isDownwardHandSwipe(start, { x: event.clientX, y: event.clientY }, start.pointerType)) return;
    live.handOpen = false;
    live.suppressClick = true;
    clearPress();
    event.preventDefault();
    renderSelection();
  });
  window.addEventListener("pointerup", () => { handSwipe = null; clearPress(); });
  window.addEventListener("blur", () => { handSwipe = null; clearPress(); });
  document.addEventListener("visibilitychange", () => { handSwipe = null; clearPress(); });
  root.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") { clearPress(); live.suppressClick = false; } });
  root.addEventListener("pointercancel", () => { handSwipe = null; live.suppressClick = true; clearPress(); });
  root.addEventListener("dragstart", event => { if (event.target.closest(".card")) event.preventDefault(); });
  root.addEventListener("contextmenu", event => { if (event.target.closest(".card")) event.preventDefault(); });
  root.addEventListener("scroll", event => { if (event.target.matches?.(".hand-scroll")) { if (press) live.suppressClick = true; clearPress(); layoutFrame.schedule(); } }, true);
  root.addEventListener("click", event => {
    if (!event.target.closest(".r2-stage") || event.target.closest("button,[role=button],a,input,select,textarea")) return;
    if (live.options || live.log || live.catalog || live.uniqueOpen || state.deckBuilder?.open) return;
    if (dismissBoardSelection(state, live, mobileUi.aiPacing?.active)) renderSelection();
  });
  window.addEventListener("keydown", event => { if (event.key === "Escape") { if (live.uniqueOpen) { live.uniqueOpen = false; renderSelection(); } else if (live.options) { live.options = false; render(); } else cancelLiveInput(); } });
  window.addEventListener("resize", () => { clearPress(); layoutFrame.schedule(); });
  document.fonts?.addEventListener("loadingdone", () => {
    layoutCache.invalidate("board-fit"); layoutCache.invalidate("guide-fit"); layoutFrame.schedule();
  });
}

init(refreshed ? "sandbox" : "tutorial");
if (refreshed) { live.screen = "entry"; render(); }
registerPwa();

if (new URLSearchParams(location.search).get("e2e") === "1") {
  window.__SIMPLE_ZEKE_E2E__ = {
    getState: () => state,
    setState: (nextState) => { aiPacingRun += 1; mobileUi.aiPacing = null; state = nextState; render(); },
    getAiPacing: () => mobileUi.aiPacing,
    runAiTurn: (timings) => runPacedAiTurn("ai", timings),
    applyVisualTransition: (transition) => applyVisualEffects(root, transition)
  };
}
