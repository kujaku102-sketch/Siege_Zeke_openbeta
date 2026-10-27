// Background cut out to transparency (文豪 approved, 2026-10-27): only the character shows.
const monochromePlaceholder = new URL("../assets/navigator/monochrome-navigator.png", import.meta.url).href;

const MONOCHROME_PLACEHOLDER = Object.freeze({
  id: "monochrome-placeholder",
  name: "モノクロ・ナビゲーター（仮）",
  src: monochromePlaceholder,
  objectPosition: "center top",
});

export const NAVIGATOR_ASSETS = Object.freeze({
  default: MONOCHROME_PLACEHOLDER,
  basics: MONOCHROME_PLACEHOLDER,
  vengeance: MONOCHROME_PLACEHOLDER,
});

export function tutorialNavigator(tutorialId = "basics") {
  return NAVIGATOR_ASSETS[tutorialId] ?? NAVIGATOR_ASSETS.default;
}
