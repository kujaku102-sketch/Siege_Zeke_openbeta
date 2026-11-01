import { defineConfig } from "vite";

export default defineConfig({
  // The engine trace (src/game/engine-trace.js) is for development and tests: every call sits behind `TRACE && tracing()`. A product build fixes TRACE to false,
  // so the trace code is dropped by the build, not by the fact that nothing sets a sink. verify-public-build.mjs checks the built files hold none of it.
  define: { __SZ_TRACE__: false },
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
