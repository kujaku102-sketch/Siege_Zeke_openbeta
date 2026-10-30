// STD-209 コープス・パッチワーク
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-209",
  "name": "コープス・パッチワーク",
  "category": "Sp",
  "color": "紫",
  "cost": 5,
  "classes": [],
  "text": "相手エリアのカード1枚を破壊する。この効果で破壊したカードの種類によって①②いずれかを起動する。①Obなら『ドールズ・ギガンテス』と『ドールズ』を生成し手札に加える。②Ob以外なら『ドールズ』2枚を生成し手札に加える。",
  "sourceId": "STD-209",
  "printedCategory": "Sp",
  "atk": null,
  "str": null,
  "cardClass": null
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [
    op("destroy", {
      target: "activation_target", owner: "enemy", zones: ["area"],
      recordAs: "destroyed_count", recordCategoryAs: "destroyed_category"
    }),
    op("generate", {
      cardIds: ["STD-205", "STD-189"], destination: "hand",
      condition: { expression: "recorded_value_equals", key: "destroyed_category", value: "Ob" }
    }),
    op("generate", {
      cardIds: ["STD-189", "STD-189"], destination: "hand",
      condition: { expression: "recorded_value_not_equals", key: "destroyed_category", value: "Ob", requiresKey: true }
    })
  ]);

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "destroy_category_branch", target: "enemy_area_card", branches: { Ob: ["STD-205", "STD-189"], nonOb: ["STD-189", "STD-189"] }, destination: "hand" };
