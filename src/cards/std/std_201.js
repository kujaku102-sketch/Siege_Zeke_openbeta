// STD-201 足跡
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-201",
  "name": "足跡",
  "category": "Code",
  "color": "紫",
  "cost": 7,
  "classes": [
    "アーティファクト"
  ],
  "text": "これにカードをマウントできない。[アップデート:4]これを破壊する。",
  "sourceId": "STD-201",
  "printedCategory": "Code",
  "atk": null,
  "str": null,
  "cardClass": "アーティファクト"
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("update", [op("destroy", { target: "source", suppressReplacement: true })]);

// placementPermissionSpec (was continuous-effect-specs.js)
export const placementPermissionSpec = [{ type: "forbid_mount_on_source" }];
