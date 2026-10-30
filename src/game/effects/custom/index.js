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
