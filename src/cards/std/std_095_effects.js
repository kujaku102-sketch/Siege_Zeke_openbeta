// STD-095 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { dealFortressDamage } from "../../game/core/battle.js";
import { addLog } from "../../game/core/shared.js";

// handlers (was effects/custom/std_095.js)
export function std095AttackCore6({ state, opponentId, defenderOriginalStr, playerId, attacker, defender, defenderDestroyedByBattle }) {
  if (defenderDestroyedByBattle) {
    dealFortressDamage(state, opponentId, defenderOriginalStr, playerId, attacker.name);
    addLog(state, `${attacker.name}: 戦闘で破壊した${defender.name}の元のSTR${defenderOriginalStr}ダメージ。`, "effect");
  }
}
