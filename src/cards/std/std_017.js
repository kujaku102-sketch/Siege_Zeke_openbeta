// STD-017 応急手当装置
export const definition = {
  "id": "STD-017",
  "name": "応急手当装置",
  "category": "Code",
  "color": null,
  "cost": 3,
  "text": "これにObがマウントした時①を適用しこれを破壊する。①マウントしたObは[プロテクト]を得て、0/+3する。",
  "classes": []
};

// mountEventSpec (was continuous-effect-specs.js)
export const mountEventSpec = [{
    event: "ob_mounted_on_source",
    actions: Object.freeze([
      Object.freeze({ type: "grant_protect", target: "mounted_host", amount: 1 }),
      Object.freeze({ type: "modify_stats", target: "mounted_host", atk: 0, str: 3, duration: "game" }),
      Object.freeze({ type: "destroy", target: "source_layer" })
    ])
  }];
