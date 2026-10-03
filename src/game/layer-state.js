export function normalizeLayerState(card) {
  if (!card || typeof card !== "object") return card;
  card.temporaryLayer = card.temporaryLayer === true;
  if (Array.isArray(card.mounted)) {
    card.mounted = card.mounted.map((mounted) => normalizeLayerState(mounted));
  } else {
    card.mounted = [];
  }
  return card;
}
