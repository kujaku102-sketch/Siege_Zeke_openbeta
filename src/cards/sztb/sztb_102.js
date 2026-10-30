// SZTB-102 アームズバンド・ブートキャンプ
import { spec, multiSpec, armsBandBootCampActions } from "../kit.js";

export const definition = {
  "id": "SZTB-102",
  "sourceId": "SZTB102",
  "name": "アームズバンド・ブートキャンプ",
  "category": "Script",
  "printedCategory": "Sc",
  "color": null,
  "cost": 5,
  "text": "[レジデント]起動時または[アップデート:2]①ゴミ箱の名称:アームズバンドカード1枚をサルベージする。その後、自分のレイヤーを任意の枚数消費する。こうして消費したレイヤー2枚につき1回追加で①を起動する。",
  "classes": []
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = multiSpec(
    spec("script_activation", armsBandBootCampActions()),
    spec("update", armsBandBootCampActions(), { requiresResidentActive: true })
  );
