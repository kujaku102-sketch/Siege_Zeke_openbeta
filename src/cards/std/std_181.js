// STD-181 鉄甲カブト虫
export const definition = {
  "id": "STD-181",
  "name": "鉄甲カブト虫",
  "category": "Ob",
  "color": "緑",
  "cost": 3,
  "atk": 5,
  "str": 5,
  "text": "このObはScを起動したターンのみ攻撃できる。",
  "classes": [],
  "traits": [
    "インセクト"
  ]
};

// attackPermissionSpec (was continuous-effect-specs.js)
export const attackPermissionSpec = [{ type: "require_attack_condition", condition: "own_script_activated_this_turn" }];
