import { INTRINSIC_KEYWORDS as INTRINSIC_KEYWORD_TABLE } from "../../cards/compiler-presets.js";
import { compiledForKeywords } from "./prepare.js";

// Keywords a card has although its text does not say so (card-side data, see src/cards/std/std_100.js).
const INTRINSIC_KEYWORDS = new Map(Object.entries(INTRINSIC_KEYWORD_TABLE));

export function hasKeyword(card, name) {
  if (INTRINSIC_KEYWORDS.get(card.id)?.includes(name)) return true;
  const compiled = compiledForKeywords(card);
  return compiled.keywords.some((keyword) => keyword.name === name && keyword.intrinsic !== false) || card.grantedKeywords?.includes(name);
}

export function keywordValue(card, name) {
  const compiled = compiledForKeywords(card);
  const keyword = compiled.keywords.find((item) => item.name === name && item.intrinsic !== false);
  if (!keyword) return null;
  if (keyword.value === null && ["PROTECT", "BACKUP"].includes(name)) return 1;
  return keyword.value;
}
