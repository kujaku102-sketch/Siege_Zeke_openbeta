import { panelHeadHtml } from "./cyber-panel.js";

// Online play (design: サーバー設計-詳細.md §14.1): the door, the code to join, the room until both are ready, and what the
// match adds over the board (the opponent's name and line, the player's own reconnecting, 投了). DOM-free: every screen is
// drawn from `host.online` ({ available, name, code, state: online-client.js state, error, copied, confirming }) and a clock.
const esc = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const head = (id, title, back = "戻る") => `<header class="r2-flow-head"><button class="r2-flow-back" data-flow-back>${back}</button><h1 id="${id}">${title}</h1></header>`;

// What a failure says to the player. A code not listed reads as the general one.
const ERROR_TEXT = Object.freeze({
  ROOM_CODE_INVALID: "コードが違います。8文字を確かめてください。",
  ROOM_NOT_FOUND: "部屋が見つかりません。期限が切れたかもしれません。",
  ROOM_CLOSED: "部屋は閉じられました（期限切れ）。",
  ROOM_FULL: "この部屋は満員です。",
  SERVER_BUSY: "サーバーが混み合っています。しばらくしてから試してください。",
  RATE_LIMITED: "操作が多すぎます。少し待ってから試してください。",
  SERVER_UNREACHABLE: "サーバーにつながりません。",
  FORBIDDEN: "このページからはつなげません。",
  CONNECTION_LOST: "接続が切れました。",
  REPLACED: "別のタブでこの部屋に入りました。",
  DECK_INVALID: "このデッキは構築規定に合いません。",
  WRONG_STATE: "前の部屋の処理が終わっていません。",
  PROTOCOL: "通信に失敗しました。"
});
export const onlineErrorText = code => code ? ERROR_TEXT[code] ?? "通信に失敗しました。" : "";

// Typing a room code: wide letters and lower case are read as the code's own letters, spaces and hyphens are dropped,
// and the hyphen is put back after the fourth letter. A letter the codes never use stays out.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function typedRoomCode(value) {
  const letters = [...String(value ?? "").normalize("NFKC").toUpperCase()].filter(char => ALPHABET.includes(char)).slice(0, 8).join("");
  return letters.length > 4 ? `${letters.slice(0, 4)}-${letters.slice(4)}` : letters;
}

// Seconds left until a time, never below zero; m:ss for the room's 15 minutes.
export const secondsLeft = (until, now) => Number.isFinite(until) ? Math.max(0, Math.ceil((until - now) / 1000)) : null;
const clock = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

const errorLine = online => {
  const text = onlineErrorText(online?.error?.code ?? online?.state?.error?.code);
  return text ? `<p class="r2-flow-error" role="alert">${esc(text)}</p>` : "";
};
const section = (screen, title, body) => `<section class="r2-flow r2-flow-online" data-flow-screen="${screen}" aria-labelledby="r2-flow-${screen}-title"><div class="r2-flow-sheet">${body}</div></section>`;
const busyAttr = busy => busy ? ' aria-disabled="true" data-busy' : "";

// The door: a guest name, the deck and user to play, and the two ways in. Without a server the ways are shut.
export function onlineEntryHtml(host, { deckOptions, userOptions }) {
  const online = host.online ?? {}, busy = ["creating", "joining"].includes(online.state?.status) || !online.available;
  return section("online-entry", "オンライン対戦", `${head("r2-flow-online-entry-title", "オンライン対戦")}`
    + `<p class="r2-flow-lead">${online.available ? "部屋コードで友だちと対戦します。" : "オンライン対戦のサーバーは準備中です。"}</p>`
    + `<div class="r2-flow-sides"><fieldset class="r2-flow-side" data-side="online"><legend>自分</legend>`
    + `<label>名前<input data-online-name maxlength="16" autocomplete="nickname" enterkeyhint="done" value="${esc(online.name ?? "")}" placeholder="ゲスト"></label>`
    + `<label>デッキ<select data-player-deck>${deckOptions(host.playerDeckId)}</select></label>`
    + `<label>ユーザー<select data-player-user>${userOptions(host.playerUserId)}</select></label></fieldset></div>`
    + `<div class="r2-flow-actions"><button class="r2-flow-primary" data-online-create${busyAttr(busy)}>${online.state?.status === "creating" ? "部屋を作っています…" : "部屋を作る"}</button>`
    + `<button data-flow="open-join"${busyAttr(!online.available)}>コードで入る</button></div>${errorLine(online)}`);
}

// The code from the other player: eight letters, pasted or typed, then 入る.
export function onlineJoinHtml(host) {
  const online = host.online ?? {}, joining = online.state?.status === "joining";
  return section("online-join", "コードで入る", `${head("r2-flow-online-join-title", "コードで入る")}`
    + `<p class="r2-flow-lead">相手から聞いた8文字のコードを入れてください。</p>`
    + `<label class="r2-online-code-field">部屋コード<input data-online-code inputmode="text" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="24" placeholder="K7M2-QX9D" value="${esc(online.code ?? "")}"></label>`
    + `<div class="r2-flow-actions"><button class="r2-flow-primary" data-online-join${busyAttr(joining || !online.available)}>${joining ? "入っています…" : "入る"}</button></div>${errorLine(online)}`);
}

const seatHtml = (seat, side, { deckName, userName }) => {
  if (!seat) return `<article class="r2-online-seat is-${side} is-empty"><h2>相手</h2><p>まだいません</p></article>`;
  const away = side === "opponent" && seat.connected === false;
  return `<article class="r2-online-seat is-${side}" data-ready="${Boolean(seat.ready)}"><h2>${esc(seat.name)}<small>${side === "you" ? "自分" : "相手"}</small></h2>`
    + (side === "you" ? `<p>${esc(deckName)} / ${esc(userName)}</p>` : seat.userId ? `<p>${esc(userName)}</p>` : "")
    + `<span class="r2-online-state">${away ? "接続が切れています" : seat.ready ? "準備完了" : "準備中"}</span></article>`;
};

// The room: its code large while the other player is still to come, then both players and 準備完了.
export function onlineRoomHtml(host, { now, deckName = "", userName = "", opponentUserName = "", canShare = false }) {
  const online = host.online ?? {}, state = online.state ?? {}, you = state.you, opponent = state.opponent;
  const left = secondsLeft(state.expiresAt, now);
  const connection = state.connection === "reconnecting" ? `<p class="r2-online-wait" role="status">再接続しています…（${state.attempt ?? 1}回目）</p>` : "";
  const waiting = !opponent;
  const code = `<div class="r2-online-code${waiting ? "" : " is-small"}" aria-label="部屋コード"><b>${esc(state.display ?? "")}</b></div>`;
  const share = `<div class="r2-flow-actions"><button data-online-copy>${online.copied ? "コピーしました" : "コピー"}</button>${canShare ? "<button data-online-share>共有</button>" : ""}</div>`;
  const body = waiting
    ? `<p class="r2-flow-lead">このコードを相手に伝えてください。</p>${code}${share}`
      + `<p class="r2-online-wait" role="status">相手を待っています…${left !== null ? `<span>あと ${clock(left)}</span>` : ""}</p>`
    : `${code}<div class="r2-online-seats">${seatHtml(you, "you", { deckName, userName })}${seatHtml(opponent, "opponent", { userName: opponentUserName })}</div>`
      + `<div class="r2-flow-actions">${you?.ready ? '<button data-online-unready>準備をやめる</button>' : '<button class="r2-flow-primary" data-online-ready>準備完了</button>'}</div>`
      + `<p class="r2-online-wait" role="status">${you?.ready ? "相手の準備を待っています…" : "準備完了を押すと、両者そろったところで対戦が始まります。"}${left !== null ? `<span>あと ${clock(left)}</span>` : ""}</p>`;
  return section("online-room", "部屋", `${head("r2-flow-online-room-title", "部屋", "部屋を閉じる")}${body}${connection}${errorLine(online)}`);
}

// Over the board in an online match: who the opponent is and whether their line holds, the player's own reconnecting
// (with the time the server keeps the seat), and 投了 with its question. A finished match offers the way out instead.
// Drawn in the match's own parts (文豪, 2026-11-05: 「ゲーム内の部品はこっちを流用する」): the settings window's panel and its
// buttons for the strip and the banner, and the window itself (backdrop, panel, head) for the question.
export function onlineHudHtml(host, { now }) {
  const online = host.online ?? {}, state = online.state ?? {};
  if (!state.status || state.status === "idle") return "";
  const finished = state.status === "finished" || state.status === "closed";
  const opponent = state.opponent;
  const away = !finished && opponent && opponent.connected === false;
  const awayLeft = secondsLeft(state.opponentAwayUntil, now);
  const badge = away ? `<span class="r2-online-badge is-away">切断…${awayLeft !== null ? `あと${awayLeft}秒` : ""}</span>`
    : finished ? "" : `<span class="r2-online-badge${state.connection === "open" ? "" : " is-away"}">${state.connection === "open" ? "接続中" : "通信待ち"}</span>`;
  const selfLeft = secondsLeft(state.selfAwayUntil, now);
  const self = !finished && state.connection === "reconnecting"
    ? `<span class="r2-online-self" role="status">再接続しています…（${state.attempt ?? 1}回目）${selfLeft !== null ? `あと${selfLeft}秒` : ""}</span>` : "";
  const action = finished ? '<button data-online-leave>タイトルに戻る</button>' : '<button data-online-concede>投了</button>';
  const banner = away ? `<aside class="r2-online-banner cp-panel" role="status">相手の接続が切れました。${awayLeft !== null ? `あと${awayLeft}秒待ちます` : "待っています"}</aside>` : "";
  const confirm = online.confirming && !finished ? '<div class="r2-modal" role="alertdialog" aria-modal="true" aria-label="投了の確認"><section class="cp-panel r2-online-confirm">'
    + panelHeadHtml({ eyebrow: "MATCH", sub: "CONCEDE.SYS", title: "投了しますか？", close: "data-online-concede-no", closeLabel: "やめる" })
    + '<p>この対戦は負けになります。</p><nav class="r2-online-confirm-actions"><button data-online-concede-yes>投了する</button><button data-online-concede-no>やめる</button></nav></section></div>' : "";
  return `<aside class="r2-online-hud cp-panel" aria-label="オンライン対戦"><span class="r2-online-opponent">相手：<b>${esc(opponent?.name ?? "")}</b></span>${badge}${self}${action}</aside>${banner}${confirm}`;
}

// The end screen's line under its title: why the match ended, from the player's side.
const REASON_TEXT = Object.freeze({
  win: { normal: "勝ち", concede: "相手が投了しました", disconnect: "相手の接続が切れたため勝ち" },
  lose: { normal: "負け", concede: "投了しました", disconnect: "接続が切れたため負け" },
  draw: { normal: "引き分け" },
  aborted: { "both-disconnected": "両者の接続が切れたため中断", storage: "サーバーの保存に失敗したため中断", "max-age": "時間の上限に達したため中断" }
});
export function onlineResultReason(outcome) {
  if (!outcome?.result) return "";
  const texts = REASON_TEXT[outcome.result] ?? {};
  return texts[outcome.reason] ?? (outcome.result === "aborted" ? "中断" : texts.normal ?? "");
}
