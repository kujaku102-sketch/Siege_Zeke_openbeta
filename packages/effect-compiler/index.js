// Entry of the effect-compiler SDK: card text -> operations. See README.md for the output contract.
export { compileEffectText, normalizeCardCategory, registerCardOperationPresets } from "./src/effect-compiler.js";
export { compileSelectionModules, parseLookSelectRemainderModule, parseDynamicThresholdSelectionModule, parseSelectAllocateFollowUpModule } from "./src/selection-modules.js";
