// STD-004 増設メモリ
export const definition = {
  "id": "STD-004",
  "name": "増設メモリ",
  "category": "P-in",
  "color": null,
  "cost": null,
  "classes": [],
  "text": "自分のメモリ上限を+1する。"
};

// playerValueModifierSpec (was continuous-effect-specs.js)
export const playerValueModifierSpec = [{
    type: "modify_player_value",
    value: "max_memory",
    amount: 1,
    providerZone: "registry",
    faceUp: true,
    aggregation: "once"
  }];
