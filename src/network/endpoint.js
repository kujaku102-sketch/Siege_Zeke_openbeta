// Where the online server is (design: サーバー設計-詳細.md §13). Pure.
//
// ONLINE_ENDPOINT is empty until the server is deployed: with no address the game keeps showing online play as "not ready".
// A page served from this PC can point itself at a local server with ?online=http://127.0.0.1:8801 (wrangler dev);
// the same query on any other page is ignored, so a shared link cannot send players to someone else's server.
export const ONLINE_ENDPOINT = '';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// -> the base address without a trailing slash, or null when online play is not configured.
export function onlineEndpoint({ hostname = '', search = '', configured = ONLINE_ENDPOINT } = {}) {
  if (LOCAL_HOSTS.has(hostname)) {
    const asked = new URLSearchParams(search).get('online');
    if (asked) {
      try {
        const url = new URL(asked);
        if (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname) || url.protocol === 'https:') return url.origin;
      } catch { /* not an address: fall through */ }
    }
  }
  if (typeof configured !== 'string' || configured === '') return null;
  try {
    const url = new URL(configured);
    return url.protocol === 'https:' || url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname) ? url.origin : null;
  } catch { return null; }
}

export const isOnlineAvailable = options => onlineEndpoint(options) !== null;

// http(s)://host -> ws(s)://host/rooms/CODE/ws
export function roomSocketUrl(endpoint, code) {
  const url = new URL(`/rooms/${encodeURIComponent(code)}/ws`, endpoint);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export const roomsUrl = endpoint => new URL('/rooms', endpoint).toString();

// step: 'start' | 'exchange'
export const discordAuthUrl = (endpoint, step) => new URL(`/auth/discord/${step}`, endpoint).toString();
