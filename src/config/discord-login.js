// The Discord login (design: サーバー設計-Discordログイン.md §10, 文豪 「推奨OK」). Off until the privacy page (Q8) and the
// server's keys are in place, so no public page shows the button (文豪, 2026-11-05). Turn it on here, in this one place.
export const DISCORD_LOGIN_ENABLED = false;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Whether the page offers the login. A page served from this PC may turn it on for a local test with ?discord=1, as
// ?online= points it at a local server (endpoint.js); the same query anywhere else is ignored.
export function discordLoginShown({ hostname = '', search = '', enabled = DISCORD_LOGIN_ENABLED } = {}) {
  if (enabled === true) return true;
  return LOCAL_HOSTS.has(hostname) && new URLSearchParams(search).get('discord') === '1';
}
