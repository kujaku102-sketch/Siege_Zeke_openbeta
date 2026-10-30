import { nextRng } from "../runtime/rng.js";
import { RuntimeError } from "../runtime/factory.js";
import { CARD_LIBRARY } from "../../data/cards.js";
import { isObCard } from "../card-types.js";

export const otherPlayer = (id) => id === "player" ? "ai" : "player";

export const exactKeys = (value, keys) => isPlainObject(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));

export const isPlainObject = (value) => value !== null && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;

export const isCounter = (value) => Number.isSafeInteger(value) && value >= 0;

export const classKey = (value) => String(value ?? "").replaceAll("・", "").trim();

export const isElectronFairy = (card) => {
  const values = card.classes ?? card.cardClass ?? [];
  return (Array.isArray(values) ? values : String(values).split(/[\/／]/)).some((value) => classKey(value) === "エレクトロンフェアリー");
};

export const isSlashSpell = (card) => card.category === "Sp" && card.name.startsWith("/") && card.name.endsWith("/*");

export function shuffle(items, rng = Math.random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

export function runtimeRng(context) {
  return () => {
    const result = nextRng(context.rngState);
    if (!result.ok) throw new RuntimeError(result.error.code);
    context.rngState = result.value.state;
    return result.value.value;
  };
}

const logCardNames = Object.values(CARD_LIBRARY).filter((card) => card?.name).sort((a, b) => b.name.length - a.name.length);

function logSource(state, text, tone) {
  const quoted = text.match(/「([^」]+)」を.{0,16}(?:実行|インストール|配置|起動)/)?.[1];
  const source = logCardNames.find((card) => text.startsWith(`${card.name}:`)
    || text.startsWith(`${card.name}：`) || text.startsWith(`${card.name}が`)
    || text.startsWith(`${card.name}を`) || text.startsWith(`誘発: ${card.name}`)
    || quoted === card.name);
  if (!source) return { cardId: null, actor: ["action", "turn"].includes(tone) ? state.active : null };
  const ownersIn = (zones) => Object.entries(state.players ?? {}).filter(([, player]) =>
    zones.some((zone) => player[zone]?.some((card) => card.name === source.name))).map(([playerId]) => playerId);
  const publicOwners = ownersIn(["front", "back", "registry"]);
  const owners = publicOwners.length ? publicOwners : ownersIn(["hand", "trash"]);
  return { cardId: source.id, actor: owners.length === 1 ? owners[0] : tone === "action" ? state.active : null };
}

export function addLog(state, text, tone = "info", details = {}) {
  const source = logSource(state, text, tone);
  state.log.push({ id: `${Date.now()}-${state.log.length}`, text, tone, turn: state.turnNumber, ...source, ...details });
  if (state.log.length > 120) state.log.shift();
}

export function cardsInPlay(state) {
  const entries = [];
  for (const [playerId, player] of Object.entries(state.players)) {
    for (const zoneName of ["front", "back"]) for (const card of player[zoneName]) entries.push({ playerId, zoneName, card });
  }
  return entries;
}

export function hasClass(card, className) {
  const expected = classKey(className);
  return (card.classes ?? []).some((value) => classKey(value) === expected);
}

export function cardTraits(card) {
  const traits = [...new Set(Array.isArray(card.traits) ? card.traits : [])];
  if (isObCard(card) && (String(card.sourceSheet ?? "").includes("インセクト") || hasClass(card, "インセクト")) && !traits.includes("インセクト")) traits.push("インセクト");
  return traits;
}

export function sourceCardByName(state, playerId, sourceName) {
  const player = state.players[playerId];
  return [...player.front, ...player.back, ...player.hand, ...player.trash, ...player.registry]
    .find((card) => card.name === sourceName)
    ?? Object.values(CARD_LIBRARY).find((card) => card.name === sourceName);
}

export function activeCards(state, playerId, cardId) {
  const player = state.players[playerId];
  return [...player.front, ...player.back].filter((card) => card.id === cardId);
}

export function hasNoEffectText(card) {
  return /^(?:|\(効果なし\)|（効果なし）)$/.test(String(card?.text ?? "").trim());
}

export function isArmsBandCard(card) {
  const number = Number(String(card?.id ?? "").match(/^SZTB-(\d{3})$/)?.[1]);
  return card?.name?.includes("アームズバンド") || (number >= 90 && number <= 102);
}

export function isArmsBandOb(card) {
  return isArmsBandCard(card) && isObCard(card);
}

export function findCard(state, uid) {
  for (const [playerId, player] of Object.entries(state.players)) {
    for (const zoneName of ["hand", "front", "back", "registry", "trash", "deck"]) {
      const card = player[zoneName].find((item) => item.uid === uid);
      if (card) return { playerId, zoneName, card };
    }
  }
  return null;
}

export function provisional(state, text, card = null) {
  const key = `${card?.id ?? "RULE"}:${text}`;
  if (!state.provisional.some((item) => item.key === key)) state.provisional.push({ key, text, cardId: card?.id ?? null });
  addLog(state, `暫定処理: ${text}`, "warning");
}

// 勝敗固定後は新しいプレイ・発動宣言を受け付けない(宣言済み効果の解決だけが続く)。
const RESULT_LOCKED_MESSAGE = "勝敗が固定されたため新しい行動はできない。";

function resultLocked(state) {
  return Boolean(state.winner || state.victory?.lockedOutcome);
}

// 開始前のマリガン確認(state.opening)が終わるまで、通常の行動はできない。
const OPENING_BLOCKED_MESSAGE = "開始前の手札確認が終わるまで行動できない。";

export function newActionBlock(state) {
  return resultLocked(state) ? RESULT_LOCKED_MESSAGE : state.opening ? OPENING_BLOCKED_MESSAGE : null;
}

export function fail(state, message, silent) {
  state.message = message;
  if (!silent) addLog(state, message, "warning");
  return false;
}
