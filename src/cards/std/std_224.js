// STD-224 亜空間タックル
export const definition = {
  "id": "STD-224",
  "name": "亜空間タックル",
  "category": "P-in",
  "color": "橙",
  "cost": 2,
  "classes": [],
  "text": "これのインストール時、任意の数字を指定する。相手が実行し配置したカードに記載されたメモリが指定した数字だった場合、これとそのカードの両方を破壊する。"
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "install_number_watch", value: "chosen_number", trigger: "enemy_card_executed_and_placed", compare: "printed_memory", effect: "destroy_source_and_event_card" };
