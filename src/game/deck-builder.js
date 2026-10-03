import { CARD_LIBRARY, USER_CARDS } from "../data/cards.js";
import { isObCard } from "./card-types.js";

export const DECK_STORAGE_KEY = "simple-zeke.saved-decks.v1";
export const MAX_SAVED_DECKS = 20;

export const BUILDABLE_CARDS = Object.freeze(Object.values(CARD_LIBRARY)
  .filter((card) => card?.id && !card.token && !["VOb", "Plugin"].includes(card.category) && Number.isFinite(Number(card.cost)))
  .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: "base" })));

const COLOR_ORDER = ["赤", "黄", "紫", "青", "橙", "黒", "緑", "無色"];
const availableColors = new Set(BUILDABLE_CARDS.map((card) => card.color ?? "無色"));
export const DECK_COLOR_OPTIONS = Object.freeze([
  ...COLOR_ORDER.filter((color) => availableColors.has(color)),
  ...[...availableColors].filter((color) => !COLOR_ORDER.includes(color)).sort()
]);

const ruleFor = (userId) => {
  // Blank user-card restrictions inherit rulebook 2.1, not the short demo deck.
  const text = USER_CARDS[userId]?.deckRule ?? "40枚、同名3枚";
  return {
    size: Number(text.match(/(\d+)枚/)?.[1] ?? 40),
    sameName: Number(text.match(/同名(\d+)枚/)?.[1] ?? 3)
  };
};

export function normalizeSavedDeck(input, fallbackId = `deck-${Date.now()}`) {
  const cards = Object.fromEntries(Object.entries(input?.cards ?? {})
    .map(([id, count]) => [id, Math.max(0, Math.floor(Number(count) || 0))])
    .filter(([id, count]) => CARD_LIBRARY[id] && count > 0));
  return {
    id: String(input?.id || fallbackId),
    name: String(input?.name || "新規デッキ").slice(0, 40),
    userId: USER_CARDS[input?.userId] ? input.userId : "doors_zx",
    cards
  };
}

export function validateDeck(deck) {
  const normalized = normalizeSavedDeck(deck);
  const rule = ruleFor(normalized.userId);
  const count = Object.values(normalized.cards).reduce((sum, value) => sum + value, 0);
  const errors = [];
  if (count !== rule.size) errors.push(`カード枚数 ${count}/${rule.size}`);
  const nameCounts = new Map();
  for (const [id, copies] of Object.entries(normalized.cards)) {
    const name = CARD_LIBRARY[id].name;
    nameCounts.set(name, Number(nameCounts.get(name) ?? 0) + copies);
  }
  for (const [name, copies] of nameCounts) {
    if (copies > rule.sameName) errors.push(`${name}: ${copies}/${rule.sameName}枚`);
  }
  return { valid: errors.length === 0, errors, count, rule };
}

export function deckToRecipe(deck) {
  return Object.entries(normalizeSavedDeck(deck).cards).map(([id, count]) => [id, count]);
}

export const DECK_STRATEGIES = Object.freeze({
  balanced: "バランス", rush: "速攻", control: "コントロール", registry: "レジストリ",
  layered: "レイヤード", script: "Script", security: "セキュリティ", damage: "ダメージ",
  endurance: "回復・耐久", class_synergy: "クラスシナジー"
});

const includesAny = (card, terms) => terms.some((term) => `${card.name} ${card.text ?? ""}`.includes(term));
const roleScore = (card, strategy, focusClass) => {
  const cost = Number(card.cost ?? 0);
  const classes = card.classes ?? [];
  const scores = {
    balanced: isObCard(card) ? 4 : 2,
    rush: (isObCard(card) ? 6 : 0) + Math.max(0, 5 - cost) + (includesAny(card, ["[QA]", "[コンタクト]", "攻撃時"]) ? 5 : 0),
    control: (["Sp", "Script"].includes(card.category) ? 6 : 1) + (includesAny(card, ["破壊", "スリープ", "BAN", "ダメージ"]) ? 5 : 0),
    registry: (includesAny(card, ["レジストリ", "インストール", "アクセス"]) ? 8 : 0) + (isObCard(card) ? 2 : 0),
    layered: (includesAny(card, ["レイヤード", "レイヤー", "マウント", "オーバーライド"]) || card.printedCategory === "LOb" ? 9 : 0),
    script: (card.category === "Script" ? 9 : 0) + (includesAny(card, ["Script", "スクリプト"]) ? 5 : 0),
    security: (includesAny(card, ["セキュリティ", "プロテクト", "バックアップ", "暗号化"]) ? 8 : 0) + (isObCard(card) ? 2 : 0),
    damage: (includesAny(card, ["ダメージ", "攻撃", "+1/+0", "+2/+0"]) ? 7 : 0) + (Number(card.atk ?? 0) * 0.7),
    endurance: (includesAny(card, ["回復", "プロテクト", "バックアップ", "ファイアウォール"]) ? 9 : 0) + Number(card.str ?? 0) * 0.5,
    class_synergy: focusClass && classes.includes(focusClass) ? 10 : 0
  };
  return Number(scores[strategy] ?? scores.balanced);
};

export function recommendDeck({ userId = "doors_zx", color = "赤", strategy = "balanced" } = {}) {
  const rule = ruleFor(userId);
  const colored = BUILDABLE_CARDS.filter((card) => card.color === color || !card.color);
  const classCounts = new Map();
  for (const card of colored) for (const value of card.classes ?? []) classCounts.set(value, Number(classCounts.get(value) ?? 0) + 1);
  const focusClass = [...classCounts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const ranked = BUILDABLE_CARDS.map((card) => ({ card, score:
    (card.color === color ? 14 : !card.color ? 5 : -8) + roleScore(card, strategy, focusClass)
    - Math.max(0, Number(card.cost ?? 0) - 5) * 0.35
  })).sort((a, b) => b.score - a.score || a.card.id.localeCompare(b.card.id, undefined, { numeric: true }));
  const cards = {}; const nameCounts = new Map(); let remaining = rule.size;
  for (const { card } of ranked) {
    if (remaining <= 0) break;
    const used = Number(nameCounts.get(card.name) ?? 0);
    const copies = Math.min(rule.sameName - used, remaining);
    if (copies <= 0) continue;
    cards[card.id] = copies; nameCounts.set(card.name, used + copies); remaining -= copies;
  }
  const categories = Object.entries(cards).reduce((counts, [id, count]) => {
    const category = CARD_LIBRARY[id].category; counts[category] = Number(counts[category] ?? 0) + count; return counts;
  }, {});
  const offColor = Object.entries(cards).reduce((sum, [id, count]) => sum + (CARD_LIBRARY[id].color && CARD_LIBRARY[id].color !== color ? count : 0), 0);
  return {
    cards,
    explanation: `${color}・${DECK_STRATEGIES[strategy] ?? strategy}。${Object.entries(categories).map(([key,value]) => `${key}${value}`).join(" / ")}${focusClass && strategy === "class_synergy" ? ` / 軸:${focusClass}` : ""}${offColor ? ` / 枚数確保のため他色${offColor}` : ""}`
  };
}

export function loadSavedDecks(storage = globalThis.localStorage) {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(DECK_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.map((deck, index) => normalizeSavedDeck(deck, `deck-${index + 1}`))
      .slice(0, MAX_SAVED_DECKS) : [];
  } catch { return []; }
}

export function saveDeckCollection(decks, storage = globalThis.localStorage) {
  // A rule correction must not erase an older deck while another is saved.
  // Legality belongs to the save/play UI gate; retain repairable collections.
  const normalized = decks.map((deck, index) => normalizeSavedDeck(deck, `deck-${index + 1}`))
    .slice(0, MAX_SAVED_DECKS);
  storage?.setItem(DECK_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}
