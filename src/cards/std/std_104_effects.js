// STD-104 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { keywordValue } from "../../../packages/effect-compiler/index.js";
import { createSelectionRequest } from "../../game/selection-model.js";
import { PASS } from "../../game/effects/custom/index.js";

// handlers (was effects/custom/std_104.js)
export function std104ResolveSpell({ player, targetUid, card, playerId, state }) {
  const target = player.hand.find((item) => item.uid === targetUid && item.printedCategory === "Lyd-Ob");
  if (!target) return;
  const requirement = String(keywordValue(target, "LAYERED") ?? "");
  const candidates = player.deck.filter((item) => requirement.includes(item.name) || (item.classes ?? []).some((name) => requirement.includes(name)));
  target.revealed = true;
  target.revealedExecutionCost = 1;
  if (candidates.length) {
    const request = createSelectionRequest({ mode: "single", candidates: candidates.map((item) => item.uid), count: 1,
      label: "公開Lyd-Obに対応するカードへアクセス", message: card.text,
      continuation: { type: "q2-access-hand", playerId, sourceName: card.name } });
    state.pending = { type: "selection", validTargets: request.candidates, request };
  }
  return PASS;
}
