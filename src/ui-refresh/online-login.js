// The page around the Discord login (design: サーバー設計-Discordログイン.md §2, §14.2): the way out to Discord and the way
// back. Discord sends the browser to /discord-callback.html (public/), which hands the answer to the page that asked:
// that page's own address (kept here for the trip) with the answer's fields added. This page then finishes the login and
// takes the fields out of its address again (the screens themselves never go in the address or the history, Q14).
export const RETURN_KEY = "sz-discord-return";   // session: { path, search }, only for the trip to Discord and back
const ANSWER = ["code", "state", "error", "error_description", "iss"];

// The address without the answer's fields.
export function withoutAnswer(search) {
  const params = new URLSearchParams(search ?? "");
  for (const key of ANSWER) params.delete(key);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}

// On [Discordでログイン]: keeps where to come back to, then sends the page to Discord. -> login.start()'s answer
// ({ ok: false, error } when the page stays).
export async function startDiscordLogin(login, { session, location = globalThis.location } = {}) {
  try { session?.setItem(RETURN_KEY, JSON.stringify({ path: location.pathname, search: withoutAnswer(location.search) })); } catch { /* back to the top page */ }
  const result = await login.start();
  if (!result.ok) { try { session?.removeItem(RETURN_KEY); } catch { /* nothing kept */ } }
  return result;
}

// On a page opened by the way back: takes the answer out of the address and finishes the login. -> null when this page
// is not a way back, else finish()'s answer ({ ok: true, profile } or { ok: false, error }).
export async function finishDiscordLogin(login, { location = globalThis.location, history = globalThis.history } = {}) {
  const search = location.search;
  if (!login.isCallback(search)) return null;
  try { history.replaceState(history.state, "", `${location.pathname}${withoutAnswer(search)}${location.hash}`); } catch { /* the address keeps it */ }
  return login.finish(search);
}

// What a failed login says; the player can still type a name and play.
const ERROR_TEXT = Object.freeze({
  SERVER_MISCONFIGURED: "Discordでのログインは準備中です。",
  ONLINE_UNAVAILABLE: "オンライン対戦のサーバーが設定されていません。",
  SERVER_UNREACHABLE: "サーバーにつながりません。",
  RATE_LIMITED: "操作が多すぎます。少し待ってから試してください。",
  DISCORD_UNREACHABLE: "Discordにつながりません。しばらくしてから試してください。",
  DISCORD_DENIED: "Discordでのログインが取り消されました。",
  AUTH_STATE_EXPIRED: "時間がたちすぎました。もう一度ログインしてください。",
  STORAGE_UNAVAILABLE: "このブラウザではログインを保存できません。",
  LOGIN_EXPIRED: "Discordのログインの期限が切れました。もう一度ログインしてください。"
});
export const loginErrorText = code => code ? `${ERROR_TEXT[code] ?? "Discordでログインできませんでした。"}名前を入れて遊ぶこともできます。` : "";
