// STD-078 ジャンクパーツ
export const definition = {
  "id": "STD-078",
  "name": "ジャンクパーツ",
  "category": "Code",
  "color": "赤",
  "cost": 1,
  "classes": [
    "レッドパンクス"
  ],
  "text": "マウントしたObを+1/+1する。(このカードは山札に4枚以上入れられる。)"
};

// mountedStatModifierSpec (was continuous-effect-specs.js)
export const mountedStatModifierSpec = [{ type: "modify_stats", target: "mounted_host", atk: 1, str: 1 }];
