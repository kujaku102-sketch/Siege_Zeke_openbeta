import { boardSlotOf, cardAtBoardSlot } from "../../board-slots.js";
import { addLog, findCard } from "../../core/shared.js";
import { PASS } from "./index.js";
import { createVengeanceCard, emitEffectPlacement, placeByMode } from "../generic/placement.js";

export function std231ActivateScriptCore({ state, playerId, script }) {
  const target = findCard(state, state.prompt?.eventContext?.cardUid);
  if (target && ["front", "back"].includes(target.zoneName)) {
    const owner = state.players[target.playerId];
    const context = { controllerId: target.playerId, zoneName: target.zoneName, limit: owner.user?.[`${target.zoneName}Limit`] };
    const targetSlot = boardSlotOf(owner[target.zoneName], target.card, context);
    let count = 0;
    for (const slot of [targetSlot - 1, targetSlot + 1]) {
      if (slot < 1 || slot > context.limit || cardAtBoardSlot(owner[target.zoneName], slot, context)) continue;
      const proof = createVengeanceCard(state, "STD-228", playerId);
      if (placeByMode(state, target.playerId, proof, { zone: target.zoneName, from: "generated", source: script.name, requestedSlot: slot }) === "placed") { emitEffectPlacement(state, target.playerId, proof, target.zoneName, script.name); count += 1; }
    }
    addLog(state, `${script.name}: ${target.card.name}の両隣りへ征服の証${count}枚を配置。`, "effect");
  }
  return PASS;
}
