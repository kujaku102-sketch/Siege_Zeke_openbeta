// The optional local display fonts (README: マキナス4 and 廻想体, never committed or shipped by this repository). Only the
// files present when the site is built are registered: the glob is resolved by Vite at build time, so a missing file is
// never requested, and its family falls back to the next one each rule names (文豪, 2026-11-04, 5). A registered face
// loads when text first uses it, as an @font-face would. Vite only: node tests never import this file.
const FACES = Object.freeze({
  'Kaisotai-Next-UP-B.woff2': { family: 'SZKaiso', format: 'woff2' },
  'Makinas-4-Flat.otf': { family: 'SZMakinas', format: 'opentype' }
});
const files = import.meta.glob('../assets/fonts-local/{Kaisotai-Next-UP-B.woff2,Makinas-4-Flat.otf}', { eager: true, query: '?url', import: 'default' });

export function registerLocalFonts(fonts = globalThis.document?.fonts) {
  if (!fonts || typeof FontFace !== 'function') return;
  for (const [path, url] of Object.entries(files)) {
    const face = FACES[path.slice(path.lastIndexOf('/') + 1)];
    if (face) fonts.add(new FontFace(face.family, `url("${url}") format("${face.format}")`, { weight: '400', display: 'swap' }));
  }
}
