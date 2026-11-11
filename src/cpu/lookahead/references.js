// What a re-drawn state still says about the real cards it replaced.
//
// determinize (sim.js) puts a drawn card in the place of every card the seat cannot see. The engine keeps more than the zones: an activation window, a choice that is waiting, the last event,
// the queue of scripts, the turn a card came into play, all name the cards they are about by uid, and some hold a copy of the card or build their own id from the card's id and uid
// ("EV-21:STD-239:own-user-damaged:rt:i:79"). Left as they are, they say what the real card was, and the engine, asked to try a move on the state, answers from the real card.
//
// So every reference to a replaced card is turned into a reference to the card drawn for it: a uid, a key, a copy of the card (it becomes a copy of the drawn card), and, in a string
// that names a replaced card, the card id of the replaced card (it becomes the drawn card's id). The drawn card takes the place of the real one in everything the state says about it.
//
// `replaced` is [{ uid, id, fresh }]: the real card's uid and card id, and the card drawn for it. A card that was mounted on a replaced card goes with it (the same entry, its own uid).
// `compiled` (the card's compiled effect) is shared with the real state and is read only: it is never entered.

const escapePattern = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function remapReferences(state, replaced) {
  if (replaced.length === 0) return;
  const byUid = new Map(replaced.map((entry) => [entry.uid, entry]));
  // a uid inside a longer string ("...:rt:i:79"), where a longer uid is tried before a shorter one that starts the same ("rt:i:79" before "rt:i:7")
  const inString = new RegExp(`(${[...byUid.keys()].sort((a, b) => b.length - a.length).map(escapePattern).join('|')})(?![0-9A-Za-z_])`, 'g');

  const mapString = (text) => {
    if (byUid.has(text)) return byUid.get(text).fresh.uid;
    if (!text.includes(':') && !text.includes('-')) return text;
    let first = null;
    const mapped = text.replace(inString, (found) => { const entry = byUid.get(found); first ??= entry; return entry.fresh.uid; });
    return first === null ? text : mapped.split(first.id).join(first.fresh.id);
  };

  const visit = (value, seen) => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return value;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, index) => { value[index] = mapValue(item, seen); });
      return value;
    }
    for (const key of Object.keys(value)) {
      if (key === 'compiled') continue;
      const mapped = mapValue(value[key], seen);
      const renamed = byUid.has(key) ? byUid.get(key).fresh.uid : key;
      if (renamed !== key) { delete value[key]; value[renamed] = mapped; } else value[key] = mapped;
    }
    return value;
  };
  const mapValue = (item, seen) => {
    if (typeof item === 'string') return mapString(item);
    // a copy of a replaced card: the drawn card in its place (its zones keep the original objects, which are the drawn cards already)
    if (item !== null && typeof item === 'object' && !Array.isArray(item) && typeof item.uid === 'string' && byUid.has(item.uid) && typeof item.id === 'string') return { ...byUid.get(item.uid).fresh };
    return visit(item, seen);
  };

  visit(state, new Set());
}
