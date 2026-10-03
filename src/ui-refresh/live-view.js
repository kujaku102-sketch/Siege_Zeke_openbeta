import { USER_CARDS } from "../data/cards.js";
import { currentTutorialPresentation } from "../data/tutorial.js";
import { tutorialNavigator } from "../data/navigator-assets.js";
import { findCard } from "../game/engine.js";
import { hasKeyword } from "../game/effect-compiler.js";
import { cardDetailHtml, contextualActions, controlsHtml, selectionPanelHtml, triggerThreadHtml, modalHtml, adminDrawerHtml, promptToastHtml, deckBuilderHtml, deckOptionsHtml, sandboxCatalogHtml, handCardsHtml, pendingLabel, tutorialTextHtml, artPreviewHtml, uniqueEffectModalHtml } from "../ui/render.js";
import { boardHtml, entryHtml, esc } from "./view.js";
import { actionLogHtml } from "./action-log.js";
import { actorFor, canLeaveTutorial, canStepBackInput, resolutionBusy, securityCandidates } from "./session.js";
import { isObCard } from "../game/card-types.js";

function settingsHtml(state, ui) {
  if (ui.screen === "entry") {
    const volume = Math.max(0, Math.min(10, Number(ui.masterVolume ?? 7)));
    const toggle = (label, selector, checked) => `<button class="r2-title-setting" ${selector} role="checkbox" aria-checked="${checked}">${label}<span aria-hidden="true">${checked ? "☑" : "□"}</span></button>`;
    const contents = `<header><h2>オプション</h2><button data-live="close-options">閉じる</button></header><div class="r2-title-settings-list">${toggle("全画面", 'data-live="fullscreen"', Boolean(ui.fullscreen))}${toggle("PC版", 'data-view="pc"', ui.view === "pc")}${toggle("モバイル版", 'data-view="mobile"', ui.view === "mobile")}${toggle("通常タップで詳細", 'data-title-tap-details', Boolean(ui.tapDetails))}${toggle("演出", 'data-toggle-effects', Boolean(ui.effectsEnabled))}<div class="r2-title-volume"><span>音量</span><div role="group" aria-label="音量 0～10">${Array.from({ length: 10 }, (_, index) => `<button data-volume="${index + 1}" aria-label="音量 ${index + 1}" aria-pressed="${index < volume}"></button>`).join("")}</div><output>${volume}/10</output></div><p>音量設定は今後のサウンド向けに保存されます。</p></div>`;
    return `<div class="r2-modal r2-title-options${ui.entryCrtMenu ? " r2-title-options-crt" : ""}" role="dialog" aria-modal="true" aria-label="オプション"><section>${contents}</section></div>`;
  }
  const users = selected => Object.entries(USER_CARDS).map(([id, user]) => `<option value="${id}" ${selected === id ? "selected" : ""}>${esc(user.name)}</option>`).join("");
  const busy = resolutionBusy(state) || ui.aiPacing?.active || ui.draft;
  const setupOnly = ui.screen === "entry";
  const navigation = `<nav class="live-menu-nav"><button data-live="home" ${busy ? "disabled" : ""}>入口へ戻る</button><button data-deck-open>デッキ構築</button><button data-live="fullscreen">${ui.fullscreen ? "全画面を解除" : "全画面"}</button></nav><p>全画面はタップで開始します。通知バー・カメラ穴周辺の表示可否は端末とブラウザによります。</p>`;
  return `<div class="r2-modal${ui.entryCrtMenu ? " r2-entry-crt-menu" : ""}" role="dialog" aria-modal="true" aria-label="オプション">${ui.entryCrtMenu ? '<svg class="r2-entry-crt-filter" aria-hidden="true" width="0" height="0"><filter id="r2-entry-menu-warp" x="-3%" y="-3%" width="106%" height="106%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.002 0.005" numOctaves="1" seed="7" result="grain"/><feDisplacementMap in="SourceGraphic" in2="grain" scale="2" xChannelSelector="R" yChannelSelector="G"/></filter></svg>' : ""}<section><header><h2>オプション</h2><button data-live="close-options">閉じる</button></header>${navigation}<div class="r2-view-options"><button data-view="pc" aria-pressed="${ui.view === "pc"}">PC版</button><button data-view="mobile" aria-pressed="${ui.view === "mobile"}">モバイル版</button></div><p>${setupOnly ? "デッキ・ユーザーを選んでからモードを選択できます。" : "表示版の切替では対戦を保持します。デッキ・ユーザーの変更は新しい対戦を開始します。"}</p><label><input data-tap-details type="checkbox" ${ui.tapDetails ? "checked" : ""}>通常タップで詳細を表示（長押しは常に使用可）</label><button data-toggle-effects aria-pressed="${Boolean(ui.effectsEnabled)}">演出 ${ui.effectsEnabled ? "ON" : "OFF"}</button><label>ロゴのノイズ<select data-logo-profile>${[["random","ランダム切替"],["distress","劣化のみ"],["mosaic","モザイクのみ"]].map(([value,label])=>`<option value="${value}" ${(ui.logoNoiseProfile??"random")===value?"selected":""}>${label}</option>`).join("")}</select></label><label>ロゴのノイズ動画（任意）<input data-logo-video type="file" accept="video/*"></label><p>${ui.logoVideoName ? esc(ui.logoVideoName)+"（このタブのみ）" : "動画未選択：生成ノイズを使用"}</p>${ui.logoVideoName ? '<button data-logo-video-clear>生成ノイズに戻す</button>' : ""}<fieldset ${busy ? "disabled" : ""}><legend>対戦設定</legend>
    <label>学ぶ内容<select data-tutorial-select ${state.mode !== "tutorial" ? "disabled" : ""}><option value="basics" ${state.tutorialId === "basics" ? "selected" : ""}>基本操作・赤</option><option value="vengeance" ${state.tutorialId === "vengeance" ? "selected" : ""}>ヴェンジェンス・紫</option></select></label>
    ${["player", "ai"].map(id => `<label>${id === "player" ? "自分" : "相手"}デッキ<select data-${id}-deck ${!setupOnly && state.mode === "tutorial" ? "disabled" : ""}>${deckOptionsHtml(state, ui[`${id}DeckId`] ?? state[`${id}DeckId`])}</select></label><label>${id === "player" ? "自分" : "相手"}ユーザー<select data-${id}-user ${!setupOnly && state.mode === "tutorial" ? "disabled" : ""}>${users(ui[`${id}UserId`] ?? state[`${id}UserId`])}</select></label>`).join("")}
    ${state.mode === "sandbox" ? `<label>相手操作<select data-opponent-control><option value="manual">手動</option><option value="ai" ${state.sandboxUi?.opponentControl === "ai" ? "selected" : ""}>AI</option></select></label><label>操作側<select data-sandbox-actor ${state.sandboxUi?.opponentControl === "ai" ? "disabled" : ""}><option value="player">YOU</option><option value="ai" ${actorFor(state) === "ai" ? "selected" : ""}>OPPONENT</option></select></label>` : ""}</fieldset></section></div>`;
}

function popup(state, ui) {
  const found = findCard(state, state.selectedUid);
  if (!found || state.pending) return "";
  let actions = contextualActions(state, found);
  if (found.zoneName === "hand" && found.card.category === "Sp") actions = actions.replace(/(<button data-action="play-front"[^>]*>)[^<]+/, '$1起動する');
  if (found.zoneName === "hand" && (isObCard(found.card) || ["Code", "Script"].includes(found.card.category)) && !hasKeyword(found.card, "LAYERED")) {
    actions = actions.replace(/<button data-action="(?:play-front|play-back|set-script|prepare-mount|prepare-code-under)"[^>]*>[^<]*<\/button>/g, "");
    if (found.playerId === actorFor(state) && state.active === actorFor(state) && !state.securityRestWindow && !state.winner && !resolutionBusy(state)) actions += `<button data-live="execute">${found.card.category === "Script" ? "設置する" : "実行する"}</button>`;
  }
  return actions ? `<aside class="r2-popup" aria-label="カード操作"><strong>${esc(found.card.name)}</strong>${actions}</aside>` : "";
}

// UI-only projection: no board/hand HTML, game mutation, or tutorial advancement.
export function liveInteractionHtml(state, flow, ui, cache = null) {
  const actor = actorFor(state);
  const projected = { ...state, viewerId: actor, pending: ui.draft ?? state.pending };
  const readUid = ui.detailUid;
  const found = findCard(state, readUid);
  const visibleSelectionCandidate = state.pending?.type === "selection"
    && state.pending.request?.candidates?.includes(readUid)
    && found?.playerId === actor;
  const permitted = !found || (found.zoneName !== "deck" || visibleSelectionCandidate)
    && (found.playerId === actor || found.zoneName !== "hand" && !found.card.faceDown);
  const buildDetail = () => cardDetailHtml({ ...state, selectedUid: readUid }, "r2-detail", false).replace(/(<aside[^>]*>)/, '$1<button data-live="close-detail">詳細を閉じる</button>');
  // Permission is checked even on a hit; callers invalidate on game mutations.
  const detail = readUid && permitted ? cache ? cache.reuse("detail-html", [state, actor, readUid], buildDetail) : buildDetail() : "";
  const blocking = resolutionBusy(state);
  const turn = `<span>TURN ${state.turnNumber} / ${state.active === "player" ? "YOU" : "OPPONENT"}${ui.aiPacing?.active ? " / CPU処理中" : ""}</span>`;
  let controls = controlsHtml(projected, flow, ui).replace(/<button[^>]*data-action="(?:undo|cancel|toggle-mobile-menu)"[^>]*>.*?<\/button>/g, "");
  const confirmActions = controls.match(/<button[^>]*data-action="(?:confirm-selection|confirm-effect-targets|confirm-layered)"[^>]*>.*?<\/button>/g) ?? [];
  controls = controls.replace(/<button[^>]*data-action="(?:confirm-selection|confirm-effect-targets|confirm-layered)"[^>]*>.*?<\/button>/g, "");
  controls += `<button data-live="cancel" ${canStepBackInput(state, ui, ui.aiPacing?.active) ? "" : "disabled"}>戻る</button>`;
  const security = state.securityRestWindow === actor ? `<section class="live-security" role="status"><b>ターン終了時：任意スリープ</b><p>スリープするカードを選択。選ばずターン交代もできます。</p>${securityCandidates(state, actor).map(card => `<button data-security-uid="${esc(card.uid)}">${esc(card.name)}をスリープ</button>`).join("")}</section>` : "";
  const result = state.winner || state.victory?.lockedOutcome;
  const commands = `<aside class="r2-console" aria-label="ターン操作">${turn}${controls}${security}${result ? `<p role="status">${state.victory?.finished ? "GAME FINISHED" : "RESULT LOCKED"} / ${esc(result)}</p>` : ""}<button data-live="log">ログ</button>${state.mode === "sandbox" ? '<button data-live="catalog">カード追加</button>' : ""}</aside>`;
  const selectionPanel = selectionPanelHtml(projected, {
    collapsible: projected.pending?.type === "selection",
    collapsed: projected.pending?.type === "selection" && ui.selectionCollapsedFor === projected.pending.request
  });
  const selectionWithConfirm = projected.pending?.type === "selection" && confirmActions.length
    ? selectionPanel.replace(/<\/aside>$/, `<div class="selection-confirm">${confirmActions.join("")}</div></aside>`) : selectionPanel;
  const target = projected.pending && projected.pending.type !== "selection"
    ? `<aside class="r2-target-dock" aria-label="盤面の選択操作"><span>TARGET CONTROL</span><p role="status">${ui.draft?.type === "placement" ? "明るいマスを選択" : esc(pendingLabel(projected.pending))}</p>${confirmActions.join("")}</aside>` : "";
  const extras = selectionWithConfirm + modalHtml(projected) + triggerThreadHtml(state) + adminDrawerHtml(projected) + promptToastHtml(state) + artPreviewHtml(state, ui) + (ui.uniqueOpen ? uniqueEffectModalHtml(projected, actor) : "");
  return { commands, target, detail, popup: popup(projected, ui), extras, notice: ui.notice ? `<aside class="r2-notice" role="status">${esc(ui.notice)}</aside>` : "" };
}

const region = (name, html) => `<div data-live-region="${name}" style="display:contents">${html}</div>`;

export function matchResultHtml(state) {
  const outcome = state.victory?.lockedOutcome ?? state.winner;
  if (!outcome || !(state.victory?.finished ?? Boolean(state.winner))) return "";
  const result = outcome === "draw" ? "DRAW" : outcome === "player" ? "VICTORY" : "DEFEAT";
  const label = outcome === "draw" ? "引き分け" : outcome === "player" ? "勝利" : "敗北";
  return `<div class="r2-result" role="dialog" aria-modal="true" aria-label="対戦結果" data-outcome="${esc(outcome)}"><canvas class="r2-result-fx" aria-hidden="true"></canvas><section class="r2-result-panel"><small>MATCH COMPLETE</small><h2>${result}</h2><p>${label}</p><nav><button data-live="rematch">再戦</button><button data-live="home">タイトルに戻る</button></nav></section></div>`;
}

export function liveHtml(state, flow, ui, cache = null) {
  if (!ui.view) return `<div class="r2-modal" role="dialog" aria-modal="true" aria-label="表示版を選択"><section><h1>表示版を選んでください</h1><p>この端末は自動判定できません。後からオプションで変更できます。</p><button data-view="pc">PC版</button><button data-view="mobile">モバイル版</button></section></div>`;
  const actor = actorFor(state);
  const projected = { ...state, viewerId: actor, pending: ui.draft ?? state.pending };
  const inGame = ui.screen === "game";
  const parts = inGame ? liveInteractionHtml(state, flow, ui, cache) : { notice: ui.notice ? `<aside class="r2-notice" role="status">${esc(ui.notice)}</aside>` : "" };
  const commands = region("commands", parts.commands);
  const hand = inGame ? `<section class="r2-hand" aria-label="操作側の手札 ${state.players[actor].hand.length}枚"><div class="r2-hand-scroll hand-scroll" tabindex="0" aria-label="手札を横スクロール">${handCardsHtml(projected, actor)}</div></section>` : "";
  const layout = ui.view === "mobile" ? "mobile" : "desktop";
  // Construct only the visible tree: one board, or no board at the entry screen.
  const game = inGame ? `<main class="r2-${layout}" data-layout="${layout}"><div class="r2-stage">${boardHtml(projected)}</div><div class="r2-${layout}-tools">${commands}</div><div class="r2-${layout}-hand" data-layer="hand" ${ui.handOpen ? "" : "hidden"}>${hand}</div><button class="r2-hand-toggle" data-live="hand">${ui.handOpen ? "手札を畳む" : "手札を開く"}</button></main>` : "";
  const presentation = inGame && state.mode === "tutorial" && flow ? currentTutorialPresentation(flow) : null;
  const navigator = presentation ? tutorialNavigator(flow.tutorialId ?? state.tutorialId) : null;
  const guideStep = flow ? flow.introComplete ? `${flow.tutorialId}:${flow.index}` : `intro:${flow.introIndex}` : "";
  const guide = presentation ? `<aside class="r2-guide live-guide" aria-label="チュートリアル" data-tutorial-step="${esc(guideStep)}">
    <div class="live-guide-cast"><img src="${esc(navigator.src)}" alt="${esc(presentation.speaker)}の立ち絵" style="object-position:${esc(navigator.objectPosition)}"><strong>${esc(presentation.speaker)}</strong></div>
    <div class="live-guide-speech"><div class="live-guide-text" tabindex="0" role="region" aria-label="チュートリアルのセリフ"><p>${tutorialTextHtml(presentation)}</p>${flow.error ? `<p class="live-guide-error" role="alert">${esc(flow.error)}</p>` : ""}</div>
    <nav><button class="live-guide-skip" data-live="skip" aria-label="スキップして自由盤面へ" ${!canLeaveTutorial(state) ? "disabled" : ""}>スキップ</button>${presentation.intro ? '<button class="live-guide-next" data-action="dismiss-tutorial-overlay">次へ <span aria-hidden="true">▸</span></button>' : ""}</nav></div>
  </aside>` : "";
  const drawers = ui.options ? settingsHtml(state, ui) : ui.catalog ? `<div class="live-catalog"><button data-live="close-catalog">閉じる</button>${sandboxCatalogHtml(state)}</div>` : ui.log ? actionLogHtml(state) : "";
  const entry = !inGame ? entryHtml(ui.view, ui.effectsEnabled).replace('data-deck ', 'data-deck-open ') : "";
  return `<div class="r2-content" data-effects="${ui.effectsEnabled ? 'on' : 'off'}"><nav class="r2-utilities" aria-label="メニュー"><button data-live="options" aria-label="メニュー・オプション">メニュー</button></nav>${inGame ? game : entry}<div class="r2-overlays">${inGame ? region("detail", parts.detail) + region("popup", parts.popup) + region("target", parts.target) + guide : ""}</div>${inGame ? region("extras", parts.extras) : ""}${drawers}${deckBuilderHtml(state)}${region("notice", parts.notice)}${inGame ? matchResultHtml(state) : ""}</div><section class="r2-rotate" hidden role="status"><h1>端末を横向きにしてください</h1><p>横に戻すと、そのまま続きから操作できます。</p></section>`;
}
