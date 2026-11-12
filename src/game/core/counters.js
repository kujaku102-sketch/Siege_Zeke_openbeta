import { applyUserLoad } from "./deal-damage.js";
import { addLog } from "./shared.js";
import { checkMadnessOfCard, checkMadnessOfUser } from "./turn.js";

// The one way a counter is put on a card or a user. A target is { card } (a card in an area) or { userId }.
//   load    : a card gets card.load; a user loses STR maximum and STR and the incidents are looked at (deal-damage.js applyUserLoad)
//   madness : counters.madness on the target; once everything is put on, each target is judged on its own count, once (rulebook: 狂気カウンター)
// A counter put on several targets at once is put on all of them first, then judged target by target.
export function addCounterToTargets(state, targets, kind, amount, sourcePlayerId, sourceName = "効果") {
  const n = Number(amount ?? 0);
  if (!(n > 0) || !targets.length) return;
  for (const target of targets) {
    if (kind === "load") {
      if (target.userId) applyUserLoad(state, target.userId, n, sourcePlayerId, sourceName);
      else target.card.load = Number(target.card.load ?? 0) + n;
    } else {
      const holder = target.userId ? state.players[target.userId] : target.card;
      holder.counters ??= {};
      holder.counters[kind] = Number(holder.counters[kind] ?? 0) + n;
    }
  }
  if (kind === "madness") {
    for (const target of targets) {
      if (target.userId) checkMadnessOfUser(state, target.userId);
      else checkMadnessOfCard(state, target.card);
    }
  }
}
