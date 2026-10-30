import { addLog, isArmsBandOb } from "../../core/shared.js";
import { PASS } from "./index.js";

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
