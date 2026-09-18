import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(({ command }) => ({
  // Served from https://cheonghakim.github.io/spatium-engine/ (a project
  // Pages site, not the repo root) — only the production build needs the
  // subpath; the dev server should keep serving from "/".
  base: command === "build" ? "/spatium-engine/" : "/",
  plugins: [vue()],
  server: {
    port: 5173,
  },
}));
