// STD-224 effects: the card's own handlers (they call the engine library, so they live apart from the data file the tables are built from)

// handlers (was effects/custom/std_224.js)
export function std224InstallCard({ state, playerId, card }) {
  state.prompt = { type: "plugin-number", playerId, pluginUid: card.uid, message: `P-in（${card.name}）：監視するメモリ値を指定`, detail: "0～7から選択" };
}
