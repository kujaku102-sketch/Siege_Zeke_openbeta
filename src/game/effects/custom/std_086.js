import { CARD_LIBRARY } from "../../../data/cards.js";
import { cardRuntimeSpec } from "../../card-runtime-specs.js";
import { runEffectEntry } from "../../core/effects.js";
import { executeRuntimeActions } from "../generic/actions.js";
import { resolveCardSelection } from "../generic/selection.js";

export function resolveLuckyShotAdditional(state, playerId, targetUid) {
  const continuation = state.pending?.request?.continuation;
  if (continuation?.type === "runtime-action-selection" && continuation.sourceId === "STD-086") {
    return resolveCardSelection(state, continuation, { selected: [targetUid] });
  }
  const source = state.deferredSpellCleanup?.card?.id === "STD-086"
    ? state.deferredSpellCleanup.card
    : { ...CARD_LIBRARY["STD-086"], uid: "STD-086-legacy-compat" };
  const selection = cardRuntimeSpec("STD-086", "spell")?.actions?.find((action) => action.type === "select");
  if (!selection) return false;
  state.pending = null;
  return runEffectEntry(state, "lucky-shot-additional", playerId, () => executeRuntimeActions(
    state,
    playerId,
    source,
    selection.afterActions,
    { targetUid, targetUids: [targetUid], runtime: { records: Object.create(null) } }
  ));
}
