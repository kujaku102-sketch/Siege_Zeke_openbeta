import { dealFortressDamage } from "../../game/core/deal-damage.js";
import { addLog } from "../../game/core/shared.js";

// handlers (was effects/custom/std_095.js)
export function std095AttackCore6({ state, opponentId, defenderOriginalStr, playerId, attacker, defender, defenderDestroyedByBattle }) {
  if (defenderDestroyedByBattle) {
    dealFortressDamage(state, opponentId, defenderOriginalStr, playerId, attacker.name);
    addLog(state, `${attacker.name}: 戦闘で破壊した${defender.name}の元のSTR${defenderOriginalStr}ダメージ。`, "effect");
  }
}
