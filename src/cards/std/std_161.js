// STD-161 狂気カウンター
export const definition = {
  "id": "STD-161",
  "name": "狂気カウンター",
  "category": "説明",
  "color": "黒",
  "text": "狂気カウンターを置かれたObまたはユーザーは置かれた時とそのユーザーのターン開始時にカウンター1つにつき1d6を行い、その出目がXを超えた場合BANされる。Xは「その対象の元々のSTR+15」である。",
  "classes": []
};

// compiler preset: extra operation the effect compiler appends for this card (was effect-compiler.js runtimeSpecials)
export const compilerPreset = { type: "madness_counter_rule", timings: ["counter_added", "target_controller_turn_start"], roll: "sum_one_d6_per_counter", banIf: "roll_gt_original_str_plus_15" };
