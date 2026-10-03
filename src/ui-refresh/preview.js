import "../styles.css";
import "./preview.css";
import { CARD_LIBRARY } from "../data/cards.js";
import { cardHtml } from "../ui/render.js";
import { createPreviewFixture } from "./fixture.js";
import { beginPlacement, commitPlacement, operationLocked, placementOptions } from "./placement.js";
import { clearSelection, cardSelection, canCancelSelection, cancelSelection, fitBoard, gestureMoved, placePopup, readSavedView, resolveView, saveView } from "./model.js";
import { desktopHtml, mobileHtml, entryHtml, detailHtml, popupHtml, visibleCard, modes, esc } from "./view.js";

const root = document.querySelector("#app");
let storage;
try { storage = window.localStorage; } catch { /* Browser storage can be unavailable. */ }
const decision = resolveView({ pathname: location.pathname, saved: readSavedView(storage), mobile: navigator.userAgentData?.mobile, userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints });
let view = decision.view;
let screen = "entry";
let mode = "sandbox";
const fixture = createPreviewFixture();
let selection = clearSelection();
let draft = null;
let tapDetails = true;
let handOpen = true;
let gesture = null;
let longTimer = null;
let suppressClick = false;
let resizeObserver = null;
let drawer = null;
let notice = "";
const LONG_PRESS_MS = 500; // Provisional; tune on physical devices after GUI review.

function headerHtml() {
  return `<header class="r2-header"><button class="r2-brand" data-home aria-label="入口へ戻る">Siege<span>÷</span>Zeke</button><span class="r2-preview-badge">GUI PREVIEW <b>実験場：通常Ob配置</b></span><nav>${screen === "game" ? `<span>${modes[mode]}</span>` : ""}<span class="r2-view-label">${view === "mobile" ? "MOBILE" : "PC"}</span><button data-options>オプション</button></nav></header>`;
}
function render() {
  cancelGesture();
  const handScroll = root.querySelector(".r2-hand-scroll")?.scrollLeft ?? 0;
  resizeObserver?.disconnect();
  document.body.dataset.view = view ?? "choose";
  const choose = `<section class="r2-choose"><h1>表示を選ぶ</h1><p>この端末の表示を自動判定できなかった。後から変更できるよ。</p><button data-view="pc">PC版</button><button data-view="mobile">モバイル版</button></section>`;
  root.innerHTML = `<div class="r2-content">${headerHtml()}${!view ? choose : screen === "entry" ? entryHtml(view) : screen === "deck" ? deckHtml() : view === "pc" ? desktopHtml(fixture, mode) : mobileHtml(fixture, mode)}<div class="r2-overlays" data-overlays></div><div data-drawer></div><footer class="r2-footer"><span>LOCAL GUI STUDY / CSS ONLY</span><span>${esc(notice || "配置は暫定 · 保存デッキと実対戦は変更しません")}</span></footer></div><section class="r2-rotate" role="status" hidden><span aria-hidden="true">↻</span><h1>端末を横向きにしてください</h1><p>このGUIは横画面専用です。横に戻すと表示を再開します。</p><button data-view="pc">PC版へ切り替える</button></section>`;
  if (screen === "game") {
    const stage = root.querySelector(".r2-stage");
    resizeObserver = new ResizeObserver(() => { resizeBoard(); positionOverlays(); });
    resizeObserver.observe(stage);
    resizeBoard();
    updateHand();
    root.querySelector(".r2-hand-scroll").scrollLeft = handScroll;
    root.querySelectorAll(".fortress").forEach(button => { button.disabled = true; button.title = "ユーザー詳細は接続待ち"; });
    refreshSelection();
  }
  renderDrawer();
  updateOrientation();
}
function deckHtml() {
  return `<main class="r2-deck"><header><div><span class="r2-eyebrow">DECK BUILDER / LAYOUT STUDY</span><h1>デッキ構築</h1><p>カード一覧の表示見本。構築・保存操作は既存機能への接続待ち。</p></div><button data-home>入口へ戻る</button></header><div class="r2-catalog">${Object.entries(CARD_LIBRARY).filter(([id]) => /^STD-/.test(id)).map(([id, card]) => `<article><strong>${esc(card.name)}</strong><small>${esc(id)} / ${esc(card.category)}</small><p>${esc(card.text)}</p><button disabled>追加 · 接続待ち</button></article>`).join("")}</div></main>`;
}
function resizeBoard() {
  const stage = root.querySelector(".r2-stage");
  const board = root.querySelector(".r2-board");
  if (!stage || !board) return;
  const size = fitBoard(stage.clientWidth, stage.clientHeight);
  board.style.width = `${size.width}px`;
  board.style.height = `${size.height}px`;
  const canvas = board.querySelector(".r2-board-fit");
  const legacy = canvas.querySelector(".battle-board");
  const scale = Math.min(size.width / canvas.offsetWidth, size.height / legacy.offsetHeight);
  canvas.style.height = `${legacy.offsetHeight}px`;
  canvas.style.transform = `translate(-50%, -50%) scale(${scale})`;
}
function refreshSelection() {
  const overlays = root.querySelector("[data-overlays]");
  if (!overlays || screen !== "game") return;
  updateCancelButton();
  root.querySelectorAll(".r2-stage [data-card-uid], .r2-hand [data-card-uid], .r2-zone-drawer [data-card-uid]").forEach(card => {
    const selected = card.dataset.cardUid === selection.selectedUid;
    card.classList.toggle("selected", selected);
    card.setAttribute("aria-pressed", String(selected));
  });
  overlays.innerHTML = detailHtml(fixture, selection.detailUid) + popupHtml(fixture, selection.selectedUid, { placementEnabled: mode === "sandbox", draft })
    + (mode === "tutorial" ? `<aside class="r2-guide" aria-label="チュートリアル窓の配置見本"><span class="r2-eyebrow">TUTORIAL / WINDOW STUDY</span><h2>カードを選んでみよう</h2><p>操作ポップはカードのそば、詳細は左上。対象を隠さない窓位置を確認するための見本です。</p><button data-skip>スキップして自由盤面へ</button></aside>` : "");
  // The miniature is a visual, not another selectable or draggable card.
  root.querySelectorAll(".r2-detail-mini button").forEach(button => { button.disabled = true; button.tabIndex = -1; });
  refreshPlacement();
  positionOverlays();
}
function refreshPlacement() {
  const board = root.querySelector(".r2-board");
  board.classList.toggle("r2-choosing-placement", Boolean(draft));
  board.querySelectorAll("[data-place-slot]").forEach(button => button.remove());
  board.querySelectorAll(".r2-legal-slot").forEach(slot => slot.classList.remove("r2-legal-slot"));
  if (!draft) return;
  for (const { zone, slot } of placementOptions(fixture, draft.sourceUid).slots) {
    const host = board.querySelector(`.zone-${zone}[data-player="player"] [data-slot-index="${slot}"]`);
    if (!host) continue;
    host.classList.add("r2-legal-slot");
    const button = document.createElement("button");
    button.dataset.placeSlot = String(slot);
    button.dataset.placeZone = zone;
    button.className = "r2-place-slot";
    button.textContent = "ここに実行";
    button.setAttribute("aria-label", `${zone === "front" ? "フロント" : "バック"} ${slot} に実行`);
    host.append(button);
  }
}
function viewportRect() {
  const viewport = window.visualViewport;
  return { left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0, width: viewport?.width ?? innerWidth, height: viewport?.height ?? innerHeight };
}
function positionOverlays() {
  const popup = root.querySelector(".r2-popup");
  const anchor = selection.selectedUid ? [...root.querySelectorAll(".r2-stage [data-card-uid], .r2-hand [data-card-uid], .r2-zone-drawer [data-card-uid]")].find(card => card.dataset.cardUid === selection.selectedUid) : null;
  if (popup && !anchor) popup.hidden = true;
  if (popup && anchor) {
    const rect = anchor.getBoundingClientRect();
    const hand = anchor.closest(".r2-hand-scroll");
    const handRect = hand?.getBoundingClientRect();
    const visible = !anchor.closest("[hidden]") && (!handRect || (rect.right > handRect.left && rect.left < handRect.right));
    popup.hidden = !visible;
    if (visible) {
      const pos = placePopup(rect, popup.getBoundingClientRect(), viewportRect());
      popup.style.left = `${pos.left}px`;
      popup.style.top = `${pos.top}px`;
      popup.dataset.side = pos.side;
      popup.dataset.overflow = String(pos.overflow);
    }
  }
  const guide = root.querySelector(".r2-guide");
  if (guide) {
    // Provisional GUI collision choice; never reflows the board or tutorial state.
    guide.classList.toggle("r2-guide-top", Boolean(anchor && anchor.getBoundingClientRect().top > innerHeight / 2));
  }
}
function renderDrawer() {
  const host = root.querySelector("[data-drawer]");
  if (drawer === "options") {
    host.innerHTML = `<div class="r2-modal" data-modal><section role="dialog" aria-modal="true" aria-label="オプション"><header><h2>オプション</h2><button data-close-drawer aria-label="オプションを閉じる">×</button></header><p>表示版を変更しても、このプレビューの盤面と選択は保持します。</p><div class="r2-view-options"><button data-view="pc" aria-pressed="${view === "pc"}">PC版</button><button data-view="mobile" aria-pressed="${view === "mobile"}">モバイル版</button></div><label><input type="checkbox" data-tap-details ${tapDetails ? "checked" : ""}>比較用：通常タップで詳細を開く</label><small>OFFでも長押しで詳細を開けます。製品版の初期値は実機評価後に決定。</small><p>演出：OFF（CSS表示のみ）</p><small>WebGLの強／弱は次工程。</small></section></div>`;
    host.querySelector("[data-close-drawer]")?.focus();
  } else if (drawer && typeof drawer === "object") {
    const { owner, zone } = drawer;
    host.innerHTML = `<aside class="r2-zone-drawer" aria-label="${zone === "registry" ? "レジストリ" : "ゴミ箱"}"><header><h2>${owner === "player" ? "自分" : "相手"} / ${zone === "registry" ? "レジストリ" : "ゴミ箱"}</h2><button data-close-drawer aria-label="エリア一覧を閉じる">×</button></header><div>${fixture.players[owner][zone].map(card => cardHtml(fixture, owner, card, zone)).join("") || "カードなし"}</div></aside>`;
  } else if (drawer === "log") {
    host.innerHTML = `<aside class="r2-zone-drawer r2-log" aria-label="ログ"><header><h2>操作ログ</h2><button data-close-drawer aria-label="ログを閉じる">×</button></header><p>ローカル試験盤面のエンジンログ。選択・中止は記録しません。</p>${fixture.log.map(item => `<p>${esc(item.text)}</p>`).join("")}</aside>`;
  } else host.innerHTML = "";
  const modalOpen = drawer === "options";
  root.querySelectorAll(".r2-header, main, .r2-entry, .r2-choose, [data-overlays]").forEach(node => { node.inert = modalOpen; });
  if (screen === "game") { updateCancelButton(); positionOverlays(); }
}
function updateOrientation() {
  const portrait = view === "mobile" && innerHeight > innerWidth;
  root.querySelector(".r2-rotate").hidden = !portrait;
  root.querySelector(".r2-content").inert = portrait;
  root.querySelector(".r2-content").classList.toggle("r2-portrait-blocked", portrait);
  if (portrait) cancelGesture();
}
function select(uid, inspect = false) {
  if (cancelBlocked() || !visibleCard(fixture, uid)) return;
  if (!inspect && uid !== selection.selectedUid) draft = null;
  const next = cardSelection(selection, uid, { inspect });
  selection = !inspect && !tapDetails ? { ...next, detailUid: selection.detailUid } : next;
  refreshSelection();
}
function cancelGesture() { clearTimeout(longTimer); longTimer = null; gesture = null; }
function cancelBlocked() {
  // Only UI drafts are cancellable. Never discard an engine choice or rewind.
  return drawer === "options" || operationLocked(fixture);
}
function updateCancelButton() {
  const button = root.querySelector("[data-cancel]");
  if (!button) return;
  button.disabled = !canCancelSelection(selection, { blocked: cancelBlocked() });
  button.title = cancelBlocked() ? "処理中の選択は中止できません" : button.disabled ? "中止する選択はありません" : "現在の選択を解除（確定済み操作は戻しません）";
}
function cancelCurrentOperation({ restoreFocus = false } = {}) {
  cancelGesture();
  const next = cancelSelection(selection, { blocked: cancelBlocked() });
  if (next === selection) return;
  const previousUid = selection.selectedUid ?? selection.detailUid;
  draft = null;
  selection = next;
  refreshSelection();
  if (restoreFocus) {
    const anchor = [...root.querySelectorAll(".r2-stage [data-card-uid], .r2-hand [data-card-uid], .r2-zone-drawer [data-card-uid]")]
      .find(card => card.dataset.cardUid === previousUid && !card.closest("[hidden]"));
    (anchor ?? root.querySelector("[data-options]"))?.focus();
  }
}
function updateHand() {
  const hand = root.querySelector(".r2-mobile-hand, .r2-desktop-hand");
  const toggle = root.querySelector("[data-hand-toggle]");
  if (hand) hand.hidden = !handOpen;
  if (toggle) {
    toggle.setAttribute("aria-expanded", String(handOpen));
    toggle.textContent = handOpen ? "手札を畳む" : "手札を開く";
  }
}
const interactiveCard = target => target.closest(".r2-stage [data-card-uid], .r2-hand [data-card-uid], .r2-zone-drawer [data-card-uid]");
root.addEventListener("pointerdown", event => {
  cancelGesture();
  if (!event.isPrimary) { suppressClick = true; return; }
  suppressClick = false;
  if (!event.isPrimary || event.button !== 0 || drawer === "options") return;
  const card = interactiveCard(event.target);
  const hand = event.target.closest(".r2-hand-scroll");
  if (!card && !hand) return;
  gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, uid: card?.dataset.cardUid, moved: false, long: false };
  if (card) longTimer = setTimeout(() => {
    if (!gesture || gesture.moved) return;
    gesture.long = true;
    suppressClick = true;
    select(gesture.uid, true);
  }, LONG_PRESS_MS);
});
root.addEventListener("pointermove", event => {
  if (!gesture || gesture.id !== event.pointerId) return;
  if (gestureMoved(gesture, { x: event.clientX, y: event.clientY })) {
    gesture.moved = true;
    suppressClick = true;
    clearTimeout(longTimer);
  }
}, { passive: true });
window.addEventListener("pointerup", event => {
  if (gesture?.id === event.pointerId) {
    suppressClick = gesture.moved || gesture.long;
    cancelGesture();
  }
});
root.addEventListener("pointercancel", () => { suppressClick = true; cancelGesture(); });
root.addEventListener("scroll", event => {
  if (event.target.matches?.(".r2-hand-scroll")) {
    if (gesture) { gesture.moved = true; suppressClick = true; clearTimeout(longTimer); }
    positionOverlays();
  }
}, true);
root.addEventListener("dragstart", event => { if (event.target.closest(".card")) event.preventDefault(); });
for (const type of ["pointerover", "pointerout", "focusin", "focusout"]) {
  root.addEventListener(type, event => {
    if (event.target.closest(".r2-hand .hand-card")) requestAnimationFrame(positionOverlays);
  });
}
root.addEventListener("contextmenu", event => { if (interactiveCard(event.target)) event.preventDefault(); });
root.addEventListener("click", event => {
  if (suppressClick && event.detail !== 0) { event.preventDefault(); return; }
  const target = event.target;
  const button = target.closest("button");
  if (button?.disabled) return;
  if (button?.dataset.view) {
    view = button.dataset.view;
    const saved = saveView(storage, view);
    notice = saved ? "表示設定を保存しました" : "このブラウザでは保存できません。このタブ内で適用します";
    history.replaceState(null, "", `/${view}/${location.search}${location.hash}`);
    drawer = null;
    return render();
  }
  if (button?.matches("[data-home]")) { screen = "entry"; drawer = null; draft = null; selection = clearSelection(); return render(); }
  if (button?.dataset.mode) { mode = button.dataset.mode; screen = "game"; draft = null; selection = clearSelection(); return render(); }
  if (button?.matches("[data-deck]")) { screen = "deck"; draft = null; selection = clearSelection(); return render(); }
  if (button?.matches("[data-options]")) { drawer = "options"; return renderDrawer(); }
  if (button?.matches("[data-cancel]")) return cancelCurrentOperation({ restoreFocus: true });
  if (button?.matches("[data-begin-placement]") && mode === "sandbox" && !cancelBlocked()) {
    draft = beginPlacement(fixture, selection.selectedUid);
    refreshSelection();
    if (event.detail === 0) root.querySelector("[data-place-slot]")?.focus();
    return;
  }
  if (button?.matches("[data-place-slot]") && mode === "sandbox" && !cancelBlocked()) {
    const zone = button.dataset.placeZone, slot = Number(button.dataset.placeSlot);
    const uid = draft?.sourceUid;
    const name = visibleCard(fixture, uid)?.card.name;
    const applied = commitPlacement(fixture, draft, zone, slot);
    draft = null;
    selection = clearSelection();
    notice = applied ? `${name}を${zone === "front" ? "フロント" : "バック"} ${slot} に実行しました` : "配置条件が変わったため実行しませんでした。選び直してください";
    render();
    const anchor = [...root.querySelectorAll(".r2-stage [data-card-uid]")].find(card => card.dataset.cardUid === uid);
    (anchor ?? root.querySelector("[data-options]"))?.focus();
    return;
  }
  if (button?.matches("[data-close-drawer]")) { drawer = null; renderDrawer(); refreshSelection(); root.querySelector("[data-options]")?.focus(); return; }
  if (button?.matches("[data-log]")) { drawer = drawer === "log" ? null : "log"; return renderDrawer(); }
  if (button?.matches(".admin-row [data-admin-zone]")) { drawer = { owner: button.dataset.owner, zone: button.dataset.adminZone }; renderDrawer(); return; }
  if (button?.matches("[data-skip]")) { mode = "sandbox"; return render(); }
  if (button?.matches("[data-close-detail]")) { selection = { ...selection, detailUid: null }; return refreshSelection(); }
  if (button?.matches("[data-hand-toggle]")) {
    handOpen = !handOpen;
    updateHand();
    return positionOverlays();
  }
  const card = interactiveCard(target);
  if (card) return select(card.dataset.cardUid);
  if (drawer === "options" || target.closest(".r2-detail, .r2-popup, .r2-guide, .r2-zone-drawer, .r2-console, .r2-header, button, input, label, a")) return;
  if (screen === "game") cancelCurrentOperation();
});
root.addEventListener("change", event => { if (event.target.matches("[data-tap-details]")) tapDetails = event.target.checked; });
document.addEventListener("keydown", event => {
  if (event.key === "Tab" && drawer === "options") {
    const controls = [...root.querySelectorAll('[role="dialog"] button, [role="dialog"] input')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  if (event.key === "Escape") {
    event.preventDefault();
    if (drawer) {
      drawer = null;
      renderDrawer();
      refreshSelection();
      root.querySelector("[data-options]")?.focus();
    } else if (screen === "game") cancelCurrentOperation({ restoreFocus: true });
  }
});
window.addEventListener("resize", () => { cancelGesture(); updateOrientation(); resizeBoard(); positionOverlays(); });
window.visualViewport?.addEventListener("resize", positionOverlays);
document.addEventListener("visibilitychange", cancelGesture);
window.addEventListener("blur", cancelGesture);
render();
