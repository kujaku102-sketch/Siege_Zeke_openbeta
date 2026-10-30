import { addLog, fail, shuffle } from "./shared.js";
import { emitUserAbilityFeedback } from "./triggers.js";
import { drawCardRaw, startTurn } from "./turn.js";

// 開始手順(規則書2.4)。openingProtocol="v2.4" の試合だけ、ゲーム開始前に各ユーザーが1回(BIGBOSSは最大3回)
// 手札の任意枚数を山札の下へ戻して同数引き直せる。決定は seat 順(player→ai)に1人ずつ行い、最後の決定の中で
// ダイスを振って先攻を決め、ターンを開始する。未指定("legacy")は従来どおり先攻=player固定で、BIGBOSSだけ全手札を引き直せる。
export const OPENING_ORDER = Object.freeze(["player", "ai"]);

export const openingMulliganLimit = (player) => (player.user.abilityKey === "watching_you" ? 3 : 1);

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
export function finishOpeningDecision(state) {
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
