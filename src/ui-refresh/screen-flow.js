// Entry flow (V092-08): which screen follows which, DOM-free. The screens are not in the URL or
// the browser history (Q14): they move only by their own buttons and Escape.
export const SCREENS = Object.freeze(['entry', 'tutorial-select', 'battle-setup', 'online-entry', 'online-join', 'online-room', 'game']);

const MOVES = Object.freeze({
  entry: Object.freeze({ 'open-tutorials': 'tutorial-select', 'open-battle': 'battle-setup', start: 'game' }),
  'tutorial-select': Object.freeze({ back: 'entry', start: 'game' }),
  'battle-setup': Object.freeze({ back: 'entry', start: 'game', 'open-online': 'online-entry' }),
  // Online play (design §14.1): the door (name, deck, make a room), the code to join one, and the room until both are ready.
  'online-entry': Object.freeze({ back: 'battle-setup', 'open-join': 'online-join', room: 'online-room' }),
  'online-join': Object.freeze({ back: 'online-entry', room: 'online-room' }),
  'online-room': Object.freeze({ back: 'online-entry', start: 'game' }),
  // A finished tutorial comes back to the list to show its mark (Q4); a finished match's end screen goes back to the
  // match menu (文豪, 2026-11-01); everything else leaves to the title.
  game: Object.freeze({ leave: 'entry', 'tutorial-complete': 'tutorial-select', 'match-menu': 'battle-setup' })
});

// The next screen, or null when the event does not move this screen (an unknown screen moves nowhere).
export function nextScreen(screen, event) {
  const moves = Object.hasOwn(MOVES, screen) ? MOVES[screen] : null;
  return moves && Object.hasOwn(moves, event) ? moves[event] : null;
}

// Escape goes back only from a screen that has a way back and only with nothing open over it.
export const escapeScreen = (screen, { overlayOpen = false } = {}) => overlayOpen ? null : nextScreen(screen, 'back');

// Screens drawn by the shell between the title and a match.
export const isFlowScreen = screen => ['tutorial-select', 'battle-setup', 'online-entry', 'online-join', 'online-room'].includes(screen);
