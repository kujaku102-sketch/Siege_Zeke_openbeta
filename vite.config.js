import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    // The HUD sprite sheets (V092-10) stay separate hashed files under assets/ even though they are
    // small: they are runtime images that verify-public-build checks, not data URLs inside a bundle.
    assetsInlineLimit: file => /[\\/]assets[\\/]ui-sprites[\\/]/.test(file) ? false : undefined,
    rollupOptions: { input: { main: "index.html", pc: "pc/index.html", mobile: "mobile/index.html" } }
  }
});
