// STD-202 骨抜き
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-202",
  "name": "骨抜き",
  "category": "Sp",
  "color": "紫",
  "cost": 2,
  "classes": [],
  "text": "相手フロントのOb1体をバックに移動する。その後、元々のエリアに『ドールズ』1体を生成し配置する。",
  "sourceId": "STD-202",
  "printedCategory": "Sp",
  "atk": null,
  "str": null,
  "cardClass": null
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("spell", [
    op("move", {
      target: "activation_target", owner: "enemy", source: "front", destination: "back",
      controllerRecord: "moved_controller", sourceZoneRecord: "original_zone"
    }),
    op("generate", {
      cardId: "STD-189", count: 1, destination: { expression: "recorded_value", key: "original_zone" },
      playerRecord: "moved_controller"
    })
  ]);
