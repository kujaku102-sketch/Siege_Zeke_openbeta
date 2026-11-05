// The match modes a runtime session can start in.
// 'ai': one user against the CPU. 'versus': two users against each other (the online match). Both are played matches:
// the same rules, the same opening, a result. 'tutorial', 'lab' and 'sandbox' are not (no concession, no forfeit).
export const MATCH_MODES = Object.freeze(['ai', 'versus']);
export const RUNTIME_MODES = Object.freeze([...MATCH_MODES, 'tutorial', 'lab', 'sandbox']);
