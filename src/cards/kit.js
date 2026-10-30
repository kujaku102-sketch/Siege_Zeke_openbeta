import { operation } from "../game/effect-operation-library.js";

// Helpers the per-card spec entries are written with (they used to sit at the top of the spec files).
export const op = (type, options = {}) => operation(type, options);

export const spec = (phase, actions, options = {}) => Object.freeze({ phase, actions: Object.freeze(actions), ...options });

export const multiSpec = (...specs) => Object.freeze({
  phases: Object.freeze(Object.fromEntries(specs.map((item) => [item.phase, item])))
});

export const armsBandBootCampActions = () => [op("select", {
  selector: { owner: "self", zones: ["trash"], family: "arms_band" },
  count: 1,
  label: "サルベージするアームズバンド・カードを選択",
  afterActions: [
    op("move", { target: "selected_cards", source: "trash", destination: "hand" }),
    op("select", {
      selector: { owner: "self", zones: ["layers"] },
      mode: "up_to", minimum: 0, maximum: "all",
      label: "消費する自分のレイヤーを任意選択",
      skipAfterActionsWhenEmpty: true,
      afterActions: [
        op("consume_layers", { target: "selected_cards", recordAs: "consumed_layers" }),
        op("repeat_select_move", {
          selector: { owner: "self", zones: ["trash"], family: "arms_band" },
          source: "trash", destination: "hand",
          count: { expression: "recorded_count_divided_floor", key: "consumed_layers", divisor: 2 },
          label: "追加でサルベージするアームズバンド・カードを選択"
        })
      ]
    })
  ]
})];

export const modifier = (options) => operation("modify_damage", {
  providerScope: "own_area",
  damageKind: "all",
  destination: "all",
  sourceFilter: "any",
  targetFilter: "any",
  operation: "add",
  ...options
});

export const area = ["front", "back"];

export const own = (zones, filter = {}, minimum = 1, maximum = Infinity) => ({ owner: "self", zones, filter, minimum, maximum });

export const exact = (zones, filter = {}, count = 1) => own(zones, filter, count, count);
