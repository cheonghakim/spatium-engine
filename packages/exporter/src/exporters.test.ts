import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createBuilding,
  createEmptyProject,
  createFloor,
  createSpace,
  deserializeProject,
} from "@indoor/core";
import type { BuilderConfig } from "@indoor/builder";
import { build as esbuildBuild } from "esbuild";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it } from "vitest";
import { JsonExporter } from "./JsonExporter.js";
import { VanillaJsExporter } from "./VanillaJsExporter.js";
import { VueExporter } from "./VueExporter.js";
import { exportProject } from "./index.js";
import type { ExportedFile } from "./MapExporter.js";

function makeInput() {
  const project = createEmptyProject("My Cool Mall!");
  const building = createBuilding("B1");
  const floor = createFloor("1F", 1);
  floor.spaces.push(
    createSpace(floor.id, [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]),
  );
  building.floors.push(floor);
  project.buildings.push(building);

  const config: BuilderConfig = {
    camera: { mode: "2d", pan: true, zoom: true, rotate: true },
    controls: { floorSelector: true, cameraToggle: true },
    events: [],
  };

  return { project, config };
}

function findFile(files: { path: string; contents: string }[], path: string) {
  const file = files.find((f) => f.path === path);
  if (!file) throw new Error(`Expected export to contain "${path}"`);
  return file;
}

/** Writes an exporter's in-memory ExportedFile[] output to a real temp directory on disk. */
function writeFilesToTempDir(files: ExportedFile[]): string {
  const dir = mkdtempSync(join(tmpdir(), "indoor-export-"));
  for (const file of files) {
    const fullPath = join(dir, file.path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.contents);
  }
  return dir;
}

describe("JsonExporter", () => {
  it("exports map.json and app.config.json with round-trippable project data", async () => {
    const { project, config } = makeInput();
    const result = await new JsonExporter().export({ project, config });

    expect(result.files.map((f) => f.path).sort()).toEqual(["app.config.json", "map.json"]);
    const restored = deserializeProject(findFile(result.files, "map.json").contents);
    expect(restored).toEqual(project);
    expect(JSON.parse(findFile(result.files, "app.config.json").contents)).toEqual(config);
  });
});

describe("VanillaJsExporter", () => {
  it("produces a runnable Vite project vendoring @indoor/builder (no workspace:* deps)", async () => {
    const { project, config } = makeInput();
    const result = await new VanillaJsExporter().export({ project, config });
    const paths = result.files.map((f) => f.path);

    expect(paths).toEqual(
      expect.arrayContaining([
        "assets/map.json",
        "config/map.config.json",
        "index.html",
        "package.json",
        "vendor/indoor.bundle.js",
        "src/map.js",
        "src/events.js",
        "src/main.js",
        "README.md",
      ]),
    );

    const pkg = JSON.parse(findFile(result.files, "package.json").contents);
    expect(pkg.name).toBe("my-cool-mall");
    // The exported app must be installable with a plain `npm install` outside
    // this monorepo, so it must not depend on any unpublished `workspace:*`
    // @indoor/* package.
    expect(pkg.dependencies).toEqual({});
    expect(Object.keys(pkg.devDependencies)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^@indoor\//)]),
    );

    const vendorBundle = findFile(result.files, "vendor/indoor.bundle.js").contents;
    expect(vendorBundle.length).toBeGreaterThan(1000);
    expect(vendorBundle).not.toContain("workspace:");

    expect(findFile(result.files, "src/map.js").contents).toContain(
      'import { IndoorBuilder } from "../vendor/indoor.bundle.js"',
    );
    expect(findFile(result.files, "index.html").contents).toContain("My Cool Mall!");

    const restored = deserializeProject(findFile(result.files, "assets/map.json").contents);
    expect(restored).toEqual(project);
  });

  it("surfaces validation issues without failing the export", async () => {
    const { project, config } = makeInput();
    const result = await new VanillaJsExporter().export({ project, config });
    expect(Array.isArray(result.validationIssues)).toBe(true);
  });
});

describe("VueExporter", () => {
  it("produces a Vue project with an App.vue that mounts the builder", async () => {
    const { project, config } = makeInput();
    const result = await new VueExporter().export({ project, config });
    const paths = result.files.map((f) => f.path);

    expect(paths).toEqual(
      expect.arrayContaining([
        "src/App.vue",
        "src/main.js",
        "package.json",
        "vendor/indoor.bundle.js",
      ]),
    );

    const pkg = JSON.parse(findFile(result.files, "package.json").contents);
    expect(pkg.dependencies).toEqual({ vue: "^3.5.0" });
    expect(findFile(result.files, "src/App.vue").contents).toContain("createIndoorMap");
    expect(findFile(result.files, "src/map.js").contents).toContain(
      'import { IndoorBuilder } from "../vendor/indoor.bundle.js"',
    );
  });
});

describe("exportProject dispatcher", () => {
  it("routes to the exporter matching the target", async () => {
    const { project, config } = makeInput();
    const jsonResult = await exportProject("json", { project, config });
    expect(jsonResult.files.map((f) => f.path)).toContain("map.json");

    const vueResult = await exportProject("vue", { project, config });
    expect(vueResult.files.map((f) => f.path)).toContain("src/App.vue");
  });

  it("throws a clear error for an unknown target instead of a TypeError", async () => {
    const { project, config } = makeInput();
    // Cast past the type system the way untyped/external input (an HTTP body,
    // a CLI flag) would arrive — TypeScript can't narrow that for us.
    await expect(exportProject("pdf" as unknown as "json", { project, config })).rejects.toThrow(
      'Unknown export target: "pdf"',
    );
  });
});

/**
 * Structural smoke test (distinct from the round-trip tests above, which
 * only check that map.json/config deserialize correctly): writes each
 * exporter's real output to disk and esbuild-bundles the generated entry
 * points from there, the same way the exported app's own `vite build` would
 * resolve imports. This is what would actually catch a broken/typo'd import
 * in a generated template, including the new vendor/indoor.bundle.js path.
 */
describe("generated app smoke test (esbuild)", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("bundles the vanilla-js export's src/main.js without errors", async () => {
    const { project, config } = makeInput();
    const result = await new VanillaJsExporter().export({ project, config });
    const dir = writeFilesToTempDir(result.files);
    tempDirs.push(dir);

    const bundled = await esbuildBuild({
      entryPoints: [join(dir, "src/main.js")],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2020",
      external: ["vite"],
    });

    const [output] = bundled.outputFiles;
    if (!output) throw new Error("Expected esbuild to produce output");
    // Bundling a minified vendor file renames the `IndoorBuilder` binding
    // itself, so assert on the unminified glue code we control instead.
    expect(output.text).toContain("createIndoorMap");
    expect(output.text).toContain("container: containerSelector");
  });

  it("bundles the vue export's src/main.js without errors", async () => {
    const { project, config } = makeInput();
    const result = await new VueExporter().export({ project, config });
    const dir = writeFilesToTempDir(result.files);
    tempDirs.push(dir);

    // main.js's own syntax + its imports of "vue" and "./App.vue" resolving.
    // The .vue SFC itself isn't compiled here (no Vue plugin, no network) —
    // it's loaded as opaque text, which is enough to catch a missing/typo'd
    // file without needing a real Vue SFC compiler for a smoke test.
    const mainBundled = await esbuildBuild({
      entryPoints: [join(dir, "src/main.js")],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2020",
      external: ["vite", "vue"],
      loader: { ".vue": "text" },
    });
    expect(mainBundled.outputFiles).toHaveLength(1);

    // Separately, exercise App.vue's actual <script setup> imports — that's
    // where "./map.js" (and transitively vendor/indoor.bundle.js) and
    // "./events.js" are really referenced.
    const appVue = findFile(result.files, "src/App.vue").contents;
    const scriptMatch = /<script setup>([\s\S]*?)<\/script>/.exec(appVue);
    const scriptContent = scriptMatch?.[1];
    if (!scriptContent) throw new Error("Expected App.vue to contain a <script setup> block");
    const scriptPath = join(dir, "src/__app-script-check.js");
    writeFileSync(scriptPath, scriptContent);

    const scriptBundled = await esbuildBuild({
      entryPoints: [scriptPath],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2020",
      external: ["vue"],
    });
    const [scriptOutput] = scriptBundled.outputFiles;
    if (!scriptOutput) throw new Error("Expected esbuild to produce output");
    expect(scriptOutput.text).toContain("createIndoorMap");
    expect(scriptOutput.text).toContain("onMounted");
  });
});

/**
 * Execution smoke test (distinct from the bundling smoke test above, which
 * only proves imports resolve): actually runs the vanilla-js export's
 * bundled src/main.js against a real DOM. MAIN_JS calls createIndoorMap() at
 * module top level, which constructs a real IndoorBuilder -> IndoorRuntime
 * against a real `#map` element, so this is what would catch the generated
 * app throwing at startup instead of just failing to resolve.
 *
 * This file otherwise runs under vitest's default "node" environment, which
 * the esbuild-bundling tests above require: esbuild's native encoder relies
 * on the process's real global TextEncoder/Uint8Array, and switching the
 * whole file to a DOM-flavored test environment replaces those globals and
 * breaks esbuild with "Invariant violation: ... instanceof Uint8Array" for
 * every test in the file, not just this one. (Note: even mentioning that
 * environment's name in a comment as a literal "at"-prefixed directive would
 * trip vitest's file-wide docblock scanner and cause exactly this breakage —
 * which is why this comment deliberately avoids spelling it that way.) So
 * instead of switching the file's test environment, this test builds its own
 * DOM document directly via the `jsdom` package (the same one
 * packages/runtime/src/test-setup.ts and vitest's own DOM environment are
 * built on) and installs only `document`/`window` onto the global object for
 * the duration of the test, leaving Node's native TextEncoder/Uint8Array
 * alone so esbuild keeps working elsewhere in this file.
 */
describe("generated app execution smoke test (jsdom)", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs the vanilla-js export's bundled src/main.js and mounts a canvas into #map", async () => {
    const { project, config } = makeInput();
    const result = await new VanillaJsExporter().export({ project, config });
    const dir = writeFilesToTempDir(result.files);
    tempDirs.push(dir);

    const bundled = await esbuildBuild({
      entryPoints: [join(dir, "src/main.js")],
      bundle: true,
      write: false,
      format: "esm",
      platform: "browser",
      target: "es2020",
      external: ["vite"],
    });
    const [output] = bundled.outputFiles;
    if (!output) throw new Error("Expected esbuild to produce output");

    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    const { window } = dom;
    // jsdom doesn't implement canvas rendering; stub getContext to return
    // null quietly instead of jsdom logging a "Not implemented" error for
    // the canvas IndoorRuntime creates. Mirrors packages/runtime's
    // src/test-setup.ts: IndoorRuntime already treats a null 2D context as
    // "skip drawing," so this doesn't change what's under test.
    window.HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof window.HTMLCanvasElement.prototype.getContext;
    window.document.body.innerHTML = '<div id="map"></div>';

    const previousDocument = (globalThis as Record<string, unknown>).document;
    const previousWindow = (globalThis as Record<string, unknown>).window;
    (globalThis as Record<string, unknown>).document = window.document;
    (globalThis as Record<string, unknown>).window = window;

    try {
      // Write the bundle to a real file and dynamic-import it rather than
      // eval()/new Function() it, so it actually executes as real ESM
      // (module scoping, real syntax errors, etc.) the way a browser loading
      // the generated app's built output would. createIndoorMap("#map") runs
      // at module top level (MAIN_JS), so simply resolving this import
      // without throwing is the assertion that the generated app's startup
      // code actually runs.
      const bundlePath = join(dir, "bundled-main.mjs");
      writeFileSync(bundlePath, output.text);
      await import(pathToFileURL(bundlePath).href);

      // IndoorRuntime's constructor synchronously appends its 2D canvas to
      // the container it's given — confirm that really happened, not just
      // that nothing threw.
      const canvas = window.document.querySelector("#map canvas");
      expect(canvas).not.toBeNull();
    } finally {
      (globalThis as Record<string, unknown>).document = previousDocument;
      (globalThis as Record<string, unknown>).window = previousWindow;
      window.close();
    }
  });
});
