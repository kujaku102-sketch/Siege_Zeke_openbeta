import { std085LayerPaySelection } from "./std_085.js";
import { std097BattleChoiceSelection, std097BattlePaySelection } from "./std_097.js";
import { std099ReplacementMaterialsSelection } from "./std_099.js";
import { std102PlaceSelection } from "./std_102.js";
import { activateStd105Selection } from "./std_105.js";
import { technologyHorizonSelection } from "./std_122.js";
import { hahanamoriStandbySelection } from "./std_136.js";
import { std140UpdateChoiceSelection, std140ProtectSelection } from "./std_140.js";
import { std141ChoiceSelection, std141TurnEndSourceSelection, std141AccessSelection, std141AccessDestinationSelection, std141PlaceYellowObSelection } from "./std_141.js";
import { activateStd142Effect1Selection, std142TurnEndChoiceSelection, std142DestroySelection, std142SalvageSelection } from "./std_142.js";
import { std157PlaceSelection } from "./std_157.js";
import { std157DestroySelection } from "./std_157_162.js";
import { std162SalvageSelection } from "./std_162.js";
import { std163DestroySelection, std163ChoiceSelection, std163DamageSelection } from "./std_163.js";
import { std164ChoiceSelection, std164PoisonSelection } from "./std_164.js";
import { std165LoginSelection } from "./std_165.js";
import { std179PlaceSelection } from "./std_179.js";
import { std182AttackScriptSelection } from "./std_182.js";
import { std184PlaceObSelection } from "./std_184.js";
import { std185DefenderSubstituteSelection, std185AttackerSubstituteSelection } from "./std_185.js";
import { activateStd203ResponseSelection } from "./std_203.js";
import { std207RevealSelection } from "./std_207.js";
import { std212RespawnCountSelection } from "./std_212.js";
import { std214AttackCostSelection } from "./std_214.js";
import { std223AmbushChoiceSelection, std223AmbushTargetSelection } from "./std_223.js";
import { std226CompressSelection } from "./std_226.js";
import { playStd229Selection } from "./std_229.js";
import { std230AmbushChoiceSelection, std230InstallHandSelection } from "./std_230.js";
import { sztb094CounterSelectSelection, sztb094CounterTargetSelection } from "./sztb_094.js";
import { sztb095SpReplacementSelection } from "./sztb_095.js";
import { sztb097ChoiceSelection, sztb097AccessSelection, sztb097AtkSumSelection, sztb097DestroySelection } from "./sztb_097.js";
import { sztbJacketPlaceSelection } from "./sztb_jacket.js";
import { std011GetEffectTargets } from "./std_011.js";
import { std034ResponseCardApplicable } from "./std_034.js";
import { std047ResponseCardApplicable } from "./std_047.js";
import { std048ActivateCardEffectCore } from "./std_048.js";
import { std049GetEffectActivationTargets } from "./std_049.js";
import { std085AttackCore5 } from "./std_085.js";
import { std086PlayCardCore2 } from "./std_086.js";
import { std095AttackCore6 } from "./std_095.js";
import { std096AttackCore, std096ResolveCardSelectionCore } from "./std_096.js";
import { std104ResolveSpell } from "./std_104.js";
import { std105ActivateScriptCore, std105ActivateScriptCore2 } from "./std_105.js";
import { std106AttackCore4, std106ActivateCardEffectCore } from "./std_106.js";
import { std121ActivateScriptCore } from "./std_121.js";
import { std122ResolveSpell } from "./std_122.js";
import { std124ResolveLogin, std124ActivateCardEffectCore } from "./std_124.js";
import { std136QueuePostAttackSelection } from "./std_136.js";
import { std140ActivateCardEffectCore } from "./std_140.js";
import { std142ActivateScriptCore, std142ActivateScriptCore2 } from "./std_142.js";
import { std157ResolveLogin, std157GetEffectActivationTargets2, std157ActivateCardEffectCore } from "./std_157.js";
import { std160ResolveLogin, std160ActivateCardEffectCore } from "./std_160.js";
import { std162ResolveSpell } from "./std_162.js";
import { std163ResolveSpell } from "./std_163.js";
import { std167ResponseCardApplicable, std167ResolveDeclaredResponse } from "./std_167.js";
import { std169GetEffectActivationTargets, std169ActivateCardEffectCore } from "./std_169.js";
import { std182AttackCore2 } from "./std_182.js";
import { std184PlayCardCore } from "./std_184.js";
import { std192GetEffectActivationTargets2 } from "./std_192.js";
import { std196GetEffectActivationTargets2 } from "./std_196.js";
import { std203NormalSpellSelection, std203ResolveSpell, std203ResponseCardApplicable } from "./std_203.js";
import { std204ActivateScriptCore } from "./std_204.js";
import { std207ResolveSpell } from "./std_207.js";
import { std211NormalSpellSelection, std211PlayCardCore4, std211ResolveSpell } from "./std_211.js";
import { std212ResolveSpell } from "./std_212.js";
import { std214AttackCore3 } from "./std_214.js";
import { std220PlayCardCore3 } from "./std_220.js";
import { std224InstallCard } from "./std_224.js";
import { std227AttackCore, std227ResolveLogin, std227ActivateCardEffectCore } from "./std_227.js";
import { std228ActivateCardEffectCore } from "./std_228.js";
import { std229PlayCardCore, std229ResolveSpell } from "./std_229.js";
import { std231ActivateScriptCore } from "./std_231.js";
import { std237ActivateCardEffectCore } from "./std_237.js";
import { std238ResolveCardSelectionCore } from "./std_238.js";
import { sztb094ResolveLogin2 } from "./sztb_094.js";
import { sztb096GetEffectTargets } from "./sztb_096.js";
import { sztb097ResolveSpell } from "./sztb_097.js";
import { sztb098ResolveSpell } from "./sztb_098.js";

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
  "std185-defender-substitute": std185DefenderSubstituteSelection,
  "std185-attacker-substitute": std185AttackerSubstituteSelection,
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

// core/play.js: card id -> handler
export const CUSTOM_PLAY_CARD_CORE_2 = Object.freeze({
  __proto__: null,
  "STD-086": std086PlayCardCore2,
  "STD-211": std086PlayCardCore2,
  "SZTB-096": std086PlayCardCore2,
  "SZTB-097": std086PlayCardCore2,
  "SZTB-098": std086PlayCardCore2,
  "SZTB-099": std086PlayCardCore2
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
