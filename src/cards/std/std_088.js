// STD-088 武装応援団新入部員 ヨシダ
export const definition = {
  "id": "STD-088",
  "name": "武装応援団新入部員 ヨシダ",
  "category": "Ob",
  "color": "赤",
  "cost": 1,
  "atk": 2,
  "str": 2,
  "text": "[QA]このカードは実行できない。",
  "classes": [
    "レッドパンクス"
  ]
};

// placementPermissionSpec (was continuous-effect-specs.js)
export const placementPermissionSpec = [{ type: "forbid_execution" }];

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "execution_restriction", executionAllowed: false, keyword: "QA" };
