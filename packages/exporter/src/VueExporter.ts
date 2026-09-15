import type { ExportInput, ExportedFile, ExportResult, ExportTarget, MapExporter } from "./MapExporter.js";
import { buildDataFiles, buildReadme } from "./sharedFiles.js";
import { escapeHtml } from "./VanillaJsExporter.js";
import { slugify } from "./slugify.js";

/**
 * Vue 3 export target (spec §30-31). Vue only hosts the container element —
 * the actual map is the same @indoor/builder IndoorBuilder used everywhere
 * else, created in onMounted and destroyed in onUnmounted.
 */
export class VueExporter implements MapExporter {
  readonly target: ExportTarget = "vue";

  async export(input: ExportInput): Promise<ExportResult> {
    const name = slugify(input.project.name);
    const files: ExportedFile[] = [
      ...buildDataFiles(input),
      { path: "index.html", contents: buildIndexHtml(input.project.name) },
      { path: "package.json", contents: buildPackageJson(name) },
      { path: "vite.config.js", contents: VITE_CONFIG },
      { path: "src/map.js", contents: MAP_JS },
      { path: "src/events.js", contents: EVENTS_JS },
      { path: "src/App.vue", contents: APP_VUE },
      { path: "src/main.js", contents: MAIN_JS },
      { path: "README.md", contents: buildReadme(name) },
    ];
    return { files };
  }
}

function buildIndexHtml(projectName: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(projectName)}</title>
    <style>
      html, body, #app { margin: 0; height: 100%; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`;
}

function buildPackageJson(name: string): string {
  return (
    JSON.stringify(
      {
        name,
        private: true,
        version: "0.0.0",
        type: "module",
        scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
        dependencies: {
          "@indoor/core": "workspace:*",
          "@indoor/runtime": "workspace:*",
          "@indoor/builder": "workspace:*",
          vue: "^3.5.0",
        },
        devDependencies: { vite: "^5.4.0", "@vitejs/plugin-vue": "^5.1.0" },
      },
      null,
      2,
    ) + "\n"
  );
}

const VITE_CONFIG = `import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({ plugins: [vue()] });
`;

const MAP_JS = `import { IndoorBuilder } from "@indoor/builder";
import project from "../assets/map.json";
import config from "../config/map.config.json";

export function createIndoorMap(containerElement) {
  return new IndoorBuilder({ container: containerElement, project, config });
}
`;

const EVENTS_JS = `// Customize event handling here, e.g.:
// builder.runtime.on("poi.click", ({ poi }) => console.log(poi));
export function registerEvents(builder) {
  void builder;
}
`;

const APP_VUE = `<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import { createIndoorMap } from "./map.js";
import { registerEvents } from "./events.js";

const mapEl = ref(null);
let builder = null;

onMounted(() => {
  builder = createIndoorMap(mapEl.value);
  registerEvents(builder);
});

onBeforeUnmount(() => {
  builder?.runtime.destroy();
});
</script>

<template>
  <div ref="mapEl" style="width: 100%; height: 100%"></div>
</template>
`;

const MAIN_JS = `import { createApp } from "vue";
import App from "./App.vue";

createApp(App).mount("#app");
`;
