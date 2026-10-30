export function std224InstallCard({ state, playerId, card }) {
  state.prompt = { type: "plugin-number", playerId, pluginUid: card.uid, message: `P-in（${card.name}）：監視するメモリ値を指定`, detail: "0～7から選択" };
}
