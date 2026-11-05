// The browser's own token: a random 32-character value kept in storage. A room keeps only its SHA-256, and a Discord
// ticket (discord-auth.js) is signed against that same hash, so the token ties a seat and a login to one browser.
export const TOKEN_KEY = 'sz-online-token';

const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const TOKEN = /^[0-9a-f]{32}$/;

export const isGuestToken = value => typeof value === 'string' && TOKEN.test(value);

// The saved token, or a new one saved now. When storage is blocked the token lasts for this page only.
export function guestToken(storage, randomBytes = bytes => crypto.getRandomValues(new Uint8Array(bytes))) {
  try {
    const saved = storage?.getItem(TOKEN_KEY);
    if (isGuestToken(saved)) return saved;
  } catch { /* storage may be blocked */ }
  const made = hex(randomBytes(16));
  try { storage?.setItem(TOKEN_KEY, made); } catch { /* the token then lasts for this page only */ }
  return made;
}
