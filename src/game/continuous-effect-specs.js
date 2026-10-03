const freezeSpecs = (entries) => Object.freeze(Object.fromEntries(
  Object.entries(entries).map(([id, specs]) => [id, Object.freeze(specs.map((item) => Object.freeze(item)))])
));

export const CARD_CONTINUOUS_STAT_MODIFIER_SPECS = freezeSpecs({
  "STD-109": [{
    type: "modify_stats",
    target: "source",
    atk: 1,
    str: 1,
    condition: Object.freeze({
      expression: "source_has_any_keyword",
      keywords: Object.freeze(["HACKING", "ENCRYPTION"])
    })
  }]
});

export const CARD_CONDITIONAL_KEYWORD_SPECS = freezeSpecs({
  "STD-123": [{
    type: "grant_keywords",
    target: "source",
    keywords: Object.freeze(["QA", "HACKING"]),
    condition: Object.freeze({ expression: "source_atk_at_least", amount: 5 })
  }]
});

export const CARD_MANDATORY_STATE_CHECK_SPECS = freezeSpecs({
  "STD-084": [{
    type: "destroy",
    target: "source",
    suppressReplacement: false,
    condition: Object.freeze({ expression: "source_is_not_mounted" })
  }],
  "STD-123": [{
    type: "destroy",
    target: "source",
    suppressReplacement: true,
    condition: Object.freeze({ expression: "source_max_str_at_most", amount: 0 })
  }]
});

export const CARD_PLAYER_VALUE_MODIFIER_SPECS = freezeSpecs({
  "STD-004": [{
    type: "modify_player_value",
    value: "max_memory",
    amount: 1,
    providerZone: "registry",
    faceUp: true,
    aggregation: "once"
  }],
  "STD-005": [{
    type: "modify_player_value",
    value: "max_memory",
    amount: 2,
    providerZone: "registry",
    faceUp: true,
    aggregation: "each"
  }]
});

export const CARD_EXECUTION_COST_MODIFIER_SPECS = freezeSpecs({
  "STD-100": [{
    type: "modify_execution_cost",
    target: "source",
    amount: -1,
    multiplier: Object.freeze({
      expression: "own_area_distinct_name_count",
      filter: Object.freeze({ className: "レッドパンクス" })
    })
  }],
  "STD-007": [{
    type: "modify_execution_cost",
    amount: -1,
    providerOwner: "self",
    providerZone: "registry",
    faceUp: true,
    aggregation: "once",
    condition: Object.freeze({ expression: "target_name_in_controller_trash" })
  }],
  "STD-008": [{
    type: "modify_execution_cost",
    amount: 1,
    providerOwner: "enemy",
    providerZone: "area",
    faceUp: true,
    aggregation: "once"
  }]
});

export const CARD_MOUNTED_STAT_MODIFIER_SPECS = freezeSpecs({
  "STD-078": [{ type: "modify_stats", target: "mounted_host", atk: 1, str: 1 }],
  "STD-079": [{ type: "modify_stats", target: "mounted_host", atk: 2, str: 0 }],
  "STD-080": [{ type: "modify_stats", target: "mounted_host", atk: 0, str: 2 }]
});

export const CARD_MOUNTED_KEYWORD_SPECS = freezeSpecs({
  "STD-079": [{ type: "grant_keyword", target: "mounted_host", keyword: "CONTACT" }],
  "STD-080": [
    { type: "grant_keyword", target: "mounted_host", keyword: "SECURITY" },
    { type: "grant_keyword", target: "mounted_host", keyword: "PROTECT", consumedFlag: "protectConsumed" }
  ]
});

export const CARD_MOUNT_EVENT_SPECS = freezeSpecs({
  "STD-016": [{
    event: "ob_mounted_on_source",
    actions: Object.freeze([
      Object.freeze({ type: "grant_backup", target: "mounted_host", amount: 1 }),
      Object.freeze({ type: "draw", target: "source_controller", amount: 1 }),
      Object.freeze({ type: "destroy", target: "source_layer" })
    ])
  }],
  "STD-017": [{
    event: "ob_mounted_on_source",
    actions: Object.freeze([
      Object.freeze({ type: "grant_protect", target: "mounted_host", amount: 1 }),
      Object.freeze({ type: "modify_stats", target: "mounted_host", atk: 0, str: 3, duration: "game" }),
      Object.freeze({ type: "destroy", target: "source_layer" })
    ])
  }],
  "STD-234": [{
    event: "mounted_host_slept",
    actions: Object.freeze([
      Object.freeze({ type: "discard", target: "source_owner_hand", count: 1 })
    ])
  }],
  "STD-235": [{
    event: "mounted_host_slept",
    actions: Object.freeze([
      Object.freeze({ type: "deal_damage", target: "source_owner_user", amount: 2 })
    ])
  }]
});

export const CARD_AURA_KEYWORD_SPECS = freezeSpecs({
  "STD-115": [{
    type: "grant_keyword",
    providerZone: "area",
    target: "own_class_ob_all",
    className: "エレクトロンフェアリー",
    keyword: "ENCRYPTION"
  }],
  "STD-117": [
    { type: "grant_keyword", providerZone: "front", target: "source", keyword: "HACKING" },
    { type: "grant_keyword", providerZone: "back", target: "own_color_ob_all", color: "青", keyword: "ENCRYPTION" }
  ]
});

export const CARD_ATTACK_PERMISSION_SPECS = freezeSpecs({
  "STD-091": [{ type: "restrict_targets", rule: "ob_if_possible" }],
  "STD-181": [{ type: "require_attack_condition", condition: "own_script_activated_this_turn" }],
  "STD-220": [{ type: "forbid_target", target: "enemy_user", condition: "source_registry_executed_this_turn" }]
});

export const CARD_DESTRUCTION_PERMISSION_SPECS = freezeSpecs({
  "STD-159": [{ type: "forbid_destruction", target: "source" }]
});

export const CARD_PLACEMENT_PERMISSION_SPECS = freezeSpecs({
  "STD-088": [{ type: "forbid_execution" }],
  "STD-193": [{ type: "require_execution_zone", zone: "back" }],
  "STD-201": [{ type: "forbid_mount_on_source" }],
  "STD-228": [{ type: "forbid_mount_on_source" }]
});

const specsFor = (registry, cardId) => registry[cardId] ?? Object.freeze([]);

export const continuousStatModifierSpecsFor = (cardId) => specsFor(CARD_CONTINUOUS_STAT_MODIFIER_SPECS, cardId);
export const conditionalKeywordSpecsFor = (cardId) => specsFor(CARD_CONDITIONAL_KEYWORD_SPECS, cardId);
export const mandatoryStateCheckSpecsFor = (cardId) => specsFor(CARD_MANDATORY_STATE_CHECK_SPECS, cardId);
export const playerValueModifierSpecsFor = (cardId) => specsFor(CARD_PLAYER_VALUE_MODIFIER_SPECS, cardId);
export const executionCostModifierSpecsFor = (cardId) => specsFor(CARD_EXECUTION_COST_MODIFIER_SPECS, cardId);
export const mountedStatModifierSpecsFor = (cardId) => specsFor(CARD_MOUNTED_STAT_MODIFIER_SPECS, cardId);
export const mountedKeywordSpecsFor = (cardId) => specsFor(CARD_MOUNTED_KEYWORD_SPECS, cardId);
export const mountEventSpecsFor = (cardId) => specsFor(CARD_MOUNT_EVENT_SPECS, cardId);
export const auraKeywordSpecsFor = (cardId) => specsFor(CARD_AURA_KEYWORD_SPECS, cardId);
export const attackPermissionSpecsFor = (cardId) => specsFor(CARD_ATTACK_PERMISSION_SPECS, cardId);
export const destructionPermissionSpecsFor = (cardId) => specsFor(CARD_DESTRUCTION_PERMISSION_SPECS, cardId);
export const placementPermissionSpecsFor = (cardId) => specsFor(CARD_PLACEMENT_PERMISSION_SPECS, cardId);

export const continuousEffectCardIds = () => [...new Set([
  ...Object.keys(CARD_CONTINUOUS_STAT_MODIFIER_SPECS),
  ...Object.keys(CARD_CONDITIONAL_KEYWORD_SPECS),
  ...Object.keys(CARD_MANDATORY_STATE_CHECK_SPECS),
  ...Object.keys(CARD_PLAYER_VALUE_MODIFIER_SPECS),
  ...Object.keys(CARD_EXECUTION_COST_MODIFIER_SPECS),
  ...Object.keys(CARD_MOUNTED_STAT_MODIFIER_SPECS),
  ...Object.keys(CARD_MOUNTED_KEYWORD_SPECS),
  ...Object.keys(CARD_MOUNT_EVENT_SPECS),
  ...Object.keys(CARD_AURA_KEYWORD_SPECS),
  ...Object.keys(CARD_ATTACK_PERMISSION_SPECS),
  ...Object.keys(CARD_DESTRUCTION_PERMISSION_SPECS),
  ...Object.keys(CARD_PLACEMENT_PERMISSION_SPECS)
])];
