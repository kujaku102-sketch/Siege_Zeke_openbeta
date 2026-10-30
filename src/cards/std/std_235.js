// STD-235 黒の仮面
export const definition = {
  "id": "STD-235",
  "name": "黒の仮面",
  "category": "Code",
  "printedCategory": "仮想Code",
  "color": "橙",
  "cost": 2,
  "atk": 2,
  "str": -2,
  "token": true,
  "text": "[コンタクト]これにマウントしたカードがスリープする時、所有ユーザーは2ダメージ受ける。",
  "classes": []
};

// mountEventSpec (was continuous-effect-specs.js)
export const mountEventSpec = [{
    event: "mounted_host_slept",
    actions: Object.freeze([
      Object.freeze({ type: "deal_damage", target: "source_owner_user", amount: 2 })
    ])
  }];

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "mounted_sleep_owner_damage", value: 2, keyword: "Contact" };
