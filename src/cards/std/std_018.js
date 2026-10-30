// STD-018 Neutron Beam
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-018",
  "name": "Neutron Beam",
  "category": "Script",
  "color": null,
  "cost": 2,
  "text": "[if:相手がObを配置した時]そのObを破壊する。その後、相手は3回復する。",
  "classes": []
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("script_activation", [
    op("destroy", { target: "activation_target" }),
    op("recover_damage", { target: "enemy_user", amount: 3 })
  ]);
