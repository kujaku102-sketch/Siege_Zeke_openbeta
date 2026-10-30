// STD-137 騎士団の凱歌
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-137",
  "name": "騎士団の凱歌",
  "category": "Sp",
  "color": "黄",
  "cost": 4,
  "text": "①または②のうち1つを選び起動する。①次のターン終了時まで、自分のObすべてを+2/+2する。②メモリX以下の「ナイツ・オブ・マキナ」1体をデコードする。Xは相手と自分のライフの差分である。",
  "classes": []
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [op("choose_effect", {
    value: { expression: "absolute_user_str_difference" }, recordAs: "x",
    choices: [
      {
        label: "①自分Obすべてを+2/+2",
        actions: [op("modify_stats", { target: "own_ob_all", atk: 2, str: 2, duration: "through_next_turn" })]
      },
      {
        label: "②ナイツ・オブ・マキナをデコード",
        actions: [op("decode", {
          filter: {
            category: "Ob", className: "ナイツ・オブ・マキナ",
            originalMemoryMaximum: { expression: "recorded_count", key: "x" }
          },
          count: 1
        })]
      }
    ]
  })]);

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "variable_choice_spell", variable: { aggregate: "absolute_user_life_difference" }, choices: ["own_ob_all_2_2_through_next_turn", "decode_nom_ob_original_memory_lte_x"] };
