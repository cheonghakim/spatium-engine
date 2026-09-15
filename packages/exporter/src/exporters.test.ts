import { createBuilding, createEmptyProject, createFloor, createSpace, deserializeProject } from "@indoor/core";
import type { BuilderConfig } from "@indoor/builder";
import { describe, expect, it } from "vitest";
import { JsonExporter } from "./JsonExporter.js";
import { VanillaJsExporter } from "./VanillaJsExporter.js";
import { VueExporter } from "./VueExporter.js";
import { exportProject } from "./index.js";

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
  it("produces a runnable Vite project referencing @indoor/builder", async () => {
    const { project, config } = makeInput();
    const result = await new VanillaJsExporter().export({ project, config });
    const paths = result.files.map((f) => f.path);

    expect(paths).toEqual(
      expect.arrayContaining([
        "assets/map.json",
        "config/map.config.json",
        "index.html",
        "package.json",
        "src/map.js",
        "src/events.js",
        "src/main.js",
        "README.md",
      ]),
    );

    const pkg = JSON.parse(findFile(result.files, "package.json").contents);
    expect(pkg.name).toBe("my-cool-mall");
    expect(pkg.dependencies["@indoor/builder"]).toBe("workspace:*");

    expect(findFile(result.files, "src/map.js").contents).toContain("IndoorBuilder");
    expect(findFile(result.files, "index.html").contents).toContain("My Cool Mall!");

    const restored = deserializeProject(findFile(result.files, "assets/map.json").contents);
    expect(restored).toEqual(project);
  });
});

describe("VueExporter", () => {
  it("produces a Vue project with an App.vue that mounts the builder", async () => {
    const { project, config } = makeInput();
    const result = await new VueExporter().export({ project, config });
    const paths = result.files.map((f) => f.path);

    expect(paths).toEqual(expect.arrayContaining(["src/App.vue", "src/main.js", "package.json"]));

    const pkg = JSON.parse(findFile(result.files, "package.json").contents);
    expect(pkg.dependencies.vue).toBeDefined();
    expect(findFile(result.files, "src/App.vue").contents).toContain("createIndoorMap");
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
});
