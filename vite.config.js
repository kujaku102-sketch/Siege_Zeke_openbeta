import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: { main: "index.html", pc: "pc/index.html", mobile: "mobile/index.html" } }
  }
});
