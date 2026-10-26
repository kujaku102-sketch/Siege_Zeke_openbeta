// The tutorial list (V092-08 Q3): the two existing tutorials as items, in one place. They are shown as
// chapters (provisional names); the subtitle is the in-match select's label, and the summaries only
// name what the existing steps already teach. The ids stay the tutorial ids, so saved marks still match.
export const TUTORIAL_ITEMS = Object.freeze([
  Object.freeze({ id: 'basics', title: 'チャプター1', subtitle: '基本操作・赤', summary: '赤デッキで、インストール・実行・攻撃から、実行先選択、QA、セキュリティ、マウント、任意追加効果まで。' }),
  Object.freeze({ id: 'vengeance', title: 'チャプター2', subtitle: 'ヴェンジェンス・紫', summary: '紫デッキで、Obの移動とレイヤード。インストール、レイヤード、リログ、効果起動（アップデート）まで。' })
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
