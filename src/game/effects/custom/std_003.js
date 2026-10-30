import { addLog, otherPlayer } from "../../core/shared.js";

export function std003ResolveDeclaredScript({ state, declared, source }) {
  state.players[otherPlayer(declared.playerId)].trashBanUntilTurn = state.turnNumber;
  addLog(state, `${source.name}: このターン、以降の相手カードのゴミ箱移動をBANへ置換。`, "effect");
}
