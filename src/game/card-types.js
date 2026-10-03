const OB_CATEGORIES = new Set(["Ob", "VOb", "LOb", "Lyd-Ob"]);

export const isObCategory = (category) => OB_CATEGORIES.has(category);
export const isLydCategory = (category) => category === "Lyd" || category === "Lyd-Ob";

export const isObCard = (card) => isObCategory(card?.category) || isObCategory(card?.printedCategory);
export const isLydCard = (card) => isLydCategory(card?.category) || isLydCategory(card?.printedCategory);

// Broad Ob references include every Ob subtype. Explicit subtype references stay narrow.
export function matchesCardCategory(card, expected) {
  if (expected === "Ob") return isObCard(card);
  if (expected === "Lyd") return isLydCard(card);
  if (expected === "Lyd-Ob") return card?.category === "Lyd-Ob" || card?.printedCategory === "Lyd-Ob";
  return card?.category === expected;
}

export const excludesCardCategory = (card, excluded) => !matchesCardCategory(card, excluded);
