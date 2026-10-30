// STD-211 スクラップ・パッチワーク
export const definition = {
  "id": "STD-211",
  "name": "スクラップ・パッチワーク",
  "category": "Sp",
  "color": "紫",
  "cost": 4,
  "classes": [],
  "text": "自分エリアに存在するクラスをひとつ指定する。そのクラスのカード全て破壊する。その後、破壊したカードの枚数分カードを引く。",
  "sourceId": "STD-211",
  "printedCategory": "Sp",
  "atk": null,
  "str": null,
  "cardClass": null
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "select_own_area_class_destroy_then_draw", selection: { source: "own_area", selector: "class", count: 1 }, destroy: { target: "selected_own_area_class", all: true, recordAs: "destroyed_count" }, followUp: { type: "draw", valueFrom: "destroyed_count", zeroShortCircuit: true } };
