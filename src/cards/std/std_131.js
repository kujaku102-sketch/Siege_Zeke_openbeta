// STD-131 「華守り」
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-131",
  "name": "「華守り」",
  "category": "Ob",
  "color": "黄",
  "cost": 3,
  "atk": 1,
  "str": 3,
  "classes": [
    "ニュートロン・セキュリティ",
    "ビルダー"
  ],
  "text": "[セキュリティ][ログアウト]「華守り」1体を手札からドラッグする。"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("logout", [op("select", {
    selector: { owner: "self", zones: ["hand"], normalizedName: "華守り" }, count: 1,
    continueWhenEmpty: true, skipAfterActionsWhenEmpty: true,
    afterActions: [op("move", { target: "selected_cards", source: "hand", destination: "drag", free: true, forced: true })]
  })]);

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "logout_drag_from_hand", filter: { cardName: "華守り" }, count: 1, free: true, keyword: "Security" };
