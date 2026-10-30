import { std003ResolveDeclaredScript } from "../../../cards/std/std_003_effects.js";
import { std011GetEffectTargets } from "../../../cards/std/std_011_effects.js";
import { std018NotifyCardExecuted } from "../../../cards/std/std_018_effects.js";
import { std019NotifyCardExecuted } from "../../../cards/std/std_019_effects.js";
import { std034ResponseCardApplicable } from "../../../cards/std/std_034_effects.js";
import { std047ResponseCardApplicable } from "../../../cards/std/std_047_effects.js";
import { std048ActivateCardEffectCore } from "../../../cards/std/std_048_effects.js";
import { std049GetEffectActivationTargets } from "../../../cards/std/std_049_effects.js";
import { std085AttackCore5, std085LayerPaySelection } from "../../../cards/std/std_085_effects.js";
import { std095AttackCore6 } from "../../../cards/std/std_095_effects.js";
import { std096AttackCore, std096ResolveCardSelectionCore } from "../../../cards/std/std_096_effects.js";
import { std097BattleChoiceSelection, std097BattlePaySelection } from "../../../cards/std/std_097_effects.js";
import { std099ReplacementMaterialsSelection } from "../../../cards/std/std_099_effects.js";
import { std102PlaceSelection } from "../../../cards/std/std_102_effects.js";
import { std104ResolveSpell } from "../../../cards/std/std_104_effects.js";
import { activateStd105Selection, std105ActivateScriptCore, std105ActivateScriptCore2 } from "../../../cards/std/std_105_effects.js";
import { std106ActivateCardEffectCore, std106AttackCore4 } from "../../../cards/std/std_106_effects.js";
import { std121ActivateScriptCore } from "../../../cards/std/std_121_effects.js";
import { std122ResolveSpell, technologyHorizonSelection } from "../../../cards/std/std_122_effects.js";
import { std124ActivateCardEffectCore, std124ResolveLogin } from "../../../cards/std/std_124_effects.js";
import { hahanamoriStandbySelection, std136QueuePostAttackSelection } from "../../../cards/std/std_136_effects.js";
import { std140ActivateCardEffectCore, std140ProtectSelection, std140UpdateChoiceSelection } from "../../../cards/std/std_140_effects.js";
import { std141AccessDestinationSelection, std141AccessSelection, std141ChoiceSelection, std141PlaceYellowObSelection, std141TurnEndSourceSelection } from "../../../cards/std/std_141_effects.js";
import { activateStd142Effect1Selection, std142ActivateScriptCore, std142ActivateScriptCore2, std142DestroySelection, std142SalvageSelection, std142TurnEndChoiceSelection } from "../../../cards/std/std_142_effects.js";
import { std148ResolveDeclaredScript } from "../../../cards/std/std_148_effects.js";
import { std157DestroySelection } from "../../../cards/std/std_157_effects.js";
import { std157ActivateCardEffectCore, std157GetEffectActivationTargets2, std157PlaceSelection, std157ResolveLogin } from "../../../cards/std/std_157_effects.js";
import { std160ActivateCardEffectCore, std160ResolveLogin } from "../../../cards/std/std_160_effects.js";
import { std162ResolveSpell, std162SalvageSelection } from "../../../cards/std/std_162_effects.js";
import { std163ChoiceSelection, std163DamageSelection, std163DestroySelection, std163ResolveSpell } from "../../../cards/std/std_163_effects.js";
import { std164ChoiceSelection, std164PoisonSelection } from "../../../cards/std/std_164_effects.js";
import { std165DrainIndependentEffects, std165LoginSelection } from "../../../cards/std/std_165_effects.js";
import { std167ResolveDeclaredResponse, std167ResponseCardApplicable } from "../../../cards/std/std_167_effects.js";
import { std169ActivateCardEffectCore, std169GetEffectActivationTargets } from "../../../cards/std/std_169_effects.js";
import { std179PlaceSelection } from "../../../cards/std/std_179_effects.js";
import { std182AttackCore2, std182AttackScriptSelection } from "../../../cards/std/std_182_effects.js";
import { std184PlaceObSelection, std184PlayCardCore } from "../../../cards/std/std_184_effects.js";
import { std192GetEffectActivationTargets2 } from "../../../cards/std/std_192_effects.js";
import { std196GetEffectActivationTargets2 } from "../../../cards/std/std_196_effects.js";
import { activateStd203ResponseSelection, std203NormalSpellSelection, std203ResolveSpell, std203ResponseCardApplicable } from "../../../cards/std/std_203_effects.js";
import { std204ActivateScriptCore } from "../../../cards/std/std_204_effects.js";
import { std207ResolveSpell, std207RevealSelection } from "../../../cards/std/std_207_effects.js";
import { std211NormalSpellSelection, std211PlayCardCore4, std211ResolveSpell } from "../../../cards/std/std_211_effects.js";
import { std212ResolveSpell, std212RespawnCountSelection } from "../../../cards/std/std_212_effects.js";
import { std214AttackCore3, std214AttackCostSelection } from "../../../cards/std/std_214_effects.js";
import { std217DrainIndependentEffects } from "../../../cards/std/std_217_effects.js";
import { std220PlayCardCore3 } from "../../../cards/std/std_220_effects.js";
import { std223AmbushChoiceSelection, std223AmbushTargetSelection } from "../../../cards/std/std_223_effects.js";
import { std224InstallCard } from "../../../cards/std/std_224_effects.js";
import { std226CompressSelection } from "../../../cards/std/std_226_effects.js";
import { std227ActivateCardEffectCore, std227AttackCore, std227ResolveLogin } from "../../../cards/std/std_227_effects.js";
import { std228ActivateCardEffectCore } from "../../../cards/std/std_228_effects.js";
import { playStd229Selection, std229PlayCardCore, std229ResolveSpell } from "../../../cards/std/std_229_effects.js";
import { std230AmbushChoiceSelection, std230InstallHandSelection } from "../../../cards/std/std_230_effects.js";
import { std231ActivateScriptCore } from "../../../cards/std/std_231_effects.js";
import { std237ActivateCardEffectCore } from "../../../cards/std/std_237_effects.js";
import { std238ResolveCardSelectionCore } from "../../../cards/std/std_238_effects.js";
import { sztb094CounterDrainIndependentEffects, sztb094CounterSelectSelection, sztb094CounterTargetSelection, sztb094ResolveLogin2 } from "../../../cards/sztb/sztb_094_effects.js";
import { sztb095SpReplacementSelection } from "../../../cards/sztb/sztb_095_effects.js";
import { sztb096GetEffectTargets, sztb096SpellCleanupExtra } from "../../../cards/sztb/sztb_096_effects.js";
import { sztb097AccessSelection, sztb097AtkSumSelection, sztb097ChoiceSelection, sztb097DestroySelection, sztb097ResolveSpell } from "../../../cards/sztb/sztb_097_effects.js";
import { sztb098ResolveSpell } from "../../../cards/sztb/sztb_098_effects.js";
import { sztbJacketPlaceSelection } from "../../../cards/sztb/sztb_096_effects.js";

// A handler returns PASS when it did not take over: the caller continues as if the branch had not matched.
export const PASS = Symbol("custom-effect-pass");

// continuation type -> handler of resolveCardSelectionCore (card-specific continuations). Null prototype: only the listed types match.
export const CUSTOM_SELECTION_HANDLERS = Object.freeze({
  __proto__: null,
  "std099-replacement-materials": std099ReplacementMaterialsSelection,
  "std157-destroy": std157DestroySelection,
  "std162-destroy": std157DestroySelection,
  "std157-place": std157PlaceSelection,
  "std162-salvage": std162SalvageSelection,
  "sztb-jacket-place": sztbJacketPlaceSelection,
  "sztb095-sp-replacement": sztb095SpReplacementSelection,
  "sztb097-choice": sztb097ChoiceSelection,
  "sztb097-access": sztb097AccessSelection,
  "sztb097-atk-sum": sztb097AtkSumSelection,
  "sztb097-destroy": sztb097DestroySelection,
  "sztb094-counter-select": sztb094CounterSelectSelection,
  "sztb094-counter-target": sztb094CounterTargetSelection,
  "activate-std203-response": activateStd203ResponseSelection,
  "std141-choice": std141ChoiceSelection,
  "std141-turn-end-source": std141TurnEndSourceSelection,
  "std140-update-choice": std140UpdateChoiceSelection,
  "std223-ambush-choice": std223AmbushChoiceSelection,
  "std223-ambush-target": std223AmbushTargetSelection,
  "std140-protect": std140ProtectSelection,
  "std141-access": std141AccessSelection,
  "std141-access-destination": std141AccessDestinationSelection,
  "std141-place-yellow-ob": std141PlaceYellowObSelection,
  "std097-battle-choice": std097BattleChoiceSelection,
  "std097-battle-pay": std097BattlePaySelection,
  "std085-layer-pay": std085LayerPaySelection,
  "std102-place": std102PlaceSelection,
  "std164-choice": std164ChoiceSelection,
  "std164-poison": std164PoisonSelection,
  "std212-respawn-count": std212RespawnCountSelection,
  "activate-std142-effect1": activateStd142Effect1Selection,
  "std163-destroy": std163DestroySelection,
  "std163-choice": std163ChoiceSelection,
  "std163-damage": std163DamageSelection,
  "std142-turn-end-choice": std142TurnEndChoiceSelection,
  "std142-destroy": std142DestroySelection,
  "std142-salvage": std142SalvageSelection,
  "activate-std105": activateStd105Selection,
  "std165-login": std165LoginSelection,
  "std179-place": std179PlaceSelection,
  "std182-attack-script": std182AttackScriptSelection,
  "std184-place-ob": std184PlaceObSelection,
  "play-std229": playStd229Selection,
  "std214-attack-cost": std214AttackCostSelection,
  "std226-compress": std226CompressSelection,
  "std230-ambush-choice": std230AmbushChoiceSelection,
  "std230-install-hand": std230InstallHandSelection,
  "technology-horizon": technologyHorizonSelection,
  "std207-reveal": std207RevealSelection,
  "hahanamori-standby": hahanamoriStandbySelection
});

// core/battle.js: card id -> handler
export const CUSTOM_QUEUE_POST_ATTACK_SELECTION = Object.freeze({
  __proto__: null,
  "STD-136": std136QueuePostAttackSelection
});

// core/battle.js: card id -> handler (a handler returns PASS when it did not take the branch)
export const CUSTOM_ATTACK_CORE = Object.freeze({
  __proto__: null,
  "STD-227": std227AttackCore,
  "STD-096": std096AttackCore,
  "STD-102": std096AttackCore,
  "STD-238": std096AttackCore
});

// core/battle.js: card id -> handler (a handler returns PASS when it did not take the branch)
export const CUSTOM_ATTACK_CORE_2 = Object.freeze({
  __proto__: null,
  "STD-182": std182AttackCore2
});

// core/battle.js: card id -> handler (a handler returns PASS when it did not take the branch)
export const CUSTOM_ATTACK_CORE_3 = Object.freeze({
  __proto__: null,
  "STD-214": std214AttackCore3
});

// core/battle.js: card id -> handler
export const CUSTOM_ATTACK_CORE_4 = Object.freeze({
  __proto__: null,
  "STD-106": std106AttackCore4
});

// core/battle.js: card id -> handler (a handler returns PASS when it did not take the branch)
export const CUSTOM_ATTACK_CORE_5 = Object.freeze({
  __proto__: null,
  "STD-085": std085AttackCore5
});

// core/battle.js: card id -> handler
export const CUSTOM_ATTACK_CORE_6 = Object.freeze({
  __proto__: null,
  "STD-095": std095AttackCore6
});

// core/play.js: card id -> handler
export const CUSTOM_INSTALL_CARD = Object.freeze({
  __proto__: null,
  "STD-224": std224InstallCard
});

// core/play.js: card id -> handler (a handler returns PASS when it did not take the branch)
export const CUSTOM_NORMAL_SPELL_SELECTION = Object.freeze({
  __proto__: null,
  "STD-211": std211NormalSpellSelection,
  "STD-203": std203NormalSpellSelection
});

// core/play.js: card id -> handler (a handler returns PASS when it did not take the branch)
export const CUSTOM_PLAY_CARD_CORE = Object.freeze({
  __proto__: null,
  "STD-229": std229PlayCardCore,
  "STD-184": std184PlayCardCore
});

// core/play.js: card id -> extra fields of state.deferredSpellCleanup (what the Sp still has to do before it goes to the trash)
export const CUSTOM_SPELL_CLEANUP_EXTRA = Object.freeze({
  __proto__: null,
  "SZTB-096": sztb096SpellCleanupExtra,
  "SZTB-097": sztb096SpellCleanupExtra,
  "SZTB-098": sztb096SpellCleanupExtra,
  "SZTB-099": sztb096SpellCleanupExtra
});

// core/play.js: card id -> handler
export const CUSTOM_PLAY_CARD_CORE_3 = Object.freeze({
  __proto__: null,
  "STD-220": std220PlayCardCore3
});

// core/play.js: card id -> handler (a handler returns PASS when it did not take the branch)
export const CUSTOM_PLAY_CARD_CORE_4 = Object.freeze({
  __proto__: null,
  "STD-211": std211PlayCardCore4
});

// core/play.js: card id -> handler
export const CUSTOM_RESOLVE_LOGIN = Object.freeze({
  __proto__: null,
  "STD-157": std157ResolveLogin,
  "STD-160": std160ResolveLogin,
  "STD-227": std227ResolveLogin,
  "STD-124": std124ResolveLogin
});

// core/play.js: card id -> handler
export const CUSTOM_RESOLVE_LOGIN_2 = Object.freeze({
  __proto__: null,
  "SZTB-094": sztb094ResolveLogin2
});

// core/play.js: card id -> handler (a handler returns PASS when it did not take the branch)
export const CUSTOM_RESOLVE_SPELL = Object.freeze({
  __proto__: null,
  "SZTB-097": sztb097ResolveSpell,
  "SZTB-098": sztb098ResolveSpell,
  "STD-229": std229ResolveSpell,
  "STD-104": std104ResolveSpell,
  "STD-122": std122ResolveSpell,
  "STD-203": std203ResolveSpell,
  "STD-212": std212ResolveSpell,
  "STD-163": std163ResolveSpell,
  "STD-211": std211ResolveSpell,
  "STD-207": std207ResolveSpell,
  "STD-162": std162ResolveSpell
});

// core/play.js: card id -> handler (a handler returns PASS when it did not take the branch)
export const CUSTOM_GET_EFFECT_TARGETS = Object.freeze({
  __proto__: null,
  "STD-011": std011GetEffectTargets,
  "SZTB-096": sztb096GetEffectTargets
});

// core/play.js: card id -> handler (a handler returns PASS when it did not take the branch)
export const CUSTOM_GET_EFFECT_ACTIVATION_TARGETS = Object.freeze({
  __proto__: null,
  "STD-169": std169GetEffectActivationTargets,
  "STD-049": std049GetEffectActivationTargets
});

// core/play.js: card id -> handler (a handler returns PASS when it did not take the branch)
export const CUSTOM_GET_EFFECT_ACTIVATION_TARGETS_2 = Object.freeze({
  __proto__: null,
  "STD-192": std192GetEffectActivationTargets2,
  "STD-196": std196GetEffectActivationTargets2,
  "STD-157": std157GetEffectActivationTargets2
});

// core/play.js: card id -> handler (a handler returns PASS when it did not take the branch)
export const CUSTOM_ACTIVATE_CARD_EFFECT_CORE = Object.freeze({
  __proto__: null,
  "STD-140": std140ActivateCardEffectCore,
  "STD-228": std228ActivateCardEffectCore,
  "STD-237": std237ActivateCardEffectCore,
  "STD-157": std157ActivateCardEffectCore,
  "STD-227": std227ActivateCardEffectCore,
  "STD-048": std048ActivateCardEffectCore,
  "STD-049": std048ActivateCardEffectCore,
  "STD-124": std124ActivateCardEffectCore,
  "STD-106": std106ActivateCardEffectCore,
  "STD-169": std169ActivateCardEffectCore,
  "STD-160": std160ActivateCardEffectCore
});

// core/response.js: card id -> handler (a handler returns PASS when it did not take the branch)
export const CUSTOM_RESPONSE_CARD_APPLICABLE = Object.freeze({
  __proto__: null,
  "STD-034": std034ResponseCardApplicable,
  "STD-047": std047ResponseCardApplicable,
  "STD-167": std167ResponseCardApplicable,
  "STD-203": std203ResponseCardApplicable
});

// core/response.js: card id -> handler
export const CUSTOM_RESOLVE_DECLARED_RESPONSE = Object.freeze({
  __proto__: null,
  "STD-167": std167ResolveDeclaredResponse
});

// core/scripts.js: card id -> handler (a handler returns PASS when it did not take the branch)
export const CUSTOM_ACTIVATE_SCRIPT_CORE = Object.freeze({
  __proto__: null,
  "STD-142": std142ActivateScriptCore,
  "STD-105": std105ActivateScriptCore,
  "STD-204": std204ActivateScriptCore,
  "STD-121": std121ActivateScriptCore,
  "STD-231": std231ActivateScriptCore
});

// core/scripts.js: card id -> handler (a handler returns PASS when it did not take the branch)
export const CUSTOM_ACTIVATE_SCRIPT_CORE_2 = Object.freeze({
  __proto__: null,
  "STD-142": std142ActivateScriptCore2,
  "STD-105": std105ActivateScriptCore2
});

// effects/generic/selection.js: card id -> handler (a handler returns PASS when it did not take the branch)
export const CUSTOM_RESOLVE_CARD_SELECTION_CORE = Object.freeze({
  __proto__: null,
  "STD-238": std238ResolveCardSelectionCore,
  "STD-096": std096ResolveCardSelectionCore
});

// core/effects.js: card id -> handler
export const CUSTOM_DRAIN_INDEPENDENT_EFFECTS = Object.freeze({
  __proto__: null,
  "STD-217": std217DrainIndependentEffects,
  "SZTB-094-COUNTER": sztb094CounterDrainIndependentEffects,
  "STD-165": std165DrainIndependentEffects
});

// core/effects.js: card id -> handler
export const CUSTOM_RESOLVE_DECLARED_SCRIPT = Object.freeze({
  __proto__: null,
  "STD-003": std003ResolveDeclaredScript,
  "STD-148": std148ResolveDeclaredScript
});

// core/play.js: card id -> handler (a handler returns PASS when it did not take the branch)
export const CUSTOM_NOTIFY_CARD_EXECUTED = Object.freeze({
  __proto__: null,
  "STD-018": std018NotifyCardExecuted,
  "STD-019": std019NotifyCardExecuted
});
