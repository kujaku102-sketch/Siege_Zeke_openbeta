// カードテキストから確定した「イベント条件 → アクション列」の宣言的定義。
// 実行コードをカードごとに持たず、共通アクションを組み合わせる。

import { collectSpecList, collectFlagged } from "../cards/index.js";
import { TRIGGER_SPEC_ORDER, SHARED_TRIGGER_ORDER } from "../cards/spec-order.js";

const TRIGGER_SPECS = Object.freeze(collectSpecList("triggerSpecs", TRIGGER_SPEC_ORDER));

export const SHARED_TRIGGER_CARD_IDS = Object.freeze(collectFlagged("sharedTriggerCard", SHARED_TRIGGER_ORDER));

export function specsForEvent(eventType) {
  return TRIGGER_SPECS.filter((spec) => spec.event === eventType);
}

export function optionalSpecsForCard(cardId) {
  return TRIGGER_SPECS.filter((spec) => spec.cardId === cardId && spec.activation === "optional");
}

export function hasOptionalActivationSpec(cardId) {
  return TRIGGER_SPECS.some((spec) => spec.cardId === cardId && spec.activation === "optional");
}
