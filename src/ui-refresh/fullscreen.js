// Call directly from a user click: fullscreen requires transient activation.
export const isFullscreen = doc => Boolean(doc.fullscreenElement);
export async function toggleFullscreen(doc) {
  try {
    if (isFullscreen(doc)) {
      await doc.exitFullscreen();
      return { ok: true };
    }
    if (doc.fullscreenEnabled === false || typeof doc.documentElement.requestFullscreen !== "function") {
      return { ok: false, message: "このブラウザは全画面操作に非対応です。対応ブラウザで開いてください。通知バーの表示は端末側の仕様によります。" };
    }
    await doc.documentElement.requestFullscreen({ navigationUI: "hide" });
    return { ok: true };
  } catch {
    return { ok: false, message: "全画面に切り替えられませんでした。ブラウザや端末の制限を確認してください。対戦はそのまま続けられます。" };
  }
}
