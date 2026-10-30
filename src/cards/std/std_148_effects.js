// STD-148 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { addLog, findCard, otherPlayer } from "../../game/core/shared.js";

// handlers (was effects/custom/std_148.js)
export function std148ResolveDeclaredScript({ state, declared, source }) {
  const live = findCard(state, declared.sourceUid);
  const opponentTurnStart = declared.activationCause === "event"
    && declared.eventContext?.type === "turn_started"
    && declared.eventContext?.eventPlayerId === otherPlayer(declared.playerId);
  if (opponentTurnStart && live?.playerId === declared.playerId && live.zoneName === "back") {
    live.card.std148ArmedTurn = state.turnNumber;
    addLog(state, `${source.name}: この相手ターン中の戦闘時ダメージを有効化。`, "effect");
  }
}
