import { operation } from "./effect-operation-library.js";

const modifier = (options) => operation("modify_damage", {
  providerScope: "own_area",
  damageKind: "all",
  destination: "all",
  sourceFilter: "any",
  targetFilter: "any",
  operation: "add",
  ...options
});

// Card IDs are confined to this registry boundary. The engine evaluates every
// active provider through the same source / target / direction matcher.
export const CARD_DAMAGE_MODIFIER_SPECS = Object.freeze({
  "STD-039": Object.freeze([
    modifier({ direction: "dealt", amount: 1 }),
    modifier({ direction: "received", amount: -1 })
  ]),
  "STD-041": Object.freeze([
    modifier({ direction: "dealt", sourceFilter: { category: "Ob", effectText: "none" }, amount: 1 })
  ]),
  "STD-087": Object.freeze([
    modifier({ direction: "dealt", sourceFilter: { color: "赤" }, amount: 1 })
  ]),
  "STD-127": Object.freeze([
    modifier({
      direction: "dealt",
      sourceFilter: "provider",
      damageKind: "battle",
      destination: "card",
      operation: "set",
      amount: 0
    })
  ]),
  "STD-205": Object.freeze([
    modifier({
      direction: "received",
      sourceFilter: { classesAny: ["アーティファクト", "マスターピース"] },
      targetFilter: "provider",
      destination: "card",
      amount: -1
    })
  ])
});

export function damageModifierSpecsFor(cardId) {
  return CARD_DAMAGE_MODIFIER_SPECS[cardId] ?? Object.freeze([]);
}
