# spatium-engine

A TypeScript toolkit for building, viewing, and embedding indoor maps — buildings, floors, rooms, walls, doors, points of interest, and navigation/routing graphs.

- 🔗 [Live demo](https://cheonghakim.github.io/spatium-engine)
- 📦 [Source](https://github.com/cheonghakim/spatium-engine)

This package bundles the core project model and a read-only viewer runtime. It's published from the [spatium-engine](https://github.com/cheonghakim/spatium-engine) monorepo, which also contains the map-authoring editor (Studio) and other internal tooling not included here.

## Install

```bash
npm install spatium-engine
```

`spatium-engine` on its own (the default import) has no dependencies. `spatium-engine/runtime` and `spatium-engine/builder` render a 3D view with [Three.js](https://threejs.org), so they list `three` as an optional peer dependency — install it yourself if you use either:

```bash
npm install spatium-engine three
```

## Entry points

| Import | Contains |
| --- | --- |
| `spatium-engine` | Domain types, geometry/math helpers, project validation, GeoJSON/JSON serialization, and the navigation graph + A\* pathfinding. No dependencies. |
| `spatium-engine/runtime` | A read-only playback engine — 2D canvas renderer and 3D (Three.js) renderer — for viewing a finished map. Needs `three`. |
| `spatium-engine/builder` | A declarative event → condition → action layer on top of the runtime (camera moves, route playback, popups, markers) for wiring up interactions without touching map geometry. Needs `three` too (it wraps the runtime). |

## Usage

```ts
import { IndoorRuntime } from "spatium-engine/runtime";
import type { Project } from "spatium-engine";

const runtime = new IndoorRuntime({ container: "#map" });

runtime.on("space.click", ({ space }) => console.log(space.properties.name));

const project: Project = /* load or build a project with spatium-engine's factories/serialization */;

await runtime.load(project);
runtime.start();
```

## License

[MIT](https://github.com/cheonghakim/spatium-engine/blob/main/LICENSE)
