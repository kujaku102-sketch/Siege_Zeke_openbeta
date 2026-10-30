// STD-238 合体怪人 千手のキャノーン
import { area, own, exact } from "../kit.js";

export const definition = {
  "id": "STD-238",
  "name": "合体怪人 千手のキャノーン",
  "category": "Ob",
  "color": "橙",
  "cost": 5,
  "atk": 1,
  "str": 5,
  "classes": [],
  "text": "[レイヤード:自分のOb1体+自分レジストリのカード1枚以上][切断][セキュリティ]攻撃時①を起動できる。①これのレイヤーを2枚消費し、スタンバイする。これを+2/0する。"
};

// layered requirement (was layered-specs.js)
export const layeredSpec = { groups: [exact(area, { isOb: true }), own(["registry"], {})] };

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "layered_attack", requirement: "one_own_area_ob_plus_one_own_registry", optionalCost: { zone: "layer", count: 2 }, effects: ["standby", "modify_self_permanent_2_0"] };
