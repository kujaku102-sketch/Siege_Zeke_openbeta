// STD-115 戦闘支援機J型 吹雪
export const definition = {
  "id": "STD-115",
  "name": "戦闘支援機J型 吹雪",
  "category": "Ob",
  "color": "青",
  "cost": 4,
  "atk": 1,
  "str": 5,
  "classes": [],
  "text": "[デコイ]自分のエレクトロンフェアリー全ては[暗号化]を得る。",
  "sourceId": "STD-115",
  "printedCategory": "Ob",
  "cardClass": null
};

// auraKeywordSpec (was continuous-effect-specs.js)
export const auraKeywordSpec = [{
    type: "grant_keyword",
    providerZone: "area",
    target: "own_class_ob_all",
    className: "エレクトロンフェアリー",
    keyword: "ENCRYPTION"
  }];

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "resident_grant_keyword_group", target: "own_class", className: "エレクトロンフェアリー", keyword: "Encryption" };
