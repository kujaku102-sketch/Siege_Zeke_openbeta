import { createGame } from "../game/engine.js";
import { createCardInstance } from "../data/cards.js";

// Isolated trial state: never fed back to the running game or written to storage.
export function createPreviewFixture() {
  const state = createGame({ mode: "ai", rng: () => 0.5 });
  state.interactive = true;
  let serial = 50000;
  const cards = (owner, ids) => ids.map(id => createCardInstance(id, owner, ++serial));
  state.players.player.hand = cards("player", ["STD-020", "STD-022", "STD-015", "STD-008", "STD-001", "STD-023", "STD-010", "STD-021", "STD-024", "STD-011", "STD-017", "STD-002"]);
  state.players.player.front = cards("player", ["STD-020", "STD-022"]);
  state.players.player.back = cards("player", ["STD-008"]);
  state.players.player.registry = cards("player", ["STD-015", "STD-023"]);
  state.players.player.trash = cards("player", ["STD-010"]);
  state.players.ai.front = cards("ai", ["STD-021", "STD-023"]);
  state.players.ai.front[0].sleep = true;
  // Attack-only trigger: placement trials must not silently skip an optional
  // opponent response while the response UI is still disconnected.
  state.players.ai.back = cards("ai", ["STD-002"]);
  state.players.ai.back[0].faceDown = true;
  state.players.ai.registry = cards("ai", ["STD-022"]);
  return state;
}
