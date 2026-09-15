import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilding, createEmptyProject, createEntrance, createFloor, createPOI, createSpace } from "../../core/src/index.js";
import type { BuilderConfig } from "../../builder/src/index.js";
import { VanillaJsExporter } from "../src/VanillaJsExporter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "..", "..", "apps", "exported-demo");

const project = createEmptyProject("Exported Demo Mall");
const building = createBuilding("Main Building");
const floor = createFloor("1F", 1);
const lobby = createSpace(
  floor.id,
  [
    { x: -6, y: -4 },
    { x: 6, y: -4 },
    { x: 6, y: 4 },
    { x: -6, y: 4 },
  ],
  "lobby",
);
lobby.properties.name = "Main Lobby";
floor.spaces.push(lobby);
floor.entrances.push(createEntrance(floor.id, { x: 0, y: -4 }, "door"));
floor.pois.push(createPOI(floor.id, { x: 3, y: 2 }, "store", "Gift Shop"));
building.floors.push(floor);
project.buildings.push(building);

const config: BuilderConfig = {
  camera: { mode: "2d", pan: true, zoom: true, rotate: true },
  controls: { floorSelector: true, cameraToggle: true },
  events: [
    {
      event: "poi.click",
      actions: [{ type: "poi.focus" }],
    },
  ],
};

const result = await new VanillaJsExporter().export({ project, config });

for (const file of result.files) {
  const fullPath = join(outDir, file.path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, file.contents, "utf-8");
}

console.log(`Wrote ${result.files.length} files to ${outDir}`);
