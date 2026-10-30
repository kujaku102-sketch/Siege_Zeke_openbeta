// STD-184 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { enabledSymbols } from "../../game/core/play.js";
import { openNextQueuedSelection } from "../../game/core/projection.js";
import { addLog, fail } from "../../game/core/shared.js";
import { PASS } from "../../game/effects/custom/index.js";
import { emitCardPlacement, emitEffectPlacement, failForcedPlacement, placeByMode, placementResult } from "../../game/effects/generic/placement.js";

// handlers (was effects/custom/std_184.js)
export function std184PlaceObSelection(state, continuation, result, playerId, player) {
  state.pending = null;
  if (result.scope !== "Obとして配置する") { openNextQueuedSelection(state); return true; }
  const index = player.back.findIndex((item) => item.uid === continuation.sourceUid && item.id === "STD-184" && item.std184Script && item.faceDown);
  if (index < 0) { openNextQueuedSelection(state); return true; }
  const zone = player.front.length < player.user.frontLimit ? "front" : player.back.length - 1 < player.user.backLimit ? "back" : "front";
  const [card] = player.back.splice(index, 1);
  card.category = "Ob";
  delete card.std184Script;
  card.faceDown = false;
  card.residentActive = false;
  card.sleep = false;
  card.damage = 0;
  card.summoningSick = zone === "front";
  if (placeByMode(state, playerId, card, { zone, from: "back", source: continuation.sourceName }) !== "placed") { openNextQueuedSelection(state); return true; }
  emitEffectPlacement(state, playerId, card, zone, continuation.sourceName);
  addLog(state, `${continuation.sourceName}: Script状態からObとして${zone === "front" ? "フロント" : "バック"}へ配置。`, "effect");
  openNextQueuedSelection(state);
  return true;
}

export function std184PlayCardCore({ card, force, state, playerId, player, placementMode, free, ignoreColor, index, registryExecution, placementSource, requestedSlot, asScript }) {
  if (asScript) {
    const setupCost = Number(card.setupCost ?? 3);
    if (!force && state.active !== playerId) return fail(state, "Scriptの設置は自分ターン中だけ。", force);
    if (!placementResult(player, "back", { mode: placementMode }).ok && placementMode !== "forced-effect") return fail(state, "バック上限。", force);
    if (!free && player.memory < setupCost) return fail(state, "設置メモリ不足。", force);
    if (state.mode !== "lab" && !ignoreColor && card.color && !enabledSymbols(player).includes(card.color)) return fail(state, `${card.color}シンボルがない。先にインストールして。`, force);
    if (!placementResult(player, "back", { mode: placementMode }).ok && placementMode === "forced-effect") {
      player.hand.splice(index, 1); failForcedPlacement(state, card.owner ?? playerId, card, { from: registryExecution ? "registry" : "hand", zone: "back", source: placementSource ?? "効果による強制配置" }); return true;
    }
    player.hand.splice(index, 1);
    if (!free) player.memory -= setupCost;
    if (!placementResult(player, "back", { mode: placementMode }).ok && placementMode === "forced-effect") {
      failForcedPlacement(state, card.owner ?? playerId, card, { zone: "back", source: placementSource ?? "効果による強制配置" });
      return true;
    }
    card.category = "Script";
    card.std184Script = true;
    card.faceDown = true;
    card.residentActive = false;
    card.sleep = false;
    if (placeByMode(state, playerId, card, { zone: "back", mode: placementMode, from: "hand", source: placementSource ?? "Script設置", requestedSlot }) !== "placed") return true;
    addLog(state, `${player.user.name}が「${card.name}」を3-0のScriptとして設置。`, "action");
    emitCardPlacement(state, playerId, card, "back", "set");
    return true;
  }
  return PASS;
}
