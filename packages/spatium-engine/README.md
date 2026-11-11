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

| Import                   | Contains                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `spatium-engine`         | Domain types, geometry/math helpers, project validation, GeoJSON/JSON serialization, and the navigation graph + A\* pathfinding. No dependencies.                                                                        |
| `spatium-engine/runtime` | A read-only playback engine — 2D canvas renderer and 3D (Three.js) renderer — for viewing a finished map. Needs `three`.                                                                                                 |
| `spatium-engine/builder` | A declarative event → condition → action layer on top of the runtime (camera moves, route playback, popups, markers) for wiring up interactions without touching map geometry. Needs `three` too (it wraps the runtime). |

## Usage

```html
<!-- The runtime fills its container: give it a size. -->
<div id="map" style="width: 100%; height: 480px"></div>
```

```ts
import { deserializeProject, diagnoseRoute, type RouteEndpoint } from "spatium-engine";
import { IndoorRuntime, type RouteOptions } from "spatium-engine/runtime";

// A project file exported from Spatium Studio ("프로젝트 JSON").
// deserializeProject validates it and upgrades older schema versions.
const project = deserializeProject(await (await fetch("/maps/campus.map.json")).text());

const runtime = new IndoorRuntime({ container: "#map" });
await runtime.load(project);

runtime.on("space.click", ({ space }) => console.log(space.properties.name));

// Search by name (any language, Korean initials too), external id or room code.
// Results are POIs or spaces — turn either into a route endpoint.
const [hit] = runtime.search("coffee");
if (!hit) {
  console.log("nothing found");
} else {
  const destination: RouteEndpoint = hit.kind === "poi" ? { poiId: hit.id } : { spaceId: hit.id };
  // Endpoints: a node id, { poiId }, { spaceId } or { floorId, position }.
  const here: RouteEndpoint = {
    floorId: project.buildings[0]!.floors[0]!.id,
    position: { x: 2, y: 3 },
  };
  const options: RouteOptions = { requireAccessible: true };

  const route = runtime.startRoute(here, destination, options);
  if (route) {
    console.log(`${Math.round(route.cost)} s, ${route.distance.toFixed(0)} m`); // cost = seconds
  } else {
    // "start-unreachable" | "end-unreachable" | "blocked-by-options" | "disconnected"
    console.log("no route:", diagnoseRoute(project, here, destination, options));
  }
}

// When your component unmounts:
runtime.destroy(); // safe to call more than once
```

- The runtime keeps a reference to the project. If you change it in place, call
  `runtime.invalidate()`; or pass a new object to `load()`.
- `deserializeProject` throws `SchemaVersionMismatchError` for files saved by a newer
  version (update the package) and `InvalidProjectDataError` for malformed data.

### What works where

| Feature                                                  | 2D                          | 3D                          | Builder (`spatium-engine/builder`)        |
| -------------------------------------------------------- | --------------------------- | --------------------------- | ----------------------------------------- |
| Spaces (with holes), walls, doors, POIs                  | ✓                           | ✓                           | via runtime                               |
| Furniture                                                | dot                         | ✓ (presets, GLB)            | via runtime                               |
| Search (`runtime.search`)                                | ✓                           | ✓                           | —                                         |
| Routes: node / POI / space / position endpoints, options | ✓                           | ✓                           | ✓ `route.start` (`from`, `to`, `options`) |
| Route playback animation                                 | —                           | ✓ (current floor's segment) | ✓                                         |
| Overlays                                                 | `marker`, `circle`, `label` | `marker`                    | ✓                                         |
| Campus (site) outdoor paths                              | routing only, not drawn yet | routing only                | —                                         |

Overlay types not listed for a renderer are drawn as a plain marker and the runtime emits
`overlay.fallback` (see `OVERLAY_SUPPORT`).

## License

[MIT](https://github.com/cheonghakim/spatium-engine/blob/main/LICENSE)
