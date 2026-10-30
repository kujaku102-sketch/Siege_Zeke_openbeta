// SZTB-098 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)
import { addLog, isArmsBandOb } from "../../game/core/shared.js";
import { PASS } from "../../game/effects/custom/index.js";

// handlers (was effects/custom/sztb_098.js)
export function sztb098ResolveSpell({ player, state, card }) {
  const targets = [...player.front, ...player.back].filter(isArmsBandOb);
  for (const target of targets) {
    target.permanentAtk = Number(target.permanentAtk ?? 0) + 1;
    target.damage = 0;
    target.sleep = false;
  }
  addLog(state, `${card.name}: 名称:アームズバンドOb${targets.length}体を+1/+0し、ダメージを取り除いてスタンバイ。`, "effect");
  return PASS;
}
