// STD-038 仮想領域追放
import { op, spec } from "../kit.js";

export const definition = {
  "id": "STD-038",
  "name": "仮想領域追放",
  "category": "Script",
  "cost": 2,
  "text": "[if:カードが生成された時]生成されたそれらをBANする。",
  "classes": []
};

// runtime spec (was card-runtime-specs.js)
export const runtimeSpec = spec("script_activation", [op("move_event_cards", { destination: "ban" })]);

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "generated_cards_ban", trigger: "card_generated", subject: "generated_cards" };
