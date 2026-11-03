import { CARD_LIBRARY, LAB_CARD_IDS } from "../../data/cards.js";
import { TUTORIAL_BLACK_DRAWS, TUTORIAL_BLACK_HAND, TUTORIAL_BLACK_OPPONENT_FRONT, TUTORIAL_BLACK_OPPONENT_HAND, TUTORIAL_BLACK_REGISTRY,
  TUTORIAL_BLUE_HAND, TUTORIAL_OPPONENT_STR, TUTORIAL_PURPLE_FRONT, TUTORIAL_PURPLE_HAND, TUTORIAL_PURPLE_OPPONENT_HAND, TUTORIAL_PURPLE_REGISTRY, TUTORIAL_RED_HAND,
  TUTORIAL_YELLOW_DRAWS, TUTORIAL_YELLOW_HAND, TUTORIAL_YELLOW_OPPONENT_HAND, TUTORIAL_YELLOW_REGISTRY } from "../../data/tutorial-script.js";
import { createRuntimeCard } from "../runtime/factory.js";
import { drawCardRaw } from "./draw.js";
import { hydrateCard } from "./prepare.js";
import { addLog } from "./shared.js";

// 赤(基本操作)。台本どおりの初手: グレン(インストール用)・兵士(無色)・切込隊長アツト・ジャンクパーツ。
// 相手は黄の席だが手札はセキュリティのObガードマン1枚だけ(山札の並びや引きには頼らない)。
export function arrangeTutorial(players, runtimeContext = null) {
  players.ai.fortressStr = TUTORIAL_OPPONENT_STR;
  players.player.hand = TUTORIAL_RED_HAND.map((id, index) => hydrateCard(createRuntimeCard(runtimeContext, id, "player", 501 + index)));
  players.ai.hand = [hydrateCard(createRuntimeCard(runtimeContext, "STD-022", "ai", 511))];
}

// 紫(レイヤード・移動)。文豪の台本どおりの初期状況: 手札5枚(コピー＆ペイスターと淫魔像は使わない)、フロントにドールズ2体、
// 使わない紫のカード1枚を最初からレジストリに置いて紫シンボルを点灯、メモリはユーザーの上限5のまま。
// 相手は無色のサンドバッグデッキで、手札はライダーとメルク(山札の並びや引きには頼らない)。
export function arrangeVengeanceTutorial(players, runtimeContext = null) {
  players.ai.fortressStr = TUTORIAL_OPPONENT_STR;
  const cards = (ids, owner, first) => ids.map((id, index) => hydrateCard(createRuntimeCard(runtimeContext, id, owner, first + index)));
  players.player.hand = cards(TUTORIAL_PURPLE_HAND, "player", 301);
  players.player.front = cards(TUTORIAL_PURPLE_FRONT, "player", 311);
  for (const card of players.player.front) card.summoningSick = false;
  players.player.registry = cards(TUTORIAL_PURPLE_REGISTRY, "player", 321);
  players.player.user.color = "紫";
  players.ai.hand = cards(TUTORIAL_PURPLE_OPPONENT_HAND, "ai", 331);
}

// 一つの場所へ、台本の並びで作ったカードを置く。山札の上(配列の末尾)から、draws の先頭が最初に引かれる順に積む。
const tutorialCards = (runtimeContext, ids, owner, first) => ids.map((id, index) => hydrateCard(createRuntimeCard(runtimeContext, id, owner, first + index)));
const stackOnDeck = (player, cards) => { player.deck.push(...[...cards].reverse()); };

// 黄(セキュリティ・OC)。相手先攻(setup.js)。手札は大盾の騎士・伝令・華守り2枚(実物)、使わない黄のカード1枚を最初からレジストリに置いて点灯、
// 山札の上は台本の引く順(TUTORIAL_YELLOW_DRAWS)、メモリはユーザーの上限5のまま。相手の手札はライダー・歩兵・騎馬兵。
export function arrangeYellowTutorial(players, runtimeContext = null) {
  players.ai.fortressStr = TUTORIAL_OPPONENT_STR;
  players.player.hand = tutorialCards(runtimeContext, TUTORIAL_YELLOW_HAND, 'player', 601);
  players.player.registry = tutorialCards(runtimeContext, TUTORIAL_YELLOW_REGISTRY, 'player', 621);
  stackOnDeck(players.player, tutorialCards(runtimeContext, TUTORIAL_YELLOW_DRAWS, 'player', 631));
  players.ai.hand = tutorialCards(runtimeContext, TUTORIAL_YELLOW_OPPONENT_HAND, 'ai', 651);
}

// 黒(ログアウトと破壊・デコード)。先攻は自分。手札4枚、黒のカード1枚を最初からレジストリに置いて点灯、山札の上はレメゲトン・任意・邪神との取引
// (TUTORIAL_BLACK_DRAWS)、相手の場にメルクA、手札にメルクB。
export function arrangeBlackTutorial(players, runtimeContext = null) {
  players.ai.fortressStr = TUTORIAL_OPPONENT_STR;
  players.player.hand = tutorialCards(runtimeContext, TUTORIAL_BLACK_HAND, 'player', 701);
  players.player.registry = tutorialCards(runtimeContext, TUTORIAL_BLACK_REGISTRY, 'player', 721);
  stackOnDeck(players.player, tutorialCards(runtimeContext, TUTORIAL_BLACK_DRAWS, 'player', 731));
  players.ai.front = tutorialCards(runtimeContext, TUTORIAL_BLACK_OPPONENT_FRONT, 'ai', 751);
  for (const card of players.ai.front) card.summoningSick = false;
  players.ai.hand = tutorialCards(runtimeContext, TUTORIAL_BLACK_OPPONENT_HAND, 'ai', 761);
}

// 青(セキュリティ・ハッキング・暗号化)。手札はルチル・漣・フラウ・セキュリティウォールの4枚、場・レジストリは空。
// 山札(オフェンスプロトコル1枚とアサルトプログラム)の並びには頼らない: ルチルのアクセスで山札は混ぜられるが、
// 手札に移るのはオフェンスプロトコルだけなので、残りはすべてアサルトプログラムになる。
// 相手は無色のサンドバッグデッキで、手札は装甲兵 メルク(STD-043)1枚だけ。
export function arrangeBlueTutorial(players, runtimeContext = null) {
  players.ai.fortressStr = TUTORIAL_OPPONENT_STR;
  players.player.hand = TUTORIAL_BLUE_HAND.map((id, index) => hydrateCard(createRuntimeCard(runtimeContext, id, "player", 401 + index)));
  players.ai.hand = [hydrateCard(createRuntimeCard(runtimeContext, "STD-043", "ai", 411))];
}

export function arrangeSandbox(players, { useConfiguredDecks = false } = {}, runtimeContext = null) {
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

export function arrangeLab(players, runtimeContext = null) {
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
