// STD-122 /技術の地平線/*
export const definition = {
  "id": "STD-122",
  "name": "/技術の地平線/*",
  "category": "Sp",
  "color": "青",
  "cost": 3,
  "classes": [],
  "text": "自分エリアのクラス:エレクトロンフェアリーを任意の数破壊して①を起動する。①「技術地平のゴースト」2体を配置する。これらのObを+X/+Xする。Xはゴミ箱にある破壊したObと同じ名称のカードの枚数x2である。",
  "sourceId": "STD-122",
  "printedCategory": "Sp",
  "atk": null,
  "str": null,
  "cardClass": null
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "destroy_any_count_then", target: "own_area_class", className: "エレクトロンフェアリー", zeroShortCircuit: true, followUp: { placeToken: "STD-123", count: 2, statVariable: { trashMatchingDestroyedNames: true, multiplier: 2 } } };
