/// <reference types="node" />
import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import electron from "vite-plugin-electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: path.join(__dirname, "electron/no-renderer.ts"),
    },
  },
  plugins: [
    electron({
      main: {
        entry: "electron/main.ts",
      },
      preload: {
        input: path.join(__dirname, "electron/preload.ts"),
      },
    }),
  ],
  server: {
    allowedHosts: true,
  },
});
