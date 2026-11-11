// The place where a CPU that reads ahead (beatZIG) gets the states it tries moves on. Trusted code: it reads the real match, so no CPU file may import it (tests/cpu-lookahead.test.js).
// It is loaded only when a CPU that needs it is chosen (catalog.js), and handed to the match session, which holds the match: session.lookahead(seatId)(lookaheadHost).
//
//   lookaheadHost.open({ authority, seat, deckLimit }) -> decision        (host.js)
import { open } from './host.js';

export const lookaheadHost = Object.freeze({ open });
