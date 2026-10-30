// STD-130 潔白の守り手 代理人のイサク
export const definition = {
  "id": "STD-130",
  "name": "潔白の守り手 代理人のイサク",
  "category": "Ob",
  "color": "黄",
  "cost": 4,
  "atk": 3,
  "str": 1,
  "classes": [
    "ナイツ・オブ・マキナ",
    "ノイド"
  ],
  "text": "[セキュリティ][デコイ]戦闘するとき、+0/+Xする。Xは自分エリアの「ナイツ・オブ・マキナ」Obの数である。"
};

// battle stat modifier (was card-runtime-specs.js)
export const battleStatModifierSpec = Object.freeze([Object.freeze({
    stat: "str",
    operation: "add",
    value: Object.freeze({
      expression: "own_area_filter_count",
      filter: Object.freeze({ category: "Ob", className: "ナイツ・オブ・マキナ" })
    }),
    duration: "battle"
  })]);
