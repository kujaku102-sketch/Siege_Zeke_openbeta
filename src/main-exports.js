// UIからの循環参照を避けるための再公開専用モジュール。
export { canAttack, canExecuteRegistryCard, canOpeningMulligan, cardAtk, cardCurrentStr, cardHasKeyword, enabledSymbols, findCard, getActivatableEffects, getAttackTargets, getEffectTargets, getMaxMemory, spellNeedsTarget } from "./game/engine.js";
export { currentTutorialPresentation, currentTutorialStep } from "./data/tutorial.js";
