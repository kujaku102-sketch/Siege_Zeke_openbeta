// Display-only crop metadata. Add overrides only when the shared default crops a card badly.
export const CARD_ART_PROFILES = Object.freeze({});

const clamp = (value, minimum, maximum, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
};

export function cardArtProfile(card) {
  const override = CARD_ART_PROFILES[card?.id] ?? {};
  const defaultOrientation = card?.category === "Code" ? "square" : "portrait";
  return {
    orientation: ["portrait", "square"].includes(override.orientation) ? override.orientation : defaultOrientation,
    focusX: clamp(override.focusX, 0, 100, 50),
    focusY: clamp(override.focusY, 0, 100, 34),
    zoom: clamp(override.zoom, 1, 2, 1)
  };
}
