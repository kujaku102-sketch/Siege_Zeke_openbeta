// Each tutorial's win board (scripts/build-tutorial-boards.mjs), read only when [スキップ] needs it.
const BOARDS = Object.freeze({
  basics: () => import('./basics.json'),
  blue: () => import('./blue.json'),
  yellow: () => import('./yellow.json'),
  vengeance: () => import('./vengeance.json'),
  black: () => import('./black.json')
});

export const TUTORIAL_WIN_CHECKPOINT = 'win';

export async function loadTutorialWinBoard(tutorialId) {
  const load = Object.hasOwn(BOARDS, tutorialId) ? BOARDS[tutorialId] : null;
  if (!load) return { ok: false, error: { code: 'TUTORIAL_CHECKPOINT_UNKNOWN' } };
  try { return { ok: true, value: (await load()).default }; }
  catch { return { ok: false, error: { code: 'TUTORIAL_CHECKPOINT_UNAVAILABLE' } }; }
}
