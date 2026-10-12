import { CARD_LIBRARY, USER_CARDS } from "../data/cards.js";
import { DECK_EVALUATION_AXES, DECK_STRATEGY_PROFILES, evaluateCardForDeck, strategyTargets } from "./card-deck-evaluation.js";

export const DECK_STORAGE_KEY = "simple-zeke.saved-decks.v1";
export const MAX_SAVED_DECKS = 20;

export const BUILDABLE_CARDS = Object.freeze(Object.values(CARD_LIBRARY)
  .filter((card) => card?.id && !card.token && !["VOb", "Plugin"].includes(card.category) && Number.isFinite(Number(card.cost)))
  .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: "base" })));
const BUILDABLE_EVALUATIONS = new Map(BUILDABLE_CARDS.map(card => [card.id,evaluateCardForDeck(card)]));

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

const addEvaluation = (totals, evaluation, copies = 1) => {
  for (const axis of DECK_EVALUATION_AXES) totals[axis] = Number(totals[axis] ?? 0) + Number(evaluation[axis] ?? 0) * copies;
};

const candidateScore = ({ card, evaluation, totals, targets, strategy, focusClass, color, copies }) => {
  const profile = DECK_STRATEGY_PROFILES[strategy] ?? DECK_STRATEGY_PROFILES.balanced;
  let score = card.color === color ? 7 : !card.color ? 2.5 : -5;
  for (const axis of DECK_EVALUATION_AXES) {
    const contribution = Number(evaluation[axis] ?? 0);
    if (!contribution) continue;
    const target = Number(targets[axis] ?? 0);
    const deficit = Math.max(0,target - Number(totals[axis] ?? 0));
    const need = target > 0 ? (deficit > 0 ? 1 + deficit / target : .12) : .08;
    score += contribution * Number(profile.weights[axis] ?? 1) * need * Number(evaluation.reliability ?? 1) * 4;
  }
  if (strategy === 'class_synergy' && focusClass && (card.classes ?? []).includes(focusClass)) score += 9;
  score -= copies * 1.4;
  return score;
};

export function recommendDeck({ userId = "doors_zx", color = "赤", strategy = "balanced", cards: existingCards = {} } = {}) {
  const rule = ruleFor(userId);
  const colored = BUILDABLE_CARDS.filter((card) => card.color === color || !card.color);
  const classCounts = new Map();
  for (const card of colored) for (const value of card.classes ?? []) classCounts.set(value, Number(classCounts.get(value) ?? 0) + 1);
  const cards = { ...normalizeSavedDeck({ userId, cards: existingCards }, "").cards };
  const fixedCardIds = new Set(Object.keys(cards));
  const nameCounts = new Map();
  const existingClassCounts = new Map();
  const totals = {};
  let kept = 0;
  for (const [id, count] of Object.entries(cards)) {
    const copies = Number(count);
    kept += copies;
    const existing = CARD_LIBRARY[id], name = existing.name;
    nameCounts.set(name, Number(nameCounts.get(name) ?? 0) + copies);
    for (const value of existing.classes ?? []) existingClassCounts.set(value,Number(existingClassCounts.get(value) ?? 0) + copies);
    addEvaluation(totals,BUILDABLE_EVALUATIONS.get(id) ?? evaluateCardForDeck(existing),copies);
  }
  const focusClass = [...(existingClassCounts.size ? existingClassCounts : classCounts)].sort((a,b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? null;
  const targets = strategyTargets(strategy,rule.size);
  let remaining = Math.max(0, rule.size - kept);
  while (remaining > 0) {
    const ranked = BUILDABLE_CARDS.map(card => {
      if (fixedCardIds.has(card.id)) return null;
      const used = Number(nameCounts.get(card.name) ?? 0);
      if (used >= rule.sameName) return null;
      const evaluation = BUILDABLE_EVALUATIONS.get(card.id);
      return {card,evaluation,score:candidateScore({card,evaluation,totals,targets,strategy,focusClass,color,copies:used})};
    }).filter(Boolean).sort((a,b) => b.score - a.score || a.card.id.localeCompare(b.card.id,undefined,{numeric:true}));
    const selected = ranked[0];
    if (!selected) break;
    cards[selected.card.id] = Number(cards[selected.card.id] ?? 0) + 1;
    nameCounts.set(selected.card.name,Number(nameCounts.get(selected.card.name) ?? 0) + 1);
    addEvaluation(totals,selected.evaluation);
    remaining -= 1;
  }
  const categories = Object.entries(cards).reduce((counts, [id, count]) => {
    const category = CARD_LIBRARY[id].category; counts[category] = Number(counts[category] ?? 0) + count; return counts;
  }, {});
  const offColor = Object.entries(cards).reduce((sum, [id, count]) => sum + (CARD_LIBRARY[id].color && CARD_LIBRARY[id].color !== color ? count : 0), 0);
  return {
    cards,
    explanation: `${color}・${DECK_STRATEGIES[strategy] ?? strategy}。既存${kept}枚を維持・${Math.max(0, rule.size - kept - remaining)}枚追加。${Object.entries(categories).map(([key,value]) => `${key}${value}`).join(" / ")}${focusClass && strategy === "class_synergy" ? ` / 軸:${focusClass}` : ""}${offColor ? ` / 枚数確保のため他色${offColor}` : ""}`
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
