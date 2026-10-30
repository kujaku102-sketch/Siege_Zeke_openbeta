import { compileEffectText } from "../../../packages/effect-compiler/index.js";
import { CARD_LIBRARY } from "../../data/cards.js";
import { cardRuntimeRoute } from "../card-runtime-specs.js";
import { normalizeLayerState } from "../layer-state.js";
import { keywordValue } from "./keywords.js";

// Cards are compiled when they are prepared (hydrateCard, and CARD_RUNTIME_ROUTES), not while they are played.
// Views of a card that do not carry `compiled` (planning views, snapshots, test objects) read these results, which are
// made for every library card when this module loads; only a text that is not in the library is compiled on first use.
const KEYWORD_COMPILES = new Map();
const CARD_COMPILES = new Map();
const cardKey = (card) => `${card?.id}\u0000${card?.category}\u0000${card?.text ?? ""}`;
for (const card of Object.values(CARD_LIBRARY)) {
  KEYWORD_COMPILES.set(card.text ?? "", compileEffectText(card.text));
  CARD_COMPILES.set(cardKey(card), compileEffectText(card.text ?? "", { category: card.category, id: card.id }));
}

// The compile result keyword lookups read: the card's own, else the one prepared for its text.
export function compiledForKeywords(card) {
  if (card.compiled) return card.compiled;
  if (typeof card.text !== "string" && card.text !== undefined) return compileEffectText(card.text);
  const key = card.text ?? "";
  if (!KEYWORD_COMPILES.has(key)) KEYWORD_COMPILES.set(key, compileEffectText(card.text));
  return KEYWORD_COMPILES.get(key);
}

// The compile result for a card's text, id and category (what hydrateCard attaches to an instance); the re-execution check reads it.
// It does not trust a view's own `compiled`: planning views carry results made without the id.
export function compiledForCard(card) {
  const key = cardKey(card);
  if (!CARD_COMPILES.has(key)) CARD_COMPILES.set(key, compileEffectText(card?.text ?? "", { category: card?.category, id: card?.id }));
  return CARD_COMPILES.get(key);
}

export function normalizeClasses(instance) {
  const values = instance.classes ?? instance.cardClass ?? instance.className ?? instance.class
    ?? instance.affiliation ?? instance.tribe ?? instance.species ?? instance["所属"] ?? instance["種族"] ?? [];
  return [...new Set((Array.isArray(values) ? values : String(values).split(/[\/／]/))
    .map((value) => String(value).trim()).filter(Boolean))];
}

export function hydrateCard(instance) {
  if (!cardRuntimeRoute(instance.id)) throw new Error(`Unregistered card runtime: ${instance.id}`);
  const compiled = compileEffectText(instance.text, { category: instance.category, id: instance.id });
  const printedCategory = instance.printedCategory ?? instance.category;
  return normalizeLayerState({
    ...instance,
    category: instance.category === "LOb" ? "Ob" : instance.category,
    printedCategory,
    classes: normalizeClasses(instance),
    compiled,
    faceDown: instance.faceDown === true,
    protect: Number(instance.protect ?? keywordValue({ ...instance, compiled }, "PROTECT") ?? 0)
  });
}
