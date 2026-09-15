export interface RawImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface GrayscaleImage {
  width: number;
  height: number;
  /** 0-255 intensity, row-major, one byte per pixel. */
  pixels: Uint8ClampedArray;
}

/** Composites RGBA against a white background, then converts to luminance. */
export function toGrayscale(image: RawImage): GrayscaleImage {
  const { data, width, height } = image;
  const pixels = new Uint8ClampedArray(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4] ?? 255;
    const g = data[i * 4 + 1] ?? 255;
    const b = data[i * 4 + 2] ?? 255;
    const a = (data[i * 4 + 3] ?? 255) / 255;
    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
    pixels[i] = luminance * a + 255 * (1 - a);
  }
  return { width, height, pixels };
}

export interface BinaryImage {
  width: number;
  height: number;
  /** 1 = "ink" (a dark line, e.g. a wall stroke), 0 = background. Row-major. */
  ink: Uint8Array;
}

/** Pixels darker than `threshold` (0-255) are treated as ink. */
export function binarize(gray: GrayscaleImage, threshold = 128): BinaryImage {
  const ink = new Uint8Array(gray.width * gray.height);
  for (let i = 0; i < ink.length; i++) {
    ink[i] = (gray.pixels[i] ?? 255) < threshold ? 1 : 0;
  }
  return { width: gray.width, height: gray.height, ink };
}

/** Otsu threshold, derived from the source rather than its display opacity. */
export function automaticThreshold(gray: GrayscaleImage): number {
  const histogram = new Float64Array(256);
  let sum = 0;
  for (const value of gray.pixels) { histogram[value] = histogram[value]! + 1; sum += value; }
  let count = 0, partial = 0, best = -1, threshold = 128;
  for (let i = 0; i < 255; i++) {
    count += histogram[i]!; partial += histogram[i]! * i;
    const remaining = gray.pixels.length - count;
    if (!count || !remaining) continue;
    const difference = partial / count - (sum - partial) / remaining;
    const score = count * remaining * difference * difference;
    if (score > best) { best = score; threshold = i + 1; }
  }
  return best < 0 ? (gray.pixels[0] ?? 128) : threshold;
}
