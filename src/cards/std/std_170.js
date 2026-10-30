// STD-170 冒涜的な狂信者
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-170",
  "name": "冒涜的な狂信者",
  "category": "Ob",
  "color": "黒",
  "cost": 2,
  "atk": 0,
  "str": 1,
  "text": "[アップデート:4]いずれかのカードをランダムに生成し配置する。●『旧支配者の呼び声』●『冒涜の聖母像』●『穢れたもの』",
  "classes": []
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("update", [op("generate", {
    cardIds: ["STD-165", "STD-171", "STD-172"], randomOne: true, destination: "execute",
    free: true, forced: true
  })]);
