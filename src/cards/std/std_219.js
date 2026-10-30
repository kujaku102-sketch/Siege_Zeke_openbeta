// STD-219 転送怪人カサンドラ
export const definition = {
  "id": "STD-219",
  "name": "転送怪人カサンドラ",
  "category": "Ob",
  "color": "橙",
  "cost": 7,
  "atk": 5,
  "str": 3,
  "classes": [],
  "text": "[ログイン]カード1枚にアクセスし、それをレジストリにインストールする。①これの攻撃時、レジストリからX以下のカードを選びそれをメモリを支払わず実行できる。(Xは自分のレジストリの枚数である。)"
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "login_access_install_then_registry_free_execute", login: { type: "access_install", count: 1, destination: "registry" }, attack: { selection: { source: "own_registry", originalMemoryMaximumFrom: "self_registry_count", count: 1 }, executionCost: 0 } };

// uses the shared selection modules (was effect-selection-modules.js SHARED_SELECTION_MODULE_CARD_IDS)
export const sharedSelectionModuleCard = true;
