// Scores the vectorizer on real drawings. See README.md in this folder.
//   pnpm --filter @indoor/vectorize run eval [-- --predictions <dir>] [--json]
/* global process, performance, console */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateVectorization,
  planAnalysisResolution,
  truthFromFloor,
  vectorizeAtWorkingResolution,
} from "../dist/index.js";
import { decodePng, encodePng } from "./png.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
const casesDir = resolve(flag("--cases") ?? join(here, "cases"));
const predictionsDir = flag("--predictions") && resolve(flag("--predictions"));
const asJson = args.includes("--json");
const method = flag("--method");
const withOverlay = args.includes("--overlay");

/** Area-average downscale to the working resolution, as the Studio's canvas does for large scans. */
function downscale(image, width, height) {
  if (width === image.width && height === image.height) return image;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * image.height) / height),
      y1 = Math.max(y0 + 1, Math.floor(((y + 1) * image.height) / height));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * image.width) / width),
        x1 = Math.max(x0 + 1, Math.floor(((x + 1) * image.width) / width));
      const sum = [0, 0, 0, 0];
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++)
          for (let k = 0; k < 4; k++) sum[k] += image.data[(yy * image.width + xx) * 4 + k];
      const n = (y1 - y0) * (x1 - x0);
      for (let k = 0; k < 4; k++) data[(y * width + x) * 4 + k] = sum[k] / n;
    }
  }
  return { data, width, height };
}

/** The drawing, faded, with the result on top: rooms tinted, walls red, stairs green, openings blue. */
function drawOverlay(image, prediction, toPixel) {
  const { width, height } = image;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++)
    for (let k = 0; k < 3; k++) rgb[i * 3 + k] = 255 - (255 - image.data[i * 4 + k]) * 0.35;
  const blend = (x, y, color, alpha) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    for (let k = 0; k < 3; k++) {
      const i = (y * width + x) * 3 + k;
      rgb[i] = rgb[i] * (1 - alpha) + color[k] * alpha;
    }
  };
  const line = (a, b, color, radius) => {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)) + 1;
    for (let s = 0; s <= steps; s++)
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++)
          blend(
            a.x + ((b.x - a.x) * s) / steps + dx,
            a.y + ((b.y - a.y) * s) / steps + dy,
            color,
            1,
          );
  };
  const tints = [
    [80, 160, 255],
    [255, 190, 60],
    [120, 210, 120],
    [220, 130, 230],
    [90, 210, 210],
  ];
  prediction.spaces.forEach((space, index) => {
    const rings = [space.polygon, ...(space.holes ?? [])].map((ring) => ring.map(toPixel));
    const ys = rings[0].map((p) => p.y);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      const crossings = [];
      for (const points of rings)
        points.forEach((a, i) => {
          const b = points[(i + 1) % points.length];
          if (a.y > y + 0.5 !== b.y > y + 0.5)
            crossings.push(a.x + ((y + 0.5 - a.y) / (b.y - a.y)) * (b.x - a.x));
        });
      crossings.sort((p, q) => p - q);
      for (let i = 0; i + 1 < crossings.length; i += 2)
        for (let x = Math.ceil(crossings[i]); x <= crossings[i + 1]; x++)
          blend(x, y, tints[index % tints.length], 0.35);
    }
  });
  for (const space of prediction.spaces)
    for (const ring of [space.polygon, ...(space.holes ?? [])])
      ring.forEach((p, i) =>
        line(toPixel(p), toPixel(ring[(i + 1) % ring.length]), [40, 60, 170], 0),
      );
  const elements = prediction.elements ?? [];
  const treads = new Set(
    elements.flatMap((e) => (e.type === "stairs" ? (e.replacesWallIndices ?? []) : [])),
  );
  prediction.walls.forEach((wall, i) =>
    line(toPixel(wall.start), toPixel(wall.end), treads.has(i) ? [0, 150, 0] : [225, 30, 30], 1),
  );
  for (const element of elements) {
    const p = toPixel(element.position);
    const color = element.type === "stairs" ? [0, 150, 0] : [30, 60, 230];
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) blend(p.x + dx, p.y + dy, color, 1);
  }
  return encodePng(rgb, width, height);
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** A Studio project export (one floor of it) or a bare `{ walls, spaces, entrances }`. */
function loadTruth(path, spec) {
  const json = readJson(path);
  if (!json.buildings) return truthFromFloor(json);
  const floors = json.buildings.flatMap((b) => b.floors);
  const floor =
    typeof spec.floor === "string"
      ? floors.find((f) => f.id === spec.floor || f.name === spec.floor)
      : floors[spec.floor ?? 0];
  if (!floor) throw new Error(`층을 찾을 수 없습니다: ${spec.floor}`);
  return truthFromFloor(floor);
}

function runCase(name) {
  const dir = join(casesDir, name);
  const spec = readJson(join(dir, "case.json"));
  if (!(spec.metersPerPixel > 0)) throw new Error("case.json에 metersPerPixel이 필요합니다");
  const source = decodePng(readFileSync(join(dir, spec.image ?? "plan.png")));
  const truthPath = join(dir, spec.truth ?? "truth.json");
  const truth = existsSync(truthPath) ? loadTruth(truthPath, spec) : null;
  const m = spec.metersPerPixel;
  // Same frame as the Studio's reference image (ReferenceManager.imagePixelToWorld).
  const origin = spec.origin ?? { x: (-source.width * m) / 2, y: (source.height * m) / 2 };

  let prediction, ms;
  if (predictionsDir) {
    prediction = readJson(join(predictionsDir, `${name}.json`));
  } else {
    const plan = planAnalysisResolution(source.width, source.height);
    if (!plan.ok) throw new Error(plan.message);
    const started = performance.now();
    prediction = vectorizeAtWorkingResolution(
      {
        image: downscale(source, plan.width, plan.height),
        transform: { origin, xAxis: { x: m, y: 0 }, yAxis: { x: 0, y: -m } },
        scaleX: plan.scaleX,
        scaleY: plan.scaleY,
        sourceWidth: source.width,
        sourceHeight: source.height,
      },
      { ...(method ? { method } : {}), ...(spec.options ?? {}) },
    );
    ms = Math.round(performance.now() - started);
  }
  if (withOverlay)
    writeFileSync(
      join(dir, "result.png"),
      drawOverlay(source, prediction, (p) => ({
        x: (p.x - origin.x) / m,
        y: (origin.y - p.y) / m,
      })),
    );
  const elements = prediction.elements ?? [];
  return {
    name,
    ms,
    score: truth && evaluateVectorization(prediction, truth, spec.evaluation ?? {}),
    found: {
      walls: prediction.walls.length,
      spaces: prediction.spaces.length,
      stairs: elements.filter((e) => e.type === "stairs").length,
      openings: elements.filter((e) => e.type !== "stairs").length,
    },
    warnings: (prediction.warnings ?? []).map((w) => w.message),
  };
}

const names = existsSync(casesDir)
  ? readdirSync(casesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(casesDir, entry.name, "case.json")))
      .map((entry) => entry.name)
      .sort()
  : [];
if (!names.length) {
  console.error(`평가할 도면이 없습니다: ${casesDir}\n추가 방법은 eval/README.md를 보세요.`);
  process.exit(1);
}

const results = [];
let failed = false;
for (const name of names) {
  try {
    results.push(runCase(name));
  } catch (error) {
    failed = true;
    console.error(`${name}: ${error.message}`);
  }
}

if (asJson) {
  console.log(JSON.stringify(results, null, 2));
} else {
  const percent = (value) => (value === null ? "-" : `${Math.round(value * 100)}%`);
  const count = (c) =>
    `${c.matched}/${c.truth}${c.predicted > c.matched ? ` (+${c.predicted - c.matched})` : ""}`;
  console.table(
    Object.fromEntries(
      results.map(({ name, ms, score, found }) => [
        name,
        score
          ? {
              "벽 검출": percent(score.walls.recall),
              "벽 정확": percent(score.walls.precision),
              "바닥 검출": percent(score.floor.recall),
              "바닥 정확": percent(score.floor.precision),
              방: count(score.rooms),
              계단: count(score.stairs),
              "문·창": count(score.openings),
              ...(ms === undefined ? {} : { ms }),
            }
          : {
              "벽 검출": "정답 없음",
              방: `(+${found.spaces})`,
              계단: `(+${found.stairs})`,
              "문·창": `(+${found.openings})`,
              ...(ms === undefined ? {} : { ms }),
            },
      ]),
    ),
  );
  console.log(
    "검출 = 정답 중 찾은 비율(낮으면 누락), 정확 = 결과 중 맞는 비율(낮으면 오검출). 방·계단·문·창 = 찾은 수/정답 수 (+정답에 없는 후보 수).",
  );
}
process.exit(failed ? 1 : 0);
