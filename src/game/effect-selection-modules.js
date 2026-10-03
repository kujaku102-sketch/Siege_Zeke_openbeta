const COLOR_WORDS = ["赤", "黄", "紫", "青", "緑", "橙", "黒", "白"];
const ZONE_MAP = Object.freeze({ 山札: "deck", 手札: "hand", ゴミ箱: "trash", レジストリ: "registry", エリア: "area" });

export const SHARED_SELECTION_MODULE_CARD_IDS = Object.freeze(["STD-187", "STD-219"]);

function parseFilter(fragment) {
  const memory = fragment.match(/(?:元々の)?メモリ(\d+)以下/)?.[1];
  const color = COLOR_WORDS.find((value) => fragment.includes(value));
  const category = fragment.match(/(?:^|・|の)(Lyd-Ob|VOb|Ob|Sp|Code)(?:$|を|または|か|\d)/)?.[1] ?? null;
  const excludeCategory = /Lyd(?:-Ob)?(?:ではない|でない|以外)/.test(fragment)
    ? "Lyd-Ob"
    : /Ob(?:ではない|でない|以外)/.test(fragment) ? "Ob" : null;
  const className = fragment.match(/クラス[:：]([^・\s]+?)(?=(?:の|カード|Ob|Sp|Code|$))/)?.[1] ?? null;
  return {
    ...(memory === undefined ? {} : { originalMemoryMaximum: Number(memory) }),
    ...(color ? { color } : {}),
    ...(category ? { category } : {}),
    ...(excludeCategory ? { excludeCategory } : {}),
    ...(className ? { className } : {})
  };
}

export function parseLookSelectRemainderModule(text) {
  const look = text.match(/山札の上から(\d+)枚を見る/);
  const select = text.match(/その中から([^。]+?)(?:(\d+)枚)?を選び/);
  const remainder = text.match(/残りを山札の(上|下)に戻す/);
  if (!look || !select || !remainder) return null;
  const explicitCount = Number(select[2] ?? 1);
  const chosenDestination = /それを手札に加える/.test(text) ? "hand" : /それをゴミ箱に送る/.test(text) ? "trash" : "unspecified";
  return Object.freeze({
    module: "look_select_remainder",
    source: "deck_top",
    lookCount: Number(look[1]),
    selection: {
      kind: "selection", source: "looked_cards", minimum: explicitCount, maximum: explicitCount,
      asMuchAsPossible: true, filter: parseFilter(select[1]), destination: chosenDestination
    },
    remainder: { destination: "deck", position: remainder[1] === "上" ? "top" : "bottom", preserveOrder: "controller_choice" },
    sequence: ["look", "select", "move_selected", "move_remainder"]
  });
}

function dynamicValueSource(text) {
  if (/Xは自分のレジストリの枚数/.test(text) || /Xはレジストリの枚数/.test(text)) return "self_registry_count";
  if (/Xは相手と自分のライフの差分/.test(text)) return "user_life_difference";
  if (/Xは対象カードの(?:元々の)?メモリ/.test(text)) return "previous_selected_card_original_memory";
  return null;
}

export function parseDynamicThresholdSelectionModule(text) {
  const match = text.match(/(手札|ゴミ箱|レジストリ|エリア)から(?:メモリ)?X以下の([^。]+?)(\d+)?(?:枚|体)?を選び/);
  const valueFrom = dynamicValueSource(text);
  if (!match || !valueFrom) return null;
  const count = Number(match[3] ?? 1);
  return Object.freeze({
    module: "dynamic_threshold_selection",
    selection: {
      kind: "selection", owner: /相手の/.test(match[0]) ? "opponent" : "self", source: ZONE_MAP[match[1]],
      minimum: count, maximum: count, filter: { ...parseFilter(match[2]), originalMemoryMaximumFrom: valueFrom }
    },
    followUp: /メモリを支払わず実行/.test(text) ? { type: "execute", executionCost: 0, preserveNormalLegality: true } : null
  });
}

function allocationValueSource(text) {
  if (/Xはこれのレイヤーが持つ(?:元々の)?メモリの合計/.test(text)) return "source_layer_original_memory_total";
  if (/Xはこれの(?:元々の)?(?:ATK|攻撃力)/.test(text)) return "source_original_atk";
  return null;
}

export function parseSelectAllocateFollowUpModule(text) {
  const match = text.match(/(自分|相手)(エリア|手札|ゴミ箱|レジストリ)の([^。]+?)を(?:好きな数|任意の(?:枚数|数))選び、Xを割り振って(ダメージ)/);
  const totalFrom = allocationValueSource(text);
  if (!match || !totalFrom) return null;
  const followUp = /レイヤーを(?:すべて|全て).*レジストリにインストール/.test(text)
    ? { type: "move_all", source: "source_layers", destination: "owner_registry", timing: "after_allocation_or_skip" }
    : null;
  return Object.freeze({
    module: "select_allocate_follow_up",
    selection: { kind: "selection", owner: match[1] === "相手" ? "opponent" : "self", source: ZONE_MAP[match[2]], ...parseFilter(match[3]), minimum: 0, maximum: "all_eligible" },
    allocation: { kind: "allocation", targetsFrom: "previous_selection", totalFrom, minimumPerTarget: 0, allowNoTargets: true, zeroBehavior: "skip_allocation" },
    followUp,
    sequence: ["select", "allocate_or_skip", ...(followUp ? ["follow_up"] : [])]
  });
}

export function compileSelectionModules(text) {
  return [parseLookSelectRemainderModule(text), parseDynamicThresholdSelectionModule(text), parseSelectAllocateFollowUpModule(text)].filter(Boolean);
}
