// STD-011 キャッシュ・クリアー
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-011",
  "name": "キャッシュ・クリアー",
  "category": "Sp",
  "cost": 0,
  "text": "ユーザーまたはカード1枚を選び、それの持つコンポーネントをすべて取り除く。",
  "classes": []
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [op("remove_components", { target: "selected_user_or_card" })]);
