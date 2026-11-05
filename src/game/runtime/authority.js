import { createCommandJournal } from './command-record.js';
import { buildRuntimeReferenceFrame } from './reference-frame.js';
import { createRuntimeReferenceState, planRuntimeReferenceCreation } from './references.js';
import { createRuntimeReferenceTokens } from './reference-token.js';
import { createRuntimeSession } from './session.js';

const failure = code => ({ ok: false, error: { code } });

// A fresh match's whole authority: engine, card references and an empty journal.
// This is the entry a server imports: it reaches nothing outside src/game and src/data (no UI, no tutorial data).
export function createMatchAuthority(runtimeConfig) {
  const session = createRuntimeSession(runtimeConfig);
  if (!session.ok) return session;
  const frame = buildRuntimeReferenceFrame(session.value.engineState);
  if (!frame.ok) return frame;
  const planned = planRuntimeReferenceCreation(frame.value);
  if (!planned.ok) return planned;
  const tokens = createRuntimeReferenceTokens({ count: planned.value.newRefCount, issuedRefs: [] });
  if (!tokens.ok) return tokens;
  const references = createRuntimeReferenceState({ frame: frame.value, newRefs: tokens.value });
  if (!references.ok) return references;
  const journal = createCommandJournal({
    matchId: session.value.metadata.matchId, seatIds: session.value.metadata.seatIds
  });
  if (!journal.ok) return journal;
  return { ok: true, value: { ...session.value, referenceState: references.value, journal: journal.value } };
}
