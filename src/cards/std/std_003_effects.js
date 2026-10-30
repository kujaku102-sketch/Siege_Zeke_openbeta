// STD-003 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { addLog, otherPlayer } from "../../game/core/shared.js";

// handlers (was effects/custom/std_003.js)
export function std003ResolveDeclaredScript({ state, declared, source }) {
  state.players[otherPlayer(declared.playerId)].trashBanUntilTurn = state.turnNumber;
  addLog(state, `${source.name}: このターン、以降の相手カードのゴミ箱移動をBANへ置換。`, "effect");
}
