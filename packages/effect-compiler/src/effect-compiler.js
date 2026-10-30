import { compileSelectionModules } from "./selection-modules.js";

// Data the host registers. The compiler itself knows no card ids.
const CARD_OPERATION_PRESETS = new Map();
const INTRINSIC_KEYWORDS = new Map();

// { [cardId]: operation } - an extra operation compileEffectText appends for that card (a fresh copy per call).
export function registerCardOperationPresets(presets) {
  for (const [id, operation] of Object.entries(presets)) CARD_OPERATION_PRESETS.set(id, operation);
}

// { [cardId]: [keyword name, ...] } - keywords hasKeyword reports for that card although its text has no such keyword.
export function registerIntrinsicKeywords(table) {
  for (const [id, names] of Object.entries(table)) INTRINSIC_KEYWORDS.set(id, [...names]);
}

const KEYWORD_PATTERNS = [
  ["QA", /\[(?:QA|クイックアクション)\]/g],
  ["SECURITY", /\[セキュリティ\]/g],
  ["BACKUP", /\[バックアップ\]/g],
  ["CONTACT", /\[コンタクト\]/g],
  ["HACKING", /\[ハッキング\]/g],
  ["ENCRYPTION", /\[暗号化\]/g],
  ["DECOY", /\[デコイ\]/g],
  ["DISCONNECT", /\[切断\]/g],
  ["FIREWALL", /\[ファイアウォール\]/g],
  ["ACCESS_RESTRICTION", /\[アクセス制限\]/g],
  ["TRANSFORM_RELEASE", /\[変身解除\]/g],
  ["PROTECT", /\[(?:プロテクト|装甲)(?:[:：](\d+))?\]/g, "number"],
  ["PROXY", /\[プロキシ[:：](\d+)\]/g, "number"],
  ["LOGIN", /\[ログイン\]/g],
  ["LOGOUT", /\[ログアウト\]/g],
  ["LAYERED", /\[レイヤード[:：]([^\]]+)\]/g, "text"],
  ["RESIDENT", /\[レジデント\]/g],
  ["IF", /\[(?:if|条件)[:：]([^\]]+)\]/gi, "text"],
  ["RESPONSE", /\[レスポンス[:：]\s*(\d+)\]/g, "number"],
  ["UPDATE", /\[アップデート[:：]\s*(\d+)\]/g, "number"],
  ["OVERRIDE", /\[オーバーライド[:：]\s*(\d+)?X\]/gi, "number"],
  ["OC", /\[OC\+(\d+)\]/g, "number"],
  ["MAGAZINE", /\[弾倉[:：]\s*(\d+)\]/g, "number"]
];

const ZONE_WORDS = [
  ["registry", "レジストリ"], ["trash", "ゴミ箱"], ["deck", "山札"], ["hand", "手札"],
  ["front", "フロント"], ["back", "バック"], ["area", "エリア"], ["ban", "BAN"]
];

function normalizeEffectText(sourceText = "") {
  return String(sourceText)
    .replaceAll("**", "")
    .replaceAll("ｰ", "-")
    .replace(/\[ログイン(?=\s*カード)/g, "[ログイン]")
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\s*。\s*/g, "。")
    .trim();
}

export function normalizeCardCategory(category = "") {
  const value = String(category).trim();
  return /^(?:Sc|Script)$/i.test(value) ? "Script" : value;
}

function allMatches(text, pattern) {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)];
}

function parseKeywords(text) {
  const keywords = [];
  for (const [name, pattern, valueType] of KEYWORD_PATTERNS) {
    for (const match of allMatches(text, pattern)) {
      const raw = match[1] ?? null;
      const prefix = text.slice(0, match.index).replace(/\[[^\]]+\]/g, "").trim();
      // Activation headers can start a separate ability after another ability's text.
      const activationHeader = ["LOGIN", "LOGOUT", "UPDATE", "IF", "RESPONSE", "RESIDENT", "PROXY", "OC", "MAGAZINE"].includes(name)
        && /^(?:\s|[①②③④⑤⑥⑦⑧⑨⑩])*$/.test(text.slice(text.lastIndexOf("。", match.index - 1) + 1, match.index));
      keywords.push({ name, value: raw === null ? null : valueType === "number" ? Number(raw) : raw, intrinsic: prefix === "" || activationHeader, index: match.index });
    }
  }
  return keywords.sort((a, b) => a.index - b.index).map(({ index: _index, ...keyword }) => keyword);
}

function parseTrigger(clause, keywords) {
  const triggerKeywords = keywords.filter(({ name }) => ["LOGIN", "LOGOUT", "UPDATE", "IF", "RESPONSE", "RESIDENT"].includes(name));
  if (triggerKeywords.length) return triggerKeywords.map(({ name, value }) => ({ type: name.toLowerCase(), value }));
  const layerThreshold = clause.match(/このObのレイヤーが(\d+)枚以下になった時/);
  if (layerThreshold) {
    return [{
      type: "layer_count_threshold",
      comparator: "<=",
      value: Number(layerThreshold[1]),
      countMode: "stack_including_source",
      timing: "after_current_effect_resolution"
    }];
  }
  if (/(?:このカード|このOb)がマウントしていない時/.test(clause)) {
    return [{
      type: "state_condition",
      condition: { sourceMounted: false, mountType: "Code" },
      checkTiming: ["after_area_entry", "after_state_change"],
      mandatory: true
    }];
  }
  const patterns = [
    ["moved", /これが(?:エリアを)?移動した時|これが移動した場合/],
    ["turn_end", /ターン終了時/],
    ["turn_start", /ターン開始時/],
    ["attack", /攻撃時|攻撃する時|攻撃宣言時/],
    ["attacked", /攻撃される時/],
    ["card_executed", /カードを実行した時/],
    ["ob_mounted_on_source", /これにObがマウントした時/],
    ["destroyed", /破壊された時|破壊される時/]
    ,["mandatory_rule_draw", /(?:ルールによる)?最初の(?:1枚の)?ドローでこれを引いたなら/]
  ];
  return patterns.filter(([, pattern]) => pattern.test(clause)).map(([type]) => ({ type, value: null }));
}

function parseResultReference(clause) {
  if (/破壊した(?:カードの)?枚数|破壊した数だけ/.test(clause)) {
    return { type: "recorded_operation_count", operation: "destroy", countField: "attemptedCount", record: "destroy_attempts", gate: { minimum: 1, zeroBehavior: "skip_dependent_block" } };
  }
  if (/こうして破壊したOb一体につき/.test(clause)) {
    return { type: "recorded_operation_count", operation: "destroy", countField: "attemptedCount", record: "destroyed_ob_attempts", filter: { category: "Ob" }, gate: { minimum: 1, zeroBehavior: "skip_dependent_block" } };
  }
  if (/^そうしたら/.test(clause)) return { type: "previous_resolution_group_succeeded" };
  if (/破壊したなら/.test(clause)) return { type: "operation_succeeded", operation: "destroy", successField: "determined", includeReplacement: true };
  const didMatch = clause.match(/([^。]+?)したなら/);
  if (didMatch) return { type: "operation_succeeded", operationText: didMatch[1].trim() };
  if (/その後.*だった場合/.test(clause)) return { type: "last_known_property", dependsOnOperationSuccess: false, count: "attempted_targets" };
  if (/こうしてゴミ箱に送られた/.test(clause)) return { type: "recorded_actual_arrivals", record: "milled_to_trash", destination: "trash", excludeReplacedDestinations: true };
  if (/こうしてドラッグしたなら/.test(clause)) return { type: "operation_succeeded", operation: "drag", requireCompletedMove: true };
  if (/こうして破壊したなら/.test(clause)) return { type: "operation_succeeded", operation: "destroy", successField: "determined", includeReplacement: true };
  return null;
}

function inferSelector(fragment) {
  const owner = /お互い/.test(fragment) ? "both" : /相手/.test(fragment) ? "enemy" : "self";
  const zones = ZONE_WORDS.filter(([, word]) => fragment.includes(word)).map(([zone]) => zone);
  const categoryUnion = /Ob(?:または|か)Code|Code(?:または|か)Ob/.test(fragment) ? ["Ob", "Code"] : null;
  const category = categoryUnion ? null : /Ob/.test(fragment) ? "Ob" : /Sp/.test(fragment) ? "Sp" : /Code/.test(fragment) ? "Code" : null;
  const countMatch = fragment.match(/(\d+)(?:体|枚)/);
  const memoryMaximum = fragment.match(/(?:元々の)?メモリ(\d+)以下/)?.[1] ?? null;
  const quoted = fragment.match(/[「『]([^」』]+)[」』]/)?.[1] ?? null;
  const className = fragment.match(/クラス[:：]([^\s「『]+?)(?=(?:の|カード|Ob|Sp|Code|\d|$))/)?.[1] ?? null;
  const nameGroup = fragment.match(/名称[:：]([^\s「『]+?)(?=(?:の|カード|Ob|Sp|Code|\d|$))/)?.[1] ?? null;
  return {
    owner,
    zones: zones.length ? zones : ["area"],
    visibility: zones.includes("hand") || zones.includes("deck") ? "private_allowed" : "public",
    category,
    ...(categoryUnion ? { categories: categoryUnion } : {}),
    cardName: quoted,
    className,
    nameGroup,
    count: countMatch ? Number(countMatch[1]) : /すべて|全て/.test(fragment) ? "all" : 1,
    maximum: /まで/.test(fragment) ? Number(countMatch?.[1] ?? 1) : null,
    ...(memoryMaximum === null ? {} : { originalMemoryMaximum: Number(memoryMaximum) })
  };
}

function parseOperations(clause, context = {}) {
  const operations = [];
  const lifetime = context.category === "P-in" ? "source_bound" : /このターン/.test(clause) ? "turn" : "unspecified";
  const selectPattern = /((?:自分|相手|お互い)[^。①②]*?(?:Ob|Sp|Code|カード)[^。①②]*?(?:\d+(?:体|枚)|すべて|全て|任意の枚数)?)(?:を選び|を選ぶ|を指定)/g;
  const decoyReminder = /\[デコイ\].*相手が効果でカードを選ぶ時/.test(clause);
  if (/攻撃する時、レイヤーを1枚破棄することでこれをスタンバイする/.test(clause)) operations.push({ type: "pay_layer_then", count: 1, optional: true, trigger: "attack", followUp: { type: "standby", target: "source" } });
  if (/戦闘する時、レイヤー1枚を破棄して$/.test(clause)) operations.push({ type: "pay_layer_then", count: 1, optional: true, trigger: "battle", activatesEffectNumber: 1 });
  if (/①受けるダメージを1にする/.test(clause)) operations.push({ type: "replace_damage", target: "source", event: "current_battle_incoming", value: 1 });
  if (/このObのレイヤーにしたLyd-Ob1体につき$/.test(clause)) operations.push({ type: "repeat_numbered_effect", effectNumber: 1, countFrom: { source: "source_layers", category: "Lyd-Ob" } });
  if (/攻撃時、このObのレイヤー1枚をゴミ箱に送って$/.test(clause)) operations.push({ type: "pay_layer_then", count: 1, optional: true, trigger: "attack", destination: "trash", activatesEffectNumber: 1 });
  if (/レイヤーが1枚以下のこのObは破壊される/.test(clause)) operations.push({ type: "destroy", target: "source", condition: { layerCountMaximum: 1 }, timing: "mandatory_state_check" });
  if (/レイヤーに対応するカード1枚をゴミ箱から選び、1番下のレイヤーに加える/.test(clause)) operations.push({ type: "attach_corresponding_layer", source: "trash", target: "selected_lyd_ob", position: "bottom", count: 1 });
  if (/公開し続けている限り、そのObを配置するために消費するメモリは1になる/.test(clause)) operations.push({ type: "replace_execution_cost", target: "revealed_lyd_ob", value: 1, lifetime: "while_revealed" });
  for (const match of allMatches(clause, /[「『]ジャンクパーツ[」』](\d+)(?:枚|体)を配置する/g)) operations.push({ type: "generate", cardName: "ジャンクパーツ", count: Number(match[1]), destination: "choose_area" });
  if (!decoyReminder) for (const match of allMatches(clause, selectPattern)) operations.push({ type: "select", selector: inferSelector(match[1]), raw: match[0] });
  if (/プレイヤーを1人選ぶ/.test(clause)) operations.push({ type: "select_player", count: 1, eligibility: /ゴミ箱を(?:すべて|全て)デッキ/.test(clause) ? { zone: "trash", minimumCards: 1 } : null });

  for (const match of allMatches(clause, /(?:相手|敵)(?:の)?(?:フォートレス|ユーザー)に(\d+|X)ダメージ/g)) {
    operations.push({ type: "deal_damage", target: "enemy_user", value: match[1] === "X" ? "X" : Number(match[1]) });
  }
  for (const match of allMatches(clause, /相手に(\d+|X)ダメージ/g)) {
    operations.push({ type: "deal_damage", target: "enemy_user", value: match[1] === "X" ? "X" : Number(match[1]) });
  }
  const registryDamage = clause.match(/これがレジストリから実行されていた場合、?(\d+)ダメージ/);
  if (registryDamage) operations.push({ type: "deal_damage", target: "enemy_user", value: Number(registryDamage[1]), condition: { sourceExecutionZone: "registry" }, replacesPreviousValue: true });
  for (const match of allMatches(clause, /それがスリープしているならさらに(\d+|X)ダメージ/g)) {
    operations.push({
      type: "deal_damage", target: "previous_selected_target", value: match[1] === "X" ? "X" : Number(match[1]),
      condition: { targetState: "sleep" }, reference: "previous_target"
    });
  }
  for (const match of allMatches(clause, /相手(?:の)?Ob1体と相手ユーザーに(\d+|X)ダメージ/g)) {
    operations.push({ type: "deal_damage", target: "enemy_ob_one", value: match[1] === "X" ? "X" : Number(match[1]), simultaneousGroup: "shared_value_targets" });
  }
  for (const match of allMatches(clause, /自分(?:ユーザー)?は(\d+|X)ダメージ受ける/g)) {
    const operation = { type: "deal_damage", target: "self_user", value: match[1] === "X" ? "X" : Number(match[1]) };
    if (/使用可能メモリが0なら/.test(clause)) operation.condition = { usableMemory: 0 };
    operations.push(operation);
  }
  for (const match of allMatches(clause, /使用可能メモリが0なら(\d+|X)ダメージ受ける/g)) {
    operations.push({
      type: "deal_damage", target: "self_user", value: match[1] === "X" ? "X" : Number(match[1]),
      condition: { usableMemory: 0 }
    });
  }
  for (const match of allMatches(clause, /((?:相手|自分)[^。]*?Ob(?:1体|すべて|全て)?)に(\d+|X)ダメージ/g)) {
    operations.push({ type: "deal_damage", target: inferSelector(match[1]), value: match[2] === "X" ? "X" : Number(match[2]) });
  }
  for (const match of allMatches(clause, /カードを(\d+|X)枚引く/g)) operations.push({ type: "draw", target: "self", value: match[1] === "X" ? "X" : Number(match[1]) });
  for (const match of allMatches(clause, /([①②③④])を(?:適用|起動)/g)) {
    operations.push({ type: "apply_numbered_effect", effectNumber: "①②③④".indexOf(match[1]) + 1 });
  }
  for (const match of allMatches(clause, /(?:マウントしたOb|これにマウントした(?:Ob|カード))は?\[([^\]]+)\]を(?:(\d+))?得(?:て|る)/g)) {
    const keyword = match[1].replace(/[:：]\d+$/, "");
    const printedAmount = match[1].match(/[:：](\d+)$/)?.[1];
    const amount = Number(match[2] ?? printedAmount ?? (["プロテクト", "バックアップ"].includes(keyword) ? 1 : 0));
    operations.push({ type: "grant_keyword", target: "mounted_ob", keyword, amount, lifetime: "persistent_component" });
  }
  for (const match of allMatches(clause, /(?:マウントしたOb|これにマウントした(?:Ob|カード)).*?((?:\[[^\]]+\](?:と)?)+)を与える/g)) {
    for (const keywordMatch of allMatches(match[1], /\[([^\]]+)\]/g)) {
      const keyword = keywordMatch[1].replace(/[:：]\d+$/, "");
      const printedAmount = keywordMatch[1].match(/[:：](\d+)$/)?.[1];
      const amount = Number(printedAmount ?? (["プロテクト", "バックアップ"].includes(keyword) ? 1 : 0));
      operations.push({ type: "grant_keyword", target: "mounted_ob", keyword, amount, lifetime: "source_bound" });
    }
  }
  if (/手札を(?:すべて|全て)捨てる/.test(clause)) operations.push({ type: "discard", target: "all_hand", recordAs: "discarded_count", allowZero: true });
  if (/相手は自身の手札を1枚捨てる/.test(clause)) operations.push({ type: "discard", target: "opponent_hand", count: 1, asMuchAsPossible: true });
  if (/相手のOb1体を選び毒カウンターを2つ置く/.test(clause)) operations.push({ type: "add_counter", target: "selected_enemy_ob", counter: "poison", value: 2 });
  if (/①または②を1つ選び起動する/.test(clause)) operations.push({ type: "choose_numbered_effect", options: [1, 2], count: 1 });
  for (const match of allMatches(clause, /手札の[「『]([^」』]+)[」』](\d+)枚を捨てる/g)) {
    operations.push({ type: "discard", target: "selected", source: "hand", owner: "self", className: match[1], count: Number(match[2]), minimum: Number(match[2]), recordAs: "discarded_cards" });
  }
  if (/捨てた枚数と同じだけカードを引く/.test(clause)) operations.push({ type: "draw", target: "self", valueFrom: "discarded_count" });
  for (const match of allMatches(clause, /メモリを(\d+|X)回復/g)) operations.push({ type: "recover_memory", target: "self", value: match[1] === "X" ? "X" : Number(match[1]) });
  for (const match of allMatches(clause, /(?:(自分|相手)の)?メモリを(\d+|X)消費する/g)) {
    operations.push({ type: "consume_memory", target: match[1] === "相手" ? "opponent" : "self", value: match[2] === "X" ? "X" : Number(match[2]), minimum: 0, asMuchAsPossible: true });
  }
  if (/自分が与えるダメージすべてを\+1/.test(clause)) operations.push({ type: "modify_damage", controller: "self", direction: "dealt", value: 1, appliesTo: "all_damage_events", lifetime: "source_bound", stacking: "additive" });
  if (/自分の効果テキストを持たないObの与えるダメージを\+1する/.test(clause)) operations.push({
    type: "modify_damage", controller: "self", sourceFilter: { category: "Ob", effectText: "none" },
    direction: "dealt", value: 1, appliesTo: "all_damage_events", lifetime: "source_bound", stacking: "additive"
  });
  if (/自分の赤のカードによるダメージを\+1する/.test(clause)) operations.push({ type: "modify_damage", controller: "self", sourceFilter: { color: "赤" }, direction: "dealt", value: 1, appliesTo: "all_damage_events", lifetime: "source_bound", stacking: "additive" });
  if (/自分が受けるダメージすべてを-1/.test(clause) || /受けるダメージを-1/.test(clause)) operations.push({ type: "modify_damage", controller: "self", direction: "received", value: -1, appliesTo: "all_damage_events", minimum: 0, lifetime: "source_bound", stacking: "additive" });
  if (/バックにのみ配置できる/.test(clause)) operations.push({ type: "placement_restriction", target: "source", timing: "execution", destination: "back" });
  if (/これにカードをマウントできない/.test(clause)) operations.push({ type: "mount_restriction", target: "source", allowed: false, lifetime: "source_bound" });
  if (/これが移動した時スタンバイする/.test(clause)) operations.push({ type: "standby", target: "source" });
  if (/レイヤーを1枚破棄することでこれを移動する消費メモリを1にできる/.test(clause)) operations.push({
    type: "replace_move_cost", target: "source", value: 1, optional: true,
    additionalCost: { type: "discard_layer", count: 1 }
  });
  if (/クラス:アーティファクトまたはマスターピースのカードから受けるダメージは-1/.test(clause)) operations.push({
    type: "modify_damage", controller: "self", direction: "received", value: -1,
    sourceFilter: { classesAny: ["アーティファクト", "マスターピース"] }, minimum: 0,
    lifetime: "source_bound", stacking: "additive"
  });
  const decodeMatch = clause.match(/合計メモリが(\d+)以下になるようObを(\d+)体までデコードする/);
  if (decodeMatch) operations.push({ type: "decode", owner: "self", source: "trash", destination: "choose_area", category: "Ob", maximum: Number(decodeMatch[2]), totalOriginalMemoryMaximum: Number(decodeMatch[1]), minimum: 0, optional: true });
  const exactPlacementMatch = clause.match(/メモリ合計が(\d+)になるように、ゴミ箱から(ObまたはCode)を任意の枚数選び配置する/);
  if (exactPlacementMatch) operations.push({
    type: "select_and_place", owner: "self", source: "trash", destination: "choose_area",
    categories: ["Ob", "Code"], minimum: 1, maximum: "all", aggregateConstraint: {
      field: "original_memory", comparator: "=", value: Number(exactPlacementMatch[1])
    }, requireFeasibleAtDeclaration: true, onInfeasible: "cannot_activate"
  });
  const millMatch = clause.match(/山札の上から(\d+)枚をゴミ箱に送る/);
  if (millMatch) operations.push({ type: "mill", owner: "self", source: "deck_top", destination: "trash", value: Number(millMatch[1]), asMuchAsPossible: true, recordActualArrivalsAs: "milled_to_trash" });
  if (/これを(?:自分エリアに)?ドラッグ(?:する|し)/.test(clause)) operations.push({ type: "drag", target: "source", destination: "self_choose_area", requireOpenSlot: true });
  if (/これを山札の上に置く/.test(clause)) operations.push({ type: "move", target: "source", destination: "deck", position: "top", replacesDefaultProxyTrash: true });
  if (/これをデコードする/.test(clause)) operations.push({ type: "decode", owner: "self", source: "trash", destination: "choose_area", target: "source", maximum: 1, minimum: 1, optional: false });
  for (const match of allMatches(clause, /[「『]([^」』]+)[」』](\d+)?体?を配置(?:する|し)/g)) {
    operations.push({ type: "place_named_virtual", cardName: match[1], count: Number(match[2] ?? 1), source: "virtual_pool", destination: "choose_area" });
  }
  for (const match of allMatches(clause, /(?:(自分|相手)(?:ユーザー|ライフ)?(?:は|を|のダメージを)?)(\d+|X)回復(?:する)?/g)) {
    operations.push({ type: "recover_damage", target: match[1] === "相手" ? "opponent_user" : "self_user", value: match[2] === "X" ? "X" : Number(match[2]), minimumDamage: 0 });
  }
  for (const match of allMatches(clause, /メモリ上限を([+-]\d+)する/g)) {
    operations.push({ type: "modify_memory_limit", target: /相手の/.test(clause) ? "opponent" : "self", value: Number(match[1]), lifetime });
  }
  for (const match of allMatches(clause, /(?:実行|消費)メモリ(?:は|を)([+-]\d+)(?:される|する)?/g)) {
    operations.push({
      type: "modify_execution_cost",
      target: /相手の/.test(clause) ? "opponent_cards" : /その|これの/.test(clause) ? "referenced_card" : "self_cards",
      value: Number(match[1]),
      minimum: 0,
      lifetime,
      stacking: /ゴミ箱に同じ名称/.test(clause) ? "fixed" : "additive"
    });
  }
  if (/(?:このカード|このOb)がマウントしていない時、?破壊される/.test(clause)) {
    operations.push({ type: "destroy", target: "source", mandatory: true, reason: "unmounted_state" });
  } else if (/このObのレイヤーが\d+枚以下になった時、?破壊される/.test(clause)) {
    operations.push({ type: "destroy", target: "source", mandatory: true, reason: "layer_count_threshold" });
  } else if (/破壊する/.test(clause)) {
    operations.push({
      type: "destroy",
      target: /これを破壊する/.test(clause) ? "source" : /そのObを破壊する/.test(clause) ? "trigger_event_ob" : /そのカードを破壊する/.test(clause) ? "trigger_event_card" : /すべて|全て/.test(clause) ? "selected_all" : "selected",
      ...(/任意の数|好きな数/.test(clause) ? { minimum: 0, optionalSelection: true, recordOperationCountAs: /Ob/.test(clause) ? "destroyed_ob_attempts" : "destroy_attempts" } : {}),
      ...(/破壊したカードの枚数|破壊した枚数|破壊した数だけ/.test(clause) ? { recordOperationCountAs: "destroy_attempts" } : {})
    });
  }
  if ((/手札に戻す|手札に加える/.test(clause)) && !/アクセス/.test(clause)) operations.push({ type: "move", destination: "hand", target: "selected" });
  if (/ゴミ箱を(?:すべて|全て)デッキに(?:もどす|戻す)/.test(clause)) operations.push({ type: "move_all", source: "trash", destination: "deck", target: "selected_player", position: "unspecified" });
  if (/バックに(?:下げる|移動する)/.test(clause)) operations.push({ type: "move", destination: "back", target: "selected" });
  if (/フロント(?:またはバック)?に移動/.test(clause) || /エリアのいずれかに移動/.test(clause)) operations.push({ type: "move", destination: "choose_area", target: "selected_or_self" });
  if (/位置を入れ替える/.test(clause)) operations.push({ type: "swap", target: "selected_pair" });
  for (const match of allMatches(clause, /[「『]([^」』]+)[」』](\d+)(?:体|枚)を生成/g)) {
    operations.push({ type: "generate", cardName: match[1], count: Number(match[2]), destination: /手札/.test(clause) ? "hand" : /レイヤー/.test(clause) ? "layer" : "area" });
  }
  for (const match of allMatches(clause, /[「『]([^」』]+)[」』](\d+)(?:体|枚)を(?:手札に)?生成/g)) {
    if (!operations.some((operation) => operation.type === "generate" && operation.cardName === match[1])) {
      operations.push({ type: "generate", cardName: match[1], count: Number(match[2]), destination: /手札/.test(clause) ? "hand" : "area" });
    }
  }
  const pairedGenerate = clause.match(/[「『]([^」』]+)[」』]と[「『]([^」』]+)[」』]それぞれ(\d+)枚を生成/);
  if (pairedGenerate) for (const cardName of [pairedGenerate[1], pairedGenerate[2]]) operations.push({ type: "generate", cardName, count: Number(pairedGenerate[3]), destination: /手札/.test(clause) ? "hand" : "area" });
  const variableGenerate = clause.match(/[「『]([^」』]+)[」』]を生成/);
  if (variableGenerate && !operations.some((operation) => operation.type === "generate" && operation.cardName === variableGenerate[1])) {
    operations.push({ type: "generate", cardName: variableGenerate[1], count: /枚数分/.test(clause) ? "X" : 1, destination: /手札/.test(clause) ? "hand" : "area" });
  }
  if (/アクセス(?!制限)/.test(clause)) {
    const selector = inferSelector(clause);
    const accessOperation = {
    type: "access",
    target: "deck",
    selector,
    match: /同じクラス/.test(clause) ? { kind: "shared_class", minimumShared: 1 } : null,
    revealReference: /公開/.test(clause),
    requireResultAtDeclaration: true,
    shuffleRemainingDeck: true,
    destination: /山札の上/.test(clause) ? "deck" : /山札の下/.test(clause) ? "deck" : /手札に加える/.test(clause) ? "hand" : "unspecified",
    position: /山札の上/.test(clause) ? "top" : /山札の下/.test(clause) ? "bottom" : null,
    sequence: ["search", "shuffle_remaining_deck", "move_accessed_card"]
    };
    const accessDragMatch = /アクセスし、?それを(?:(スリープ)して)?ドラッグする/.exec(clause);
    if (accessDragMatch) {
      Object.assign(accessOperation, {
        destination: "drag",
        followUp: {
          type: "drag",
          destination: "self_choose_area",
          useAccessedCards: true,
          ...(accessDragMatch[1] ? { enterSleep: true } : {})
        }
      });
    }
    if (/メモリ2以下になるよう任意の枚数のCode/.test(clause)) {
      Object.assign(accessOperation.selector, { category: "Code", count: "variable", minimum: 0, totalOriginalMemoryMaximum: 2 });
      Object.assign(accessOperation, { destination: "drag", optional: true, followUp: { type: "drag", destination: "self_choose_area", useAccessedCards: true } });
    }
    if (/[「『]レッドパンクス[」』]Lyd-Ob2枚/.test(clause)) {
      Object.assign(accessOperation.selector, { cardName: null, className: "レッドパンクス", category: "Lyd-Ob", count: 2, minimum: 1, maximum: 2 });
      Object.assign(accessOperation, { revealReference: true, requireResultAtDeclaration: true, asMuchAsPossible: true, destination: "split_hand_trash", distribution: { hand: 1, trash: 1, asMuchAsPossible: true } });
    }
    operations.push(accessOperation);
  }
  for (const match of allMatches(clause, /([+-]?)(\d+)\/([+-]?\d+)/g)) operations.push({
    type: "modify_stats",
    atk: Number(`${match[1] || "+"}${match[2]}`),
    str: Number(match[3]),
    duration: /このターン/.test(clause) ? "turn" : "persistent",
    application: /(?:すべて|全て)を/.test(clause) ? "snapshot" : "selected",
    target: /自分のクラス:([^Ob]+)Ob(?:すべて|全て)/.test(clause)
      ? { owner: "self", zones: ["area"], category: "Ob", className: clause.match(/自分のクラス:([^Ob]+)Ob(?:すべて|全て)/)?.[1] }
      : /マウントしたOb/.test(clause) ? "mounted_ob" : /1枚につき/.test(clause) || /^[①②③④][+-]?\d+\/[+-]?\d+/.test(clause) ? "source" : "selected",
    ...(/^[①②③④][+-]?\d+\/[+-]?\d+/.test(clause) && !/このターン/.test(clause) ? { stacking: "additive" } : {}),
    ...(/こうしてゴミ箱に送られたOb1枚につき/.test(clause) ? { multiplierFrom: { record: "milled_to_trash", filter: { category: "Ob" } } } : {})
  });
  return operations;
}

function parseCosts(text) {
  const costs = [];
  if (/そのカードと同じ色の自分の手札1枚を捨てて起動する/.test(text)) {
    costs.push({
      type: "discard",
      selector: {
        owner: "self",
        zones: ["hand"],
        count: 1,
        colorMatch: "trigger_event_card",
        requireColor: true,
        allowColorless: false
      }
    });
  }
  const layerCost = text.match(/レイヤーを(\d+)枚ゴミ箱に送ることで([①②③④])を起動する/);
  if (layerCost) {
    costs.push({
      type: "move_layer",
      source: "source_layers",
      destination: "trash",
      count: Number(layerCost[1]),
      minimum: Number(layerCost[1]),
      timing: "trigger_activation",
      activatesEffectNumber: "①②③④".indexOf(layerCost[2]) + 1
    });
  }
  return costs;
}

function splitClauses(text) {
  return text.split(/(?<=。)|(?=[①②③④])/).map((part) => part.replace(/^。|。$/g, "").trim()).filter(Boolean);
}

export function compileEffectText(sourceText = "", context = {}) {
  context = { ...context, category: normalizeCardCategory(context.category) };
  const normalizedText = normalizeEffectText(sourceText);
  const keywords = parseKeywords(normalizedText);
  const costs = parseCosts(normalizedText);
  const clauses = splitClauses(normalizedText).map((text, index) => {
    const localKeywords = parseKeywords(text);
    return { index, text, triggers: parseTrigger(text, localKeywords), operations: parseOperations(text, context), resultReference: parseResultReference(text), optional: /できる/.test(text), replacement: /かわりに/.test(text) };
  });
  let groupId = 0;
  for (let index = 0; index < clauses.length; index += 1) {
    const clause = clauses[index];
    if (index === 0 || clause.triggers.length || clause.resultReference || /^(?:その後|そうしたら)/.test(clause.text)) groupId += 1;
    clause.resolutionGroup = groupId;
    clause.resolutionMode = "sequential";
    const previous = clauses[index - 1];
    const standalonePersistentClause = context.category === "P-in" && previous?.triggers.length > 0;
    if (previous && !standalonePersistentClause && !clause.triggers.length && !clause.resultReference && !/^(?:その後|そうしたら)/.test(clause.text) && !/(?:その後|そうしたら)$/.test(previous.text)) {
      clause.resolutionGroup = previous.resolutionGroup;
      clause.resolutionMode = "simultaneous";
      previous.resolutionMode = "simultaneous";
    }
  }
  const operations = clauses.flatMap((clause) => clause.operations);
  
  const preset = CARD_OPERATION_PRESETS.get(context.id);
  if (preset) operations.push(structuredClone(preset));
  if (/①または②を1つ選び起動する/.test(normalizedText) && !operations.some((operation) => operation.type === "choose_numbered_effect")) {
    operations.push({ type: "choose_numbered_effect", options: [1, 2], count: 1 });
  }
  const selectionModules = compileSelectionModules(normalizedText);
  const selectionSpecs = selectionModules.flatMap((module) => [module.selection, module.allocation].filter(Boolean));
  if (/手札を1枚選び公開する。?それと同じクラス/.test(normalizedText)) {
    const access = operations.find((operation) => operation.type === "access" && operation.match?.kind === "shared_class");
    if (access) access.revealReference = true;
  }
  if (/プレイヤーを1人選ぶ。?そのプレイヤーはゴミ箱を(?:すべて|全て)デッキに(?:もどす|戻す)/.test(normalizedText)) {
    const selection = operations.find((operation) => operation.type === "select_player");
    if (selection) selection.eligibility = { zone: "trash", minimumCards: 1 };
  }
  for (const move of operations.filter((operation) => ["move", "move_all"].includes(operation.type) && operation.destination === "deck")) {
    if ((move.position ?? "unspecified") === "unspecified" && !/シャッフルしない/.test(normalizedText)) {
      operations.push({ type: "shuffle", target: move.target === "selected_player" ? "selected_player_deck" : "destination_deck", timing: "after_move" });
    }
  }
  for (const keyword of keywords) {
    if (keyword.name === "LAYERED") operations.unshift({ type: "layered_execution", requirement: keyword.value });
  }
  const warnings = [];
  for (let index = 0; index < clauses.length; index += 1) {
    if (clauses[index].operations.some((operation) => operation.reference === "previous_target")
      && !clauses.slice(0, index).some((entry) => entry.operations.some((operation) => ["select", "deal_damage"].includes(operation.type)))) {
      warnings.push({ code: "dangling_reference", clauseIndex: index, text: clauses[index].text, message: "参照可能な直前の対象がない" });
    }
  }
  const complexSignals = [
    ["choice_branch", /①②いずれか/], ["variable", /\b[XY]\b/], ["replacement", /かわりに/],
    ["same_column", /同じ縦列/], ["until_revealed", /公開している間/], ["count_history", /ターン中.*枚目|ターン中.*回目/]
  ];
  for (const [code, pattern] of complexSignals) {
    const representedChoice = code === "choice_branch" && operations.some((operation) => operation.type === "choose_numbered_effect");
    if (pattern.test(normalizedText) && !representedChoice) warnings.push({ code, message: `個別確認が必要: ${code}` });
  }
  const effectVerbPattern = /(?:ダメージ|回復|引く|捨て|破壊|配置|アクセス|ドラッグ|デコード|サルベージ|生成|移動|スタンバイ|スリープ|マウント|レイヤー|インストール|起動|実行メモリ|メモリ上限|\+[0-9XY]+\/[+-]?[0-9XY]+|-[0-9XY]+\/[+-]?[0-9XY]+)/;
  for (const clause of clauses) {
    const representedLayerThreshold = /レイヤー.*1枚以下.*破壊/.test(clause.text)
      && operations.some((operation) => operation.type === "destroy" && operation.reason === "layer_threshold_after_effect");
    const representedSplitCost = costs.length > 0 && /(?:送る|捨てる|破棄する)ことで$/.test(clause.text);
    const pureTriggerClause = /^これにObがマウントした時$/.test(clause.text);
    const reminderClause = /\[(?:QA|クイックアクション)\]\s*これを持(?:つ|った)Obは配置されたターンに攻撃できます。?/.test(clause.text)
      || /\[レスポンス(?::\d+)?\]\(相手からダメージを受けた時、\[レスポンス\]を持つカードを手札から指定のメモリを消費して使うことができます/.test(clause.text);
    const representedSharedClause = /\[ログイン\]自分のOb1体を破壊して$/.test(clause.text)
      || /\[レジデント\]自分のターン中、自分のカードが破壊される度、?$/.test(clause.text)
      || /^②を1つ選び起動する$/.test(clause.text)
      || /^\(上限以上に回復しない$/.test(clause.text);
    if (clause.operations.length === 0 && parseCosts(clause.text).length === 0 && !representedSplitCost && !pureTriggerClause
      && !reminderClause && !representedSharedClause && !representedLayerThreshold
      && effectVerbPattern.test(clause.text.replace(/\[[^\]]+\]/g, "")) && !/^①を起動する$/.test(clause.text)) {
      warnings.push({ code: "unparsed_effect_clause", clauseIndex: clause.index, text: clause.text, message: "効果を示す語が残っているが命令へ変換されていない" });
    }
  }
  if (preset) {
    const representedByRuntimeSpecial = new Set([
      "unparsed_effect_clause",
      "choice_branch",
      "replacement",
      "same_column",
      "until_revealed",
      "variable"
    ]);
    for (let index = warnings.length - 1; index >= 0; index -= 1) {
      if (representedByRuntimeSpecial.has(warnings[index].code)) warnings.splice(index, 1);
    }
  }
  const effectful = normalizedText && !/効果なし/.test(normalizedText);
  const reminderPatterns = [
    /\[デコイ\]\s*相手が効果でカードを選ぶ時、「デコイ」を持つカードしか選べません。/,
    /\[セキュリティ\]\s*Obが攻撃する時、「セキュリティ」を持つオブジェクトにしか攻撃対象を選択できません。ターン終了時にこれをスリープすることができます。/,
    /\[ハッキング\]\s*これを持つObは相手の\[セキュリティ\]を持つObを無視して攻撃できます。/,
    /\[暗号化\]\s*これを持つObは攻撃されません。/,
    /\[(?:QA|クイックアクション)\]\s*これを持(?:つ|った)Obは配置されたターンに攻撃できます。/
  ];
  const reminderTextDetected = reminderPatterns.some((pattern) => pattern.test(normalizedText));
  const status = !effectful || reminderTextDetected ? "supported" : operations.length === 0 ? "manual" : warnings.length ? "partial" : "supported";
  const hasIf = keywords.some((keyword) => keyword.name === "IF");
  const primaryResolutionGroup = clauses.find((clause) => clause.operations.length > 0)?.resolutionGroup ?? null;
  const referencesTriggerColor = costs.some((cost) => cost.selector?.colorMatch === "trigger_event_card");
  const ifCondition = keywords.find((keyword) => keyword.name === "IF")?.value ?? "";
  const triggerCardinality = /(?:毎|たび)に/.test(normalizedText) ? "per_occurrence" : "once_per_event";
  const triggerEventPolicy = /Obが破壊された時/.test(ifCondition)
    ? { event: "destruction", requiresDetermination: true, includeReplacement: true, excludePreventedOrNegated: true }
    : null;
  const attackTriggered = clauses.some((clause) => clause.triggers.some((trigger) => trigger.type === "attack"));
  const parentActionPolicy = attackTriggered
    ? { timing: "after_attack_declaration_before_combat", effectFailureCancelsParentAction: false, missingAttackTargetCancelsCombat: true }
    : null;
  const activationPolicy = context.category === "Script" && hasIf
    ? { triggerConditionRequired: true, effectApplicabilityRequired: true, applicabilityScope: "primary_resolution_group", primaryResolutionGroup, costsPayableRequired: costs.length > 0, triggerSubjectRequirements: referencesTriggerColor ? { faceUp: true, hasColor: true, allowColorless: false } : null, recheckTriggerAtResolution: false }
    : { triggerConditionRequired: false, effectApplicabilityRequired: true, applicabilityScope: "primary_resolution_group", primaryResolutionGroup, costsPayableRequired: costs.length > 0, triggerSubjectRequirements: referencesTriggerColor ? { faceUp: true, hasColor: true, allowColorless: false } : null, recheckTriggerAtResolution: false };
  return { version: 2, sourceText, normalizedText, status, keywords, clauses, costs, operations, selectionModules, selectionSpecs, warnings, reminderTextDetected, activationPolicy: { ...activationPolicy, triggerCardinality, triggerEventPolicy }, resolutionPolicy: { partialApplication: "as_much_as_possible", costsMustBePaidInFull: true }, parentActionPolicy };
}

export function hasKeyword(card, name) {
  if (INTRINSIC_KEYWORDS.get(card.id)?.includes(name)) return true;
  const compiled = card.compiled ?? compileEffectText(card.text);
  return compiled.keywords.some((keyword) => keyword.name === name && keyword.intrinsic !== false) || card.grantedKeywords?.includes(name);
}

export function keywordValue(card, name) {
  const compiled = card.compiled ?? compileEffectText(card.text);
  const keyword = compiled.keywords.find((item) => item.name === name && item.intrinsic !== false);
  if (!keyword) return null;
  if (keyword.value === null && ["PROTECT", "BACKUP"].includes(name)) return 1;
  return keyword.value;
}
