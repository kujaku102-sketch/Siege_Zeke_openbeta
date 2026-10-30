// STD-016 緊急バックアップキット
export const definition = {
  "id": "STD-016",
  "name": "緊急バックアップキット",
  "category": "Code",
  "color": null,
  "cost": 2,
  "text": "これにObがマウントした時①を適用しこれを破壊する。①マウントしたObは[バックアップ]を1得る。カードを1枚引く。",
  "classes": []
};

// mountEventSpec (was continuous-effect-specs.js)
export const mountEventSpec = [{
    event: "ob_mounted_on_source",
    actions: Object.freeze([
      Object.freeze({ type: "grant_backup", target: "mounted_host", amount: 1 }),
      Object.freeze({ type: "draw", target: "source_controller", amount: 1 }),
      Object.freeze({ type: "destroy", target: "source_layer" })
    ])
  }];
