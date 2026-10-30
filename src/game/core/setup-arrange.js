import { CARD_LIBRARY, LAB_CARD_IDS } from "../../data/cards.js";
import { TUTORIAL_BLUE_HAND, TUTORIAL_OPPONENT_STR, TUTORIAL_RED_HAND } from "../../data/tutorial-script.js";
import { createRuntimeCard } from "../runtime/factory.js";
import { hydrateCard, pullCard } from "./setup.js";
import { addLog } from "./shared.js";
import { drawCardRaw } from "./turn.js";

// 赤(基本操作)。台本どおりの初手: グレン(インストール用)・兵士(無色)・切込隊長アツト・ジャンクパーツ。
// 相手は黄の席だが手札はセキュリティのObガードマン1枚だけ(山札の並びや引きには頼らない)。
export function arrangeTutorial(players, runtimeContext = null) {
  players.ai.fortressStr = TUTORIAL_OPPONENT_STR;
  players.player.hand = TUTORIAL_RED_HAND.map((id, index) => hydrateCard(createRuntimeCard(runtimeContext, id, "player", 501 + index)));
  players.ai.hand = [hydrateCard(createRuntimeCard(runtimeContext, "STD-022", "ai", 511))];
}

export function arrangeVengeanceTutorial(players, runtimeContext = null) {
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
