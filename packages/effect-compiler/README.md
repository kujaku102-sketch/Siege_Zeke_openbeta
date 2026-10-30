# effect-compiler

Turns a card's effect text (Japanese rule text) into a list of operations. A standalone SDK: nothing in this folder imports anything outside it, and it knows no card ids.

Name, license and how it is published are not decided yet (`package.json` holds placeholders, `private: true`).

## Use

```js
import { compileEffectText } from "effect-compiler";

const compiled = compileEffectText("[ログイン]カードを1枚引く。", { category: "Ob" });
compiled.operations; // [{ type: "draw", ... }]
```

Entry: `index.js`. Exports:

| Export | Meaning |
|---|---|
| `compileEffectText(sourceText, context)` | text → result object (below). `context.category` is the card category (`Ob`, `Sp`, `Script`, `Code`, ...); `context.id` is only used to find a registered preset. |
| `normalizeCardCategory(category)` | maps category spellings (`Sc`, ...) to the names the compiler uses |
| `compileSelectionModules(text)` and the three `parse…Module` functions | the selection modules a text describes (look-and-select, dynamic threshold, allocate-and-follow-up) |
| `registerCardOperationPresets(presets)` | host data, see below |

## What the host registers (card-specific data stays outside)

The compiler holds only general rules: keywords, zone words, sentence shapes. Anything that belongs to one card is handed in by the host:

- `registerCardOperationPresets({ [cardId]: operation })`: an extra operation that `compileEffectText` appends when `context.id` is that card (each call appends a fresh copy). It also changes how the `partial`/`manual` warnings are filtered for that card.

Registration is global to the module instance. A host that never registers gets the pure text rules.

## Output contract

`compileEffectText` returns a plain object. Top-level keys, in this order:

`version` (currently `2`), `sourceText`, `normalizedText`, `status` (`supported` | `partial` | `manual`), `keywords`, `clauses`, `costs`, `operations`, `selectionModules`, `selectionSpecs`, `warnings`, `reminderTextDetected`, `activationPolicy`, `resolutionPolicy`, `parentActionPolicy`.

- `keywords`: `{ name, value, ... }`; names the compiler knows: ACCESS_RESTRICTION, BACKUP, CONTACT, DECOY, DISCONNECT, ENCRYPTION, FIREWALL, HACKING, IF, LAYERED, LOGIN, LOGOUT, MAGAZINE, OC, OVERRIDE, PROTECT, PROXY, QA, RESIDENT, RESPONSE, SECURITY, UPDATE (and the other names in `KEYWORD_PATTERNS`).
- `clauses`: one entry per sentence: `index`, `text`, `triggers`, `operations`, `resultReference`, `optional`, `replacement`, `resolutionGroup`, `resolutionMode` (`sequential` | `simultaneous`).
- `operations`: the flattened list of every clause's operations (plus the registered preset of the card, if any). Each is `{ type, ...fields }`.
- `warnings`: `{ code, ... }` with codes `unparsed_effect_clause`, `variable`, `replacement`, `choice_branch`, `same_column`, `until_revealed`.

### Operation types

Every `type` literal the compiler source can emit (this is the contract; the shape of each operation's fields is not changed by this SDK):

access, add_counter, apply_numbered_effect, attach_corresponding_layer, choose_numbered_effect, consume_memory, deal_damage, decode, destroy, discard, discard_layer, drag, draw, execute, generate, grant_keyword, last_known_property, layer_count_threshold, layered_execution, mill, modify_damage, modify_execution_cost, modify_memory_limit, modify_stats, mount_restriction, move, move_all, move_layer, operation_succeeded, pay_layer_then, place_named_virtual, placement_restriction, previous_resolution_group_succeeded, recorded_actual_arrivals, recorded_operation_count, recover_damage, recover_memory, repeat_numbered_effect, replace_damage, replace_execution_cost, replace_move_cost, select, select_and_place, select_player, shuffle, standby, state_condition, swap.

Of these, `last_known_property`, `layer_count_threshold`, `operation_succeeded`, `previous_resolution_group_succeeded`, `recorded_actual_arrivals`, `recorded_operation_count` and `state_condition` are condition/reference nodes that appear inside the fields of other operations. The rest are emitted into `operations` (38 of them occur for the current 227-card library when compiled without a card id).

Operations that come from registered presets use whatever `type` the host gives them; they are not part of this list.

## Not covered here

- The game engine maps these operation types onto its own vocabulary (`effect-operation-library.js`); differences between the two are handled on the engine side.
- There are no tests in this folder yet. The game's `tests/card-runtime-specs.test.js` and the compile-equality check done at the split (every card's compile result, deep-equal and in the same key order, before and after) are what pin the behaviour today.
