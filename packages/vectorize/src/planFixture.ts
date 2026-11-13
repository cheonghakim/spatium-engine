import type { RawImage } from "./binarize.js";

/**
 * A synthetic but realistic floor plan raster: thick filled walls, door gaps
 * with a thin leaf + swing arc, a window drawn as thin triple lines, furniture
 * outlines, text-like strokes and dimension lines — the clutter that real
 * plans carry and that must not turn into walls.
 */
export function syntheticPlan({ withStairs = false } = {}): {
  image: RawImage;
  metersPerPixel: number;
} {
  const width = 800,
    height = 600;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (x: number, y: number) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 30;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ink(x, y);
  };
  const clear = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 255;
      }
  };
  const hline = (x0: number, x1: number, y: number, t = 1) => rect(x0, y, x1, y + t);
  const vline = (x: number, y0: number, y1: number, t = 1) => rect(x, y0, x + t, y1);
  const outline = (x0: number, y0: number, x1: number, y1: number, t = 2) => {
    hline(x0, x1, y0, t);
    hline(x0, x1, y1 - t, t);
    vline(x0, y0, y1, t);
    vline(x1 - t, y0, y1, t);
  };
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
    for (let a = a0; a <= a1; a += 0.5 / r) ink(cx + r * Math.cos(a), cy + r * Math.sin(a));
  };

  // Exterior walls (12 px ≈ 0.24 m) around 100..700 × 100..500.
  outline(100, 100, 700, 500, 12);
  // Interior walls (8 px).
  vline(400, 100, 500, 8); // splits left/right
  hline(100, 400, 300, 8); // splits left half top/bottom
  hline(400, 700, 260, 8); // right half
  // Door gaps (45 px ≈ 0.9 m) with leaf + swing arc.
  clear(400, 160, 408, 205);
  vline(408, 160, 205, 2);
  arc(408, 160, 45, 0, Math.PI / 2);
  clear(200, 300, 245, 308);
  hline(200, 245, 308, 2);
  arc(200, 308, 45, 0, Math.PI / 2);
  clear(520, 260, 565, 268);
  hline(520, 565, 268, 2);
  arc(520, 268, 45, 0, Math.PI / 2);
  // Window in the top exterior wall: three thin lines in a gap.
  clear(220, 100, 300, 112);
  hline(220, 300, 100, 1);
  hline(220, 300, 105, 1);
  hline(220, 300, 111, 1);
  vline(220, 100, 112, 1);
  vline(299, 100, 112, 1);
  // Furniture: bed, table, sofa, kitchen counter (thin outlines).
  outline(130, 140, 230, 250, 2);
  hline(130, 230, 170, 2);
  outline(480, 330, 600, 400, 2);
  outline(130, 380, 300, 430, 2);
  outline(430, 120, 560, 150, 2);
  vline(470, 120, 150, 2);
  vline(510, 120, 150, 2);
  // Text-like strokes inside rooms.
  for (let k = 0; k < 6; k++) {
    vline(260 + k * 9, 200, 212, 2);
    hline(258 + k * 9, 266 + k * 9, 206, 2);
  }
  for (let k = 0; k < 5; k++) {
    vline(560 + k * 9, 440, 452, 2);
    hline(558 + k * 9, 566 + k * 9, 452, 2);
  }
  // A staircase in the bottom-right room: 8 thin treads, 1.2 m wide, 0.24 m apart.
  if (withStairs) for (let k = 0; k < 8; k++) hline(620, 680, 300 + k * 12, 2);
  // Dimension lines outside the building with ticks.
  hline(100, 700, 60, 1);
  for (const x of [100, 400, 700]) vline(x, 52, 68, 1);
  vline(740, 100, 500, 1);
  for (const y of [100, 300, 500]) hline(732, 748, y, 1);
  hline(100, 400, 545, 1);
  for (const x of [100, 400]) vline(x, 537, 553, 1);

  return { image: { data, width, height }, metersPerPixel: 0.02 };
}

/**
 * A plan drawn the way most architectural drawings and their scans are:
 * every wall is two thin parallel lines (its two faces) with end caps at
 * openings, plus dimension lines with ticks (one running just inside a room),
 * furniture and text — on a grey, noisy, slightly blurred background.
 */
export function doubleLinePlan(): { image: RawImage; metersPerPixel: number } {
  const width = 900,
    height = 620;
  const gray = new Float32Array(width * height).fill(178);
  const ink = (x: number, y: number) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && y >= 0 && x < width && y < height) gray[y * width + x] = 55;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ink(x, y);
  };
  const hline = (x0: number, x1: number, y: number, t = 2) => rect(x0, y, x1, y + t);
  const vline = (x: number, y0: number, y1: number, t = 2) => rect(x, y0, x + t, y1);
  /** A wall along a centre line, as two face lines `gap` apart, open where `openings` say. */
  const wall = (
    orientation: "h" | "v",
    offset: number,
    from: number,
    to: number,
    gap: number,
    openings: Array<[number, number]> = [],
  ) => {
    const cuts = [...openings].sort((a, b) => a[0] - b[0]);
    let cursor = from;
    const pieces: Array<[number, number]> = [];
    for (const [a, b] of cuts) {
      pieces.push([cursor, a]);
      cursor = b;
    }
    pieces.push([cursor, to]);
    for (const [a, b] of pieces) {
      for (const face of [offset - gap / 2, offset + gap / 2 - 2]) {
        if (orientation === "h") hline(a, b, face);
        else vline(face, a, b);
      }
    }
    // End caps at each opening.
    for (const [a, b] of cuts)
      for (const at of [a, b - 2]) {
        if (orientation === "h") vline(at, offset - gap / 2, offset + gap / 2);
        else hline(offset - gap / 2, offset + gap / 2, at);
      }
  };
  // Exterior (16 px ≈ 0.32 m) and interior (10 px ≈ 0.2 m) walls; faces overlap at corners.
  wall("h", 100, 92, 808, 16, [[250, 330]]); // window gap in the top wall
  wall("h", 500, 92, 808, 16);
  wall("v", 100, 92, 508, 16);
  wall("v", 800, 92, 508, 16);
  wall("v", 450, 108, 492, 10, [[170, 215]]); // door
  wall("h", 300, 108, 450, 10, [[220, 265]]); // door
  wall("h", 270, 450, 792, 10, [[560, 605]]); // door
  // Dimension lines with ticks: outside, and one running just inside the top-left room.
  hline(100, 800, 55, 1);
  for (const x of [100, 450, 800]) vline(x, 47, 63, 1);
  hline(140, 420, 140, 2);
  for (const x of [140, 420]) vline(x, 128, 152, 2);
  vline(850, 100, 500, 1);
  // Furniture outlines and text-like strokes.
  for (const [x0, y0, x1, y1] of [
    [140, 180, 250, 270],
    [520, 330, 650, 410],
    [140, 400, 320, 450],
  ]) {
    hline(x0!, x1!, y0!);
    hline(x0!, x1!, y1!);
    vline(x0!, y0!, y1!);
    vline(x1!, y0!, y1! + 2);
  }
  for (let k = 0; k < 6; k++) {
    vline(300 + k * 9, 210, 222);
    hline(298 + k * 9, 306 + k * 9, 216);
  }

  // Scan look: 3×3 blur, then deterministic noise.
  const blurred = new Float32Array(gray.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0,
        n = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < width && yy < height) {
            sum += gray[yy * width + xx]!;
            n++;
          }
        }
      blurred[y * width + x] = sum / n;
    }
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const v = blurred[i]! + random() * 14;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { image: { data, width, height }, metersPerPixel: 0.02 };
}

/** Box-resamples a grey image by `factor` (down- or upscaling, like a scan at another DPI). */
export function rescale(image: RawImage, factor: number): RawImage {
  const width = Math.floor(image.width * factor),
    height = Math.floor(image.height * factor);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const y0 = Math.floor(y / factor),
        y1 = Math.max(y0 + 1, Math.floor((y + 1) / factor));
      const x0 = Math.floor(x / factor),
        x1 = Math.max(x0 + 1, Math.floor((x + 1) / factor));
      let sum = 0,
        n = 0;
      for (let yy = y0; yy < Math.min(image.height, y1); yy++)
        for (let xx = x0; xx < Math.min(image.width, x1); xx++) {
          sum += image.data[(yy * image.width + xx) * 4]!;
          n++;
        }
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = n ? sum / n : 255;
      data[i + 3] = 255;
    }
  return { data, width, height };
}

/** Adds deterministic ±`amplitude` speckle, like a grainy scan or phone photo. */
export function addNoise(image: RawImage, amplitude: number): RawImage {
  let seed = 3;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const data = new Uint8ClampedArray(image.data);
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i]! + random() * amplitude;
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  return { ...image, data };
}
