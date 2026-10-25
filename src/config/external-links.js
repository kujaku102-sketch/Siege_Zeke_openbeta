// Title links (V092-08 Q10–Q12). The addresses are not decided yet: an empty value means
// "not set", and the title shows the link as 準備中 that cannot be followed. Put the real
// https address here when it is decided; never a placeholder.
export const EXTERNAL_LINKS = Object.freeze({ download: '', discord: '' });

// Only an absolute https address is a link; anything else reads as not set.
export function externalHref(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && url.hostname ? url.href : null;
  } catch {
    return null;
  }
}

// Where the page runs (Q11). 0.9.2 has no desktop client yet, so this is always 'web';
// the desktop check goes here once its build is specified.
export const runtimeTarget = () => 'web';

// The title links in order. The download link is for the web build only.
export function titleLinks(links = EXTERNAL_LINKS, target = runtimeTarget()) {
  return [
    ...(target === 'web' ? [{ key: 'download', label: 'クライアントをダウンロード', href: externalHref(links.download) }] : []),
    { key: 'discord', label: 'Discord', href: externalHref(links.discord) }
  ];
}
