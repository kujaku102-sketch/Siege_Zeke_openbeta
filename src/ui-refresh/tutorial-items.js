// The tutorial list (V092-08 Q3): the existing tutorials as items, in one place. They are shown as
// chapters; the subtitle is the in-match select's label, and the summaries only name what the existing
// steps already teach. The ids stay the tutorial ids, so saved marks still match.
//
// Chapter numbers are not written down (文豪, 2026-10-26): the tutorials that exist are listed in this
// color order and numbered 1, 2, 3… with no gaps, so a new color renumbers the ones after it.
export const TUTORIAL_ORDER = Object.freeze(['basics', 'blue', 'green', 'yellow', 'vengeance', 'black', 'orange']);

export function numberTutorialItems(entries, order = TUTORIAL_ORDER) {
  const rank = id => { const index = order.indexOf(id); return index < 0 ? order.length : index; };
  return Object.freeze([...entries].sort((a, b) => rank(a.id) - rank(b.id))
    .map((entry, index) => Object.freeze({ id: entry.id, title: `チャプター${index + 1}`, subtitle: entry.subtitle, summary: entry.summary })));
}

export const TUTORIAL_ITEMS = numberTutorialItems([
  { id: 'basics', subtitle: '基本操作・赤', summary: '赤デッキで、インストール・実行・攻撃から、実行先選択、QA、セキュリティ、マウント、任意追加効果まで。' },
  { id: 'blue', subtitle: 'ハッキング・暗号化・青', summary: '青デッキで、シンボルのインストール、ログイン効果のアクセス、Spで得るハッキング、セキュリティ、暗号化まで。' },
  { id: 'vengeance', subtitle: 'ヴェンジェンス・紫', summary: '紫デッキで、Obの移動とレイヤード。インストール、レイヤード、リログ、効果起動（アップデート）まで。' }
]);
export const TUTORIAL_IDS = Object.freeze(TUTORIAL_ITEMS.map(item => item.id));

// Finished tutorials are kept in this browser only (Q5) and never sent. A broken, foreign or
// unreadable value reads as nothing finished; a save that fails leaves the item unfinished.
export const TUTORIAL_DONE_KEY = 'sz-tutorial-done';

export function readTutorialDone(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(TUTORIAL_DONE_KEY) ?? '[]');
    return Array.isArray(parsed) ? TUTORIAL_IDS.filter(id => parsed.includes(id)) : [];
  } catch {
    return [];
  }
}

export function markTutorialDone(storage, id) {
  const done = readTutorialDone(storage);
  if (!TUTORIAL_IDS.includes(id) || done.includes(id)) return done;
  const next = TUTORIAL_IDS.filter(known => known === id || done.includes(known));
  try {
    storage.setItem(TUTORIAL_DONE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return done;
  }
}
