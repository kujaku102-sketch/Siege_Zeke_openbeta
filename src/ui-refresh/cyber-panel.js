// The battle log's look, shared by the other match panels: an eyebrow, a title with
// a cursor, and a cut-corner close button. Callers escape the title themselves.
export function panelHeadHtml({ eyebrow, sub, title, close, closeLabel = '閉じる' }) {
  return `<header class="cp-head"><div><small>${eyebrow} <i>//</i> ${sub}</small><h2>${title}</h2></div><button class="cp-close" ${close} aria-label="${closeLabel}">×</button></header>`;
}

// How to play, moved here from the old info button, which now shows pile counts.
export function controlsHelpHtml() {
  return '<details class="cp-help"><summary>操作説明</summary><p>カードを選び、表示された操作を選択。配置先・攻撃対象を選んで確定します。</p><p>カード詳細は長押し。空き盤面を押すとカード選択を解除します。</p><p>盤面をドラッグして移動。ピンチ・拡大縮小ボタンで表示を調整できます(新UIのみ)。</p><p>手札は引き上げて開き、下スワイプで畳みます。領域ボタンからゴミ箱・レジストリ・BANを自分／相手別に確認できます。</p><p>i ボタンを押している間、山札・ゴミ箱・レジストリ・BANの枚数が各領域の上に出ます。</p><p>「戻る」は確定前の選択のみ取り消します。必須の効果選択は省略できません。</p></details>';
}
