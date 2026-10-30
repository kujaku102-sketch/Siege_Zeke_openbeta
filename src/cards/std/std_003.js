// STD-003 /ゴミ箱を空にする/*
export const definition = {
  "id": "STD-003",
  "name": "/ゴミ箱を空にする/*",
  "category": "Script",
  "cost": 3,
  "text": "[if:相手のカードがゴミ箱に送られる時]このターン、相手のカードがゴミ箱に送られるならそれをBANする。",
  "classes": []
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "turn_trash_destination_replacement", trigger: "enemy_card_would_move_to_trash", affected: "enemy_cards", destination: "ban", duration: "turn" };
