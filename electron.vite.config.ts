import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const aliases = {
  "@domain": resolve("src/domain"),
  "@application": resolve("src/application"),
  "@infrastructure": resolve("src/infrastructure"),
  "@shared": resolve("src/shared"),
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: aliases },
    build: { rollupOptions: { input: resolve("src/main/index.ts") } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: aliases },
    build: {
      rollupOptions: {
        input: resolve("src/preload/index.ts"),
        output: { format: "cjs", entryFileNames: "index.cjs" },
      },
    },
  },
  renderer: {
    root: resolve("src/renderer"),
    resolve: { alias: aliases },
    plugins: [react()],
    server: { host: "127.0.0.1", port: 43173, strictPort: true },
  },
});
