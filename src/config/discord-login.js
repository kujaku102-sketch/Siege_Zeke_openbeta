// The Discord login (design: サーバー設計-Discordログイン.md §10, 文豪 「推奨OK」). On from the first trial on real devices
// (文豪, 2026-11-06: 「最初の実機から Discord 込みで」), with the privacy page (public/privacy.html, Q8) and the site's CSP for
// the online server and Discord's pictures. Turning it off here hides the button and its setting everywhere.
export const DISCORD_LOGIN_ENABLED = true;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Whether the page offers the login. While it is off, a page served from this PC may still turn it on for a local test
// with ?discord=1, as ?online= points it at a local server (endpoint.js); the same query anywhere else is ignored.
export function discordLoginShown({ hostname = '', search = '', enabled = DISCORD_LOGIN_ENABLED } = {}) {
  if (enabled === true) return true;
  return LOCAL_HOSTS.has(hostname) && new URLSearchParams(search).get('discord') === '1';
}
