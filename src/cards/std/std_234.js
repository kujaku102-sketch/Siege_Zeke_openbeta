// STD-234 白い仮面
export const definition = {
  "id": "STD-234",
  "name": "白い仮面",
  "category": "Code",
  "printedCategory": "仮想Code",
  "color": "橙",
  "cost": 1,
  "atk": -2,
  "str": 2,
  "token": true,
  "text": "[セキュリティ]これにマウントしたカードがスリープする時、所有ユーザーは手札を1枚捨てる。",
  "classes": []
};

// mountEventSpec (was continuous-effect-specs.js)
export const mountEventSpec = [{
    event: "mounted_host_slept",
    actions: Object.freeze([
      Object.freeze({ type: "discard", target: "source_owner_hand", count: 1 })
    ])
  }];
