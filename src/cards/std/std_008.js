// STD-008 ジャミングウェイブ
export const definition = {
  "id": "STD-008",
  "name": "ジャミングウェイブ",
  "category": "Code",
  "color": null,
  "cost": 4,
  "classes": [],
  "text": "相手の実行メモリを+1する。"
};

// executionCostModifierSpec (was continuous-effect-specs.js)
export const executionCostModifierSpec = [{
    type: "modify_execution_cost",
    amount: 1,
    providerOwner: "enemy",
    providerZone: "area",
    faceUp: true,
    aggregation: "once"
  }];
