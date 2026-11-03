import './styles.css';
import './ui/ability-help.css';
import './ui-refresh/wireframe/board.css';
import './ui-refresh/hud-skin.css';
import './ui-refresh/hud-sprites.css';
import { createMatchLifecycleController } from './adapters/match-lifecycle-controller.js';
import { CARD_VERSION, RULE_VERSION } from './game/runtime/versions.js';
import { mountRuntimeMatch } from './ui-refresh/runtime-match-surface.js';
import { runtimeShellHtml } from './ui-refresh/runtime-shell-view.js';
import { patchHtml } from './ui-refresh/dom-patch.js';
import { isIosWebKit, readSavedView, resolveView, saveView } from './ui-refresh/model.js';
import { RENDER_SCALE_STORAGE_KEY, RENDER_STORAGE_KEY, readRenderPreference, readRenderScale, resolveRenderMode, urlRenderPreference, urlRenderScale } from './ui-refresh/render-mode.js';
import { renderQualityFor } from './ui-refresh/wireframe/render-resolution.js';
import { escapeScreen, nextScreen } from './ui-refresh/screen-flow.js';
import { markTutorialDone, readTutorialDone } from './ui-refresh/tutorial-items.js';
import { isFullscreen, toggleFullscreen } from './ui-refresh/fullscreen.js';
import { syncEntryLogoGlitch } from './ui-refresh/entry-logo-glitch.js';
import { syncEntryCrtViewport } from './ui-refresh/entry-crt-viewport.js';
import { syncLiveInputLocks } from './ui-refresh/input-lock.js';
import { noticeText } from './ui-refresh/notice-text.js';
import { installMobileViewport } from './ui-refresh/mobile-viewport.js';
import { captureDeckViewport, restoreDeckViewport } from './ui/deck-viewport.js';
import { installAbilityHelp } from './ui/ability-help.js';
import { registerLocalFonts } from './ui/local-fonts.js';
import { memoryEstimate, sampleMemory } from './ui-refresh/memory-estimate.js';
import { clearSavedFiles, loadBuildRevision } from './ui-refresh/debug-tools.js';
import { createErrorLog, errorLogText } from './ui-refresh/error-log.js';
import { FX_SPEED_STORAGE_KEY, readFxSpeed, setFxSpeed } from './ui-refresh/fx-speed.js';

// The debug window's error log listens from here on. A new entry redraws an open window once a quarter second later,
// never from a redraw it caused itself (a failing redraw would feed itself).
let errorRedraw = null, errorRedrawing = false;
const errorLog = createErrorLog(window,{changed:() => {
  if (!host.debug || errorRedraw || errorRedrawing) return;
  errorRedraw = setTimeout(() => {errorRedraw = null;errorRedrawing = true;try {renderShell();} finally {setTimeout(() => {errorRedrawing = false;},0);}},250);
}});
import { MAX_SAVED_DECKS, deckToRecipe, loadSavedDecks, normalizeSavedDeck, recommendDeck, saveDeckCollection, validateDeck } from './game/deck-builder.js';
import { registerPwa } from './pwa.js';
import { MATCH_LOGS, REPLAYS, loadStored, storedExport } from './adapters/match-record-store.js';
import { archiveRetiredMatch } from './adapters/match-archive.js';
import { sendMatchLog } from './adapters/match-log-sender.js';
import { buildMatchLog } from './adapters/match-log.js';
import { TUTORIAL_WIN_CHECKPOINT, loadTutorialWinBoard } from './tutorial-boards/index.js';

// Host preferences never hold an engine state. One lifecycle owns the single
// Authority; all game actions go through the current bound seat ports.
const root = document.querySelector('#app');
const EFFECTS_STORAGE_KEY = 'sz-ui-effects';
const SEND_LOGS_STORAGE_KEY = 'sz-send-match-logs';
// As a match is replaced, left or the page closes, its replay and log are kept in this
// browser, and a finished match's log is sent when the player switched sending on.
const storedCounts = () => ({replays:loadStored(localStorage,REPLAYS).length,logs:loadStored(localStorage,MATCH_LOGS).length});
const lifecycle = createMatchLifecycleController({onRetire:retired => {
  if (archiveRetiredMatch(retired,{storage:localStorage,sendEnabled:host.sendMatchLogs,send:sendMatchLog}).kept) host.storedCounts = storedCounts();}});
const host = {screen:'entry',mode:'sandbox',tutorialId:'basics',
  view:resolveView({pathname:location.pathname,saved:readSavedView(localStorage),mobile:navigator.userAgentData?.mobile,userAgent:navigator.userAgent,maxTouchPoints:navigator.maxTouchPoints}).view,
  playerDeckId:'start-red',aiDeckId:'start-yellow',playerUserId:'doors_zx',aiUserId:'doors_zx',savedDecks:loadSavedDecks(),
  deckBuilder:{open:false,query:'',color:'all',recommendColor:'赤',strategy:'balanced',recommendationNote:'',autoBuildOpen:false,draft:normalizeSavedDeck({id:'',name:'新規デッキ',userId:'doors_zx',cards:{}},'')},
  options:false,notice:'',storedCounts:storedCounts(),sendMatchLogs:localStorage.getItem(SEND_LOGS_STORAGE_KEY) === 'on',tapDetails:true,effectsEnabled:localStorage.getItem(EFFECTS_STORAGE_KEY) === "on",
  masterVolume:Math.max(0,Math.min(10,Number.parseInt(localStorage.getItem('sz-master-volume') ?? '7',10) || 0)),
  logoNoiseProfile:localStorage.getItem('sz-logo-noise-profile') || 'random',logoVideoName:'',actor:'player',opponentControl:'manual',
  catalogOpen:false,catalog:{query:'',expansion:'all',catalogOwner:'player'},tutorialDone:readTutorialDone(globalThis.localStorage)};
let surface = null, session = null, screenRendered = null, entryLogoVideoFile = null;
let shellGeneration = 0, adminSerial = 0, press = null, suppressDeckClickUntil = 0;
installAbilityHelp(root);registerLocalFonts();
const mobileViewport = installMobileViewport(root);
// The raw code goes to the console only; the player sees a sentence or nothing.
// In a match (not a tutorial, whose notice stays for its step) it goes after 3 s, or sooner once the player's next move
// goes through (runtime-match-surface.js) (文豪, 2026-11-03, M6).
let noticeTimer = null;
const NOTICE_MS = 3000;
const notice = code => {const text = noticeText(code);console.debug('[notice]',code);if (text === null) return;host.notice = text;renderShell();
  clearTimeout(noticeTimer);if (host.screen === 'game' && host.mode !== 'tutorial') noticeTimer = setTimeout(() => {if (host.notice === text) {host.notice = '';renderShell();}},NOTICE_MS);};
// Render mode (V092-09): compat draws no WebGL title, logo noise, 3D board, HUD or result shader,
// only SVG/CSS. iOS WebKit starts in compat (context and memory limits) and a lost context drops to
// it; the player picks auto / compat / full, kept in this browser only. ?render= wins and is not saved.
const renderDetection = {iosWebKit:isIosWebKit({userAgent:navigator.userAgent,platform:navigator.platform,maxTouchPoints:navigator.maxTouchPoints})};
const readRenderSaved = () => {try {return readRenderPreference(localStorage.getItem(RENDER_STORAGE_KEY));} catch {return 'auto';}};
host.renderPreference = readRenderSaved();host.renderContextLost = false;
const renderMode = () => resolveRenderMode({url:location.search,saved:host.renderPreference,detection:renderDetection,contextLost:host.renderContextLost});
const lowGpu = () => renderMode().mode === 'compat';
// What a match surface takes from the mode: no WebGL, and canvases drawn at CSS pixels, in compat.
// The full-mode scale: ?renderScale= (not saved) over the debug window's choice (kept in this browser).
const readRenderScaleSaved = () => {try {return readRenderScale(localStorage.getItem(RENDER_SCALE_STORAGE_KEY));} catch {return null;}};
host.renderScale = readRenderScaleSaved();
const renderScale = () => urlRenderScale(location.search) ?? host.renderScale;
const renderOptions = () => {const {mode} = renderMode();return {lowGpu:mode === 'compat',renderQuality:renderQualityFor(mode,renderScale())};};
// The effect speed of the debug window, kept in this browser; ×1 unless one was picked.
host.fxSpeed = setFxSpeed((() => {try {return readFxSpeed(localStorage.getItem(FX_SPEED_STORAGE_KEY));} catch {return 1;}})());
function pickFxSpeed(value) {
  host.fxSpeed = setFxSpeed(value);
  try {localStorage.setItem(FX_SPEED_STORAGE_KEY,String(host.fxSpeed));} catch {/* the choice still holds for this page */}
  renderShell();
}
function setRenderScale(value) {
  host.renderScale = readRenderScale(value);
  try {localStorage.setItem(RENDER_SCALE_STORAGE_KEY,String(host.renderScale ?? 1));} catch {/* the choice still holds for this page */}
  surface?.configure(renderOptions());renderShell();
}
const entryEffects = () => host.screen === 'entry' && host.effectsEnabled && !lowGpu() && !host.deckBuilder.open && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function renderShell(replace = false) {
  host.render = renderMode();host.renderUrl = urlRenderPreference(location.search);host.renderScaleUrl = urlRenderScale(location.search);
  document.body.dataset.view = host.view;
  const viewport = captureDeckViewport(root);
  host.fullscreen = isFullscreen(document);
  const bound = session?.port(host.actor), read = bound?.ok ? bound.value.query() : null;
  host.busy = Boolean(read?.ok && read.value.requiredInput);
  host.errors = host.debug ? {entries:errorLog.entries(),total:errorLog.total(),copied:host.errorCopied ?? null} : null;
  host.activeSeat = read?.ok ? read.value.status.activeSeat : 'player';
  const html = runtimeShellHtml(host);
  if (replace || screenRendered !== host.screen || !root.querySelector('[data-shell-overlays]')) {root.innerHTML = html;screenRendered = host.screen;}
  else {
    const template = document.createElement('template');template.innerHTML = html;
    patchHtml(root.querySelector('[data-shell-overlays]'),template.content.querySelector('[data-shell-overlays]').innerHTML);
    const flow = root.querySelector('[data-flow-screen]'), nextFlow = template.content.querySelector('[data-flow-screen]');
    if (flow && nextFlow) patchHtml(flow,nextFlow.innerHTML);
    const entry = root.querySelector('.r2-entry img'), next = template.content.querySelector('.r2-entry img');
    if (entry && next) entry.src = next.src;
    root.querySelector('.r2-content')?.setAttribute('data-effects',host.effectsEnabled ? 'on' : 'off');
  }
  restoreDeckViewport(root,viewport);
  syncEntryLogoGlitch(root,entryEffects(),{profile:host.logoNoiseProfile,videoFile:entryLogoVideoFile});
  syncEntryCrtViewport(root,entryEffects(),{menuOpen:host.options,debugOpen:Boolean(host.options && host.debug),
    debug:{build:host.build,errors:host.errors,memory:host.memory,renderScale:host.renderScale ?? 1,renderScaleUrl:host.renderScaleUrl,compat:host.render?.mode === 'compat',fxSpeed:host.fxSpeed},view:host.view,fullscreen:host.fullscreen,tapDetails:host.tapDetails,effectsEnabled:host.effectsEnabled,masterVolume:host.masterVolume,storedCounts:host.storedCounts,sendMatchLogs:host.sendMatchLogs,
    onReadyChange:() => syncLiveInputLocks(root,{optionsOpen:host.options || Boolean(host.debug),entryCrtReady:Boolean(root.querySelector('.r2-entry-crt-ready'))})});
  syncLiveInputLocks(root,{optionsOpen:host.options || Boolean(host.debug),entryCrtReady:Boolean(root.querySelector('.r2-entry-crt-ready'))});
  mobileViewport.sync(host.view);
}
// A choice from the title or the options window is kept; it also clears a loss-driven fallback.
function setRenderPreference(value) {
  host.renderPreference = readRenderPreference(value);host.renderContextLost = false;
  try {localStorage.setItem(RENDER_STORAGE_KEY,host.renderPreference);} catch {/* the choice still holds for this page */}
  surface?.configure(renderOptions());renderShell();
}
// A WebGL context was lost: drop to compat for this page and say so; the player can switch back.
function degradeAfterLoss() {
  if (lowGpu()) return;
  host.renderContextLost = true;surface?.configure(renderOptions());
  host.notice = '描画が不安定になったため軽量表示（WebGLなし）に切り替えました。タイトルのオプションで戻せます。';renderShell();
}
// Every way into a match the player takes says 準備中… first (文豪, 2026-11-04, 4-1): the build blocks the page and the
// first paint of the board holds the GPU, so the shell is drawn with it, and the build runs as a task after the frame
// that paints it (inside a frame callback, two frames on, its WebGL work waited on that frame's raster and the board
// came later). A press meanwhile does nothing. The e2e hook still starts at once.
let preparing = false;
function prepared(enter) {
  if (preparing) return;
  preparing = true;host.preparing = true;renderShell();
  requestAnimationFrame(() => setTimeout(async () => {
    try {await enter();} finally {preparing = false;if (host.preparing) {host.preparing = false;renderShell();}}
  },0));
}
// The debug page (文豪, 2026-11-04) is the options window's second page, on the title (HTML and CRT menus) and the
// board: デバッグ ▶ slides to it, ◀ 戻る and Escape slide back. Its memory estimate is counted only while it shows:
// when it opens and on its 更新. A count still running when the page or the window closes, or counts again, is dropped.
let memorySerial = 0;
const debugShown = () => host.options && host.debug && Boolean(root.querySelector('[data-debug-page] [data-memory-estimate]'));
async function measureMemory() {
  const serial = ++memorySerial;host.memory = null;renderShell();
  if (!debugShown()) return;
  const facts = await sampleMemory(document,window);
  if (serial !== memorySerial || !debugShown()) return;
  host.memory = memoryEstimate(facts);renderShell();
}
// The window scrolls back to its top and the focus moves to the page shown.
function turnOptionsPage(focus) {
  root.querySelector('.r2-pager')?.closest('section')?.scrollTo?.(0,0);
  root.querySelector(focus)?.focus({preventScroll:true});
}
function openDebug() {host.options = true;host.debug = true;host.errorCopied = null;const counted = measureMemory();turnOptionsPage('[data-debug-page] [data-debug-close]');return counted;}
function closeDebug() {host.debug = false;memorySerial += 1;renderShell();turnOptionsPage('[data-options-page] [data-debug-open]');}
// まとめてコピー: the clipboard API, or a hidden text area where it is refused (an insecure origin).
async function copyErrors() {
  const value = errorLogText(errorLog.entries());
  let copied = false;
  try {await navigator.clipboard.writeText(value);copied = true;} catch {
    const area = document.createElement('textarea');area.value = value;area.setAttribute('readonly','');area.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.append(area);area.select();try {copied = document.execCommand('copy');} catch {copied = false;}area.remove();
  }
  host.errorCopied = copied;renderShell();
}
// 保存したファイルを消して読み直す: asked once, then every service worker and cache of this site go before the reload.
async function clearAndReload() {
  if (!window.confirm('service worker の登録を外し、キャッシュを消してから読み直します。設定や対戦ログは消しません。よろしいですか？')) return;
  try {await clearSavedFiles();} finally {location.reload();}
}
function attachSession(next) {
  host.preparing = false;
  surface?.dispose();surface = null;session = next;shellGeneration += 1;
  host.screen = 'game';host.options = false;host.debug = false;host.notice = '';host.actor = session.scope().seatIds[0];renderShell(true);
  const mounted = mountRuntimeMatch({root:root.querySelector('[data-match-root]'),session,viewerSeat:host.actor,view:host.view,...renderOptions(),onContextLost:degradeAfterLoss,
    boardStyle:new URLSearchParams(location.search).get('board') === 'classic' ? 'classic' : 'wireframe',
    aiSeat:host.mode === 'ai' || host.mode === 'sandbox' && host.opponentControl === 'ai' ? session.scope().seatIds[1] : null,
    effectsEnabled:host.effectsEnabled,tapDetails:host.tapDetails,onError:notice,onMenu:() => {host.options = true;host.debug = false;renderShell();},onTitle:leaveMatch,
    onRematch:() => prepared(() => {const result = lifecycle.rematch();if (result.ok) attachSession(result.value);else notice(result.error.code);}),
    onTutorialSkip:() => prepared(skipTutorial),onSaveLog:saveMatchLog,onToMenu:() => leaveMatch(nextScreen('game',host.mode === 'tutorial' ? 'tutorial-complete' : 'match-menu')),onNoticeClear:() => {if (host.notice) {host.notice = '';renderShell();}}});
  if (mounted.ok) surface = mounted.value;else notice(mounted.error.code);
}
function startMatch(mode = host.mode,tutorialId = host.tutorialId,seed = crypto.getRandomValues(new Uint32Array(1))[0]) {
  markWonTutorial();
  const saved = id => host.savedDecks.find(deck => `custom:${deck.id}` === id), player = saved(host.playerDeckId), ai = saved(host.aiDeckId);
  // Opening protocol v2.4 (keep / redraw before the first turn, dice for the first player) is opt-in by URL until it becomes the default.
  const opening = mode === 'ai' && new URLSearchParams(location.search).get('opening') === 'v2.4' ? {openingProtocol:'v2.4'} : {};
  if (mode !== 'tutorial') {const invalid = [player,ai].find(deck => deck && !validateDeck(deck).valid);
    if (invalid) {host.deckBuilder.open = true;host.deckBuilder.draft = structuredClone(invalid);host.notice = `「${invalid.name}」は構築規定の修正が必要です。`;renderShell();return {ok:false,error:{code:'INVALID_DECK'}};}}
  const result = lifecycle.start({matchId:crypto.randomUUID(),seatIds:['player','ai'],seed,ruleVersion:RULE_VERSION,cardVersion:CARD_VERSION,gameOptions:{
    ...opening,mode,tutorialId,playerDeckId:mode === 'tutorial' ? 'red' : player ? 'red' : host.playerDeckId,aiDeckId:mode === 'tutorial' ? 'yellow' : ai ? 'yellow' : host.aiDeckId,
    playerDeckRecipe:mode === 'tutorial' ? null : player ? deckToRecipe(player) : null,aiDeckRecipe:mode === 'tutorial' ? null : ai ? deckToRecipe(ai) : null,
    playerUserId:mode === 'tutorial' ? 'doors_zx' : player?.userId ?? host.playerUserId,aiUserId:mode === 'tutorial' ? 'doors_zx' : ai?.userId ?? host.aiUserId,sandboxDeckSetup:mode === 'sandbox'}});
  if (result.ok) {host.mode = mode;host.tutorialId = tutorialId;attachSession(result.value);} else notice(result.error.code);
  return result;
}
// A finished match or tutorial ends on the end screen, whose buttons leave for the match menu (the tutorial list) or the
// title (文豪, 2026-11-01). A skipped tutorial starts its own win board as a new match, the opponent at STR 0 and the closing
// line (文豪, 2026-10-29 and 2026-10-31), so it counts as cleared like a played one. The match left is retired like any replaced one.
async function skipTutorial() {
  const generation = shellGeneration, board = await loadTutorialWinBoard(host.tutorialId);
  // Left, or skipped already, while the board was read: nothing to skip any more.
  if (generation !== shellGeneration) return;
  const result = board.ok ? lifecycle.startFromCheckpoint({file:board.value,checkpointId:TUTORIAL_WIN_CHECKPOINT}) : board;
  if (result.ok) attachSession(result.value);else notice(result.error.code);}
// The end screen's [対戦ログを保存]: this match's log as it stands, in the stored logs' own export form.
function saveMatchLog() {
  const replay = session?.matchRecord?.(), feed = replay?.ok ? session.port(session.scope().seatIds[0]).value?.events({afterEventId:null}) : null;
  if (!feed?.ok) return notice(feed?.error?.code ?? replay?.error?.code ?? 'MATCH_RECORD_UNAVAILABLE');
  downloadStored('match-log',MATCH_LOGS,[buildMatchLog(replay.value,feed.value.events,new Date())]);}
function downloadStored(name,place,items) {const link = document.createElement('a');link.href = URL.createObjectURL(new Blob([storedExport(place,items)],{type:'application/json'}));link.download = `siege-zeke-${name}-${new Date().toISOString().slice(0,10)}.json`;link.click();URL.revokeObjectURL(link.href);}
// Leaving a won tutorial by any way marks it finished in this browser (Q5): the title, the end screen, another match or
// tutorial started over it (startMatch, before host.mode / host.tutorialId change), and the page closed or reloaded.
// leaveMatch keeps its own copy of markWonTutorial's line (tests/screen-flow.test.js pins its text).
const tutorialWon = () => host.mode === 'tutorial' && session?.tutorial?.().value?.flow?.complete === true;
// A browser may refuse even the reading of localStorage; this runs first in pagehide and startMatch, so it must not throw.
const markWonTutorial = () => {try {if (tutorialWon()) host.tutorialDone = markTutorialDone(globalThis.localStorage,host.tutorialId);} catch {/* the tutorial stays unmarked */}};
function leaveMatch(screen = nextScreen('game','leave')) {if (tutorialWon()) host.tutorialDone = markTutorialDone(globalThis.localStorage,host.tutorialId);lifecycle.leave();surface = null;session = null;shellGeneration += 1;host.debug = false;host.screen = screen;host.options = false;host.catalogOpen = false;host.notice = '';renderShell(true);
  if (screen !== 'entry') root.querySelector('[data-flow-back]')?.focus({preventScroll:true});}
// Entry flow screens move by their own buttons and Escape only, never by the browser history (Q14).
// Focus follows the move (a re-render drops it to the body, out of reach of Escape): a flow screen
// starts on its [戻る], the title on the button that opened the screen just left.
function goTo(screen) {if (!screen) return;const from = host.screen;host.screen = screen;host.options = false;host.debug = false;host.catalogOpen = false;host.notice = '';renderShell();
  const opener = {'tutorial-select':'[data-flow="open-tutorials"]','battle-setup':'[data-flow="open-battle"]'}[from];
  root.querySelector(screen === 'entry' ? opener ?? '[data-mode]' : '[data-flow-back]')?.focus({preventScroll:true});}
// Online play (P02B) will connect here; until then its button is marked 準備中 and does nothing.
function onOnlineBattle() {}
function newDeckDraft() {host.deckBuilder.draft = normalizeSavedDeck({name:'新規デッキ',userId:'doors_zx',cards:{}},'');}
function admin(action) {
  if (!session) return {ok:false,error:{code:'MATCH_UNAVAILABLE'}};
  const control = session.sandboxControl(host.actor), read = session.port(host.actor).value?.query();
  if (!control.ok || !read?.ok) return control.ok ? read : control;
  const result = control.value.submit({commandId:`host:${++adminSerial}`,expectedRevision:read.value.status.revision,action});
  if (result.ok) surface?.refresh();else notice(result.error.code);return result;
}
function switchManualViewer(seatId) {
  if (host.mode !== 'sandbox' || host.opponentControl !== 'manual' || !surface) return {ok:false,error:{code:'UNAVAILABLE_MODE'}};
  const result = surface.switchViewer(seatId);
  if (result.ok) {host.actor = seatId;renderShell();}
  else notice(result.error.code);
  return result;
}
root.addEventListener('click',event => {
  if (event.target.closest('[data-match-root]') || event.target.closest('[data-ability-help]')) return;
  const button = event.target.closest('button');if (!button) return;
  const d = button.dataset, deck = host.deckBuilder;
  // The title's tutorial and battle buttons keep data-mode for the CRT and old links but open their screens.
  if (d.flow) return goTo(nextScreen(host.screen,d.flow));
  if (button.hasAttribute('data-flow-back')) return goTo(nextScreen(host.screen,'back'));
  if (d.start) return prepared(() => startMatch(d.start,d.start === 'tutorial' ? d.tutorialId : host.tutorialId));
  if (button.hasAttribute('data-online-battle')) return onOnlineBattle();
  if (d.mode) return prepared(() => startMatch(d.mode));
  if (d.view) {host.view = d.view;saveView(localStorage,d.view);surface?.configure({view:d.view});return renderShell();}
  if (button.hasAttribute('data-debug-open')) return openDebug();
  if (button.hasAttribute('data-debug-close')) return closeDebug();
  if (button.hasAttribute('data-memory-refresh')) return measureMemory();
  if (button.hasAttribute('data-debug-clear-reload')) return clearAndReload();
  if (button.hasAttribute('data-error-copy')) return copyErrors();
  if (d.renderScale) return setRenderScale(d.renderScale);
  if (d.fxSpeed) return pickFxSpeed(d.fxSpeed);
  if (d.live === 'options') {host.options = true;host.debug = false;}
  else if (d.live === 'close-options') {host.options = false;host.debug = false;}
  else if (d.live === 'home') return leaveMatch();
  else if (d.live === 'fullscreen') {void toggleFullscreen(document).then(() => renderShell());return;}
  else if (d.live === 'close-catalog') host.catalogOpen = false;
  else if (button.hasAttribute('data-deck-open')) {deck.open = true;host.options = false;}
  else if (button.hasAttribute('data-deck-close')) {deck.open = false;deck.detailId = null;}
  else if (button.hasAttribute('data-deck-auto-build')) {deck.autoBuildOpen = !deck.autoBuildOpen;deck.managementOpen = false;}
  else if (button.hasAttribute('data-deck-management')) {deck.managementOpen = !deck.managementOpen;deck.autoBuildOpen = false;}
  else if (d.deckCategory) deck.category = d.deckCategory;
  else if (d.deckDetail) deck.detailId = d.deckDetail;
  else if (button.hasAttribute('data-deck-detail-close')) deck.detailId = null;
  else if (button.hasAttribute('data-deck-new')) newDeckDraft();
  else if (button.hasAttribute('data-deck-recommend')) {const result = recommendDeck({userId:deck.draft.userId,color:deck.recommendColor,strategy:deck.strategy,cards:deck.draft.cards});deck.draft.cards = result.cards;deck.recommendationNote = result.explanation;}
  else if (d.deckPlus || d.deckMinus) {if (performance.now() < suppressDeckClickUntil) return;const id = d.deckPlus ?? d.deckMinus;deck.draft.cards[id] = Math.max(0,Number(deck.draft.cards[id] ?? 0)+(d.deckPlus ? 1 : -1));}
  else if (button.hasAttribute('data-deck-save')) {const draft = normalizeSavedDeck(deck.draft,deck.draft.id || `deck-${Date.now()}`);
    if (!validateDeck(draft).valid) return;const index = host.savedDecks.findIndex(item => item.id === draft.id);if (index < 0 && host.savedDecks.length >= MAX_SAVED_DECKS) return;
    if (index < 0) host.savedDecks.push(draft);else host.savedDecks[index] = draft;host.savedDecks = saveDeckCollection(host.savedDecks);deck.draft = structuredClone(draft);}
  else if (button.hasAttribute('data-deck-delete')) {host.savedDecks = saveDeckCollection(host.savedDecks.filter(item => item.id !== deck.draft.id));newDeckDraft();}
  else if (button.hasAttribute('data-deck-export')) {const link = document.createElement('a');link.href = URL.createObjectURL(new Blob([JSON.stringify(host.savedDecks,null,2)],{type:'application/json'}));link.download = 'simple-zeke-decks.json';link.click();URL.revokeObjectURL(link.href);return;}
  else if (d.storedExport) {const place = d.storedExport === 'logs' ? MATCH_LOGS : REPLAYS;downloadStored(d.storedExport,place,loadStored(localStorage,place));return;}
  else if (button.hasAttribute('data-toggle-send-logs')) {host.sendMatchLogs = !host.sendMatchLogs;localStorage.setItem(SEND_LOGS_STORAGE_KEY,host.sendMatchLogs ? 'on' : 'off');}
  else if (button.hasAttribute('data-title-tap-details')) {host.tapDetails = !host.tapDetails;surface?.configure({tapDetails:host.tapDetails});}
  else if (button.hasAttribute('data-toggle-effects')) {host.effectsEnabled = !host.effectsEnabled;localStorage.setItem('sz-ui-effects',host.effectsEnabled ? 'on' : 'off');surface?.configure({effectsEnabled:host.effectsEnabled});}
  else if (d.renderMode) return setRenderPreference(d.renderMode);
  else if (d.volume) {host.masterVolume = Number(d.volume);localStorage.setItem('sz-master-volume',String(host.masterVolume));}
  else if (button.hasAttribute('data-logo-video-clear')) {entryLogoVideoFile = null;host.logoVideoName = '';}
  else if (button.hasAttribute('data-catalog-open')) {host.catalogOpen = true;host.options = false;}
  else if (d.catalogCard) return admin({type:'sandboxAddCard',definitionId:d.catalogCard,targetSeat:host.catalog.catalogOwner});
  else return;
  renderShell();
});
root.addEventListener('input',event => {
  if (event.target.closest('[data-match-root]')) return;
  const deck = host.deckBuilder;
  if (event.target.hasAttribute('data-deck-name')) {deck.draft.name = event.target.value;return;}
  if (event.target.hasAttribute('data-deck-query')) deck.query = event.target.value;
  else if (event.target.hasAttribute('data-catalog-query')) host.catalog.query = event.target.value;else return;renderShell();
});
root.addEventListener('change',async event => {
  if (event.target.closest('[data-match-root]')) return;
  const target = event.target, deck = host.deckBuilder;
  for (const [key,field] of Object.entries({'deck-load':'load','deck-user':'userId','deck-color':'color','deck-recommend-color':'recommendColor','deck-strategy':'strategy'})) if (target.hasAttribute(`data-${key}`)) {
    if (field === 'load') deck.draft = structuredClone(host.savedDecks.find(item => item.id === target.value) ?? normalizeSavedDeck({},''));else if (field === 'userId') deck.draft.userId = target.value;else deck[field] = target.value;renderShell();return;}
  if (target.hasAttribute('data-deck-import')) {const generation = shellGeneration;try {const parsed = JSON.parse(await target.files?.[0]?.text());if (generation !== shellGeneration || !Array.isArray(parsed)) return;host.savedDecks = saveDeckCollection(parsed);newDeckDraft();} catch {return;}}
  else if (target.hasAttribute('data-logo-profile')) {host.logoNoiseProfile = target.value;localStorage.setItem('sz-logo-noise-profile',target.value);}
  else if (target.hasAttribute('data-logo-video')) {entryLogoVideoFile = target.files?.[0] ?? null;host.logoVideoName = entryLogoVideoFile?.name ?? '';}
  else if (target.hasAttribute('data-tap-details')) {host.tapDetails = target.checked;surface?.configure({tapDetails:host.tapDetails});}
  else if (target.hasAttribute('data-catalog-expansion')) host.catalog.expansion = target.value;
  else if (target.hasAttribute('data-catalog-owner')) host.catalog.catalogOwner = target.value;
  else if (target.hasAttribute('data-sandbox-actor')) return switchManualViewer(target.value);
  else if (target.hasAttribute('data-sandbox-active')) {if (host.busy) return renderShell();admin({type:'sandboxSelectActiveSeat',targetSeat:target.value});}
  else if (target.hasAttribute('data-opponent-control')) {host.opponentControl = target.value;return prepared(() => startMatch('sandbox'));}
  else if (target.hasAttribute('data-tutorial-select')) return prepared(() => startMatch('tutorial',target.value));
  else {for (const id of ['player','ai']) for (const field of ['deck','user']) if (target.hasAttribute(`data-${id}-${field}`)) {
    host[`${id}${field === 'deck' ? 'DeckId' : 'UserId'}`] = target.value;
    if (field === 'deck') {const saved = host.savedDecks.find(item => `custom:${item.id}` === target.value);if (saved) host[`${id}UserId`] = saved.userId;}
    return host.screen === 'game' ? prepared(() => startMatch(host.mode === 'sandbox' ? 'sandbox' : 'ai')) : renderShell();}return;}
  renderShell();
});
const clearPress = () => {if (press) clearTimeout(press.timer);press = null;};
root.addEventListener('pointerdown',event => {const tile = event.target.closest('.deck-tile');if (!tile || event.button !== 0) return;
  clearPress();const generation = shellGeneration;press = {x:event.clientX,y:event.clientY,timer:setTimeout(() => {if (generation !== shellGeneration || !tile.isConnected) return;
    suppressDeckClickUntil = performance.now()+800;host.deckBuilder.detailId = tile.dataset.deckCardId ?? tile.dataset.deckSummaryId;renderShell();clearPress();},480)};});
root.addEventListener('pointermove',event => {if (press && Math.hypot(event.clientX-press.x,event.clientY-press.y)>8) clearPress();});
for (const name of ['pointerup','pointercancel','pointerleave']) root.addEventListener(name,clearPress);
// Escape is taken on the document: opening the options or closing the deck builder leaves the focus
// on <body>, and the key must still close the window or go back from there (V092-08).
document.addEventListener('keydown',event => {if (event.key === 'Escape' && !event.target.closest?.('[data-match-root]')) {
  if (host.debug) return closeDebug();
  const back = escapeScreen(host.screen,{overlayOpen:host.options || host.deckBuilder.open || host.catalogOpen});
  if (back) return goTo(back);
  host.options = false;host.deckBuilder.detailId = null;renderShell();}});
window.addEventListener('pagehide',() => {markWonTutorial();clearPress();mobileViewport.dispose();lifecycle.dispose();surface = null;session = null;});
window.addEventListener('pageshow',event => {if (event.persisted) location.reload();});
renderShell(true);registerPwa();
// The running release, read once as the page starts (debug window).
void loadBuildRevision().then(build => {host.build = build;if (host.debug) renderShell();});

// Explicit test-mode hook: semantic commands and detached safe reads only.
if (new URLSearchParams(location.search).get('e2e') === '1') window.__SIMPLE_ZEKE_E2E__ = Object.freeze({
  start:(mode,tutorialId = 'basics',seed = 1) => {const result = startMatch(mode,tutorialId,seed);return result.ok ? {ok:true,value:session.scope()} : result;},
  // A tutorial started as a new match from one of its checkpoints (the test repository's step-by-step files).
  startFromCheckpoint:(file,checkpointId) => {const result = lifecycle.startFromCheckpoint({file,checkpointId});
    if (!result.ok) return result;host.mode = 'tutorial';host.tutorialId = file.tutorialId;attachSession(result.value);return {ok:true,value:session.scope()};},
  query:(seat = host.actor,input) => session?.port(seat).value?.query(input) ?? {ok:false,error:{code:'MATCH_UNAVAILABLE'}},
  queryAction:(input,seat = host.actor) => session?.port(seat).value?.queryAction(input),
  submit:(input,seat = host.actor) => {const result = session?.port(seat).value?.submit(input);surface?.refresh();return result;},
  sandbox:action => admin(action),scope:() => session?.scope() ?? null,tutorial:() => session?.tutorial(),
  advanceTutorial:() => {const result = session?.advanceTutorial();surface?.refresh();return result;},skipTutorial,
  refresh:() => surface?.refresh(),switchViewer:switchManualViewer
});
