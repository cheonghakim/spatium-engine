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
  for (const value of gray.pixels) {
    histogram[value] = histogram[value]! + 1;
    sum += value;
  }
  let count = 0,
    partial = 0,
    best = -1,
    threshold = 128;
  for (let i = 0; i < 255; i++) {
    count += histogram[i]!;
    partial += histogram[i]! * i;
    const remaining = gray.pixels.length - count;
    if (!count || !remaining) continue;
    const difference = partial / count - (sum - partial) / remaining;
    const score = count * remaining * difference * difference;
    if (score > best) {
      best = score;
      threshold = i + 1;
    }
  }
  return best < 0 ? (gray.pixels[0] ?? 128) : threshold;
}

function median(values: Uint8ClampedArray | Float64Array | number[]): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1]! : 0;
}

/** Sample every `step`th pixel — plenty for robust statistics, far cheaper on big scans. */
function sampleStep(gray: GrayscaleImage): number {
  return Math.max(1, Math.floor((gray.width * gray.height) / 200_000));
}

/**
 * Background noise level (≈ standard deviation) of a scan or photo, from the
 * median absolute difference between horizontal neighbours. Ink is sparse on
 * a plan, so the median reflects the paper, not the lines; a clean digital
 * drawing scores ~0.
 */
export function estimateNoise(gray: GrayscaleImage): number {
  const { width, height, pixels } = gray;
  const step = sampleStep(gray);
  const diffs: number[] = [];
  for (let i = 0; i < width * height - 1; i += step) {
    if ((i + 1) % width === 0) continue;
    diffs.push(Math.abs(pixels[i]! - pixels[i + 1]!));
  }
  // MAD → σ for Gaussian noise; the difference of two samples has √2·σ spread.
  return (1.4826 * median(diffs)) / Math.SQRT2;
}

/** 3×3 mean filter. */
function boxBlur(gray: GrayscaleImage): GrayscaleImage {
  const { width, height, pixels } = gray;
  const out = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0,
        n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          sum += pixels[yy * width + xx]!;
          n++;
        }
      }
      out[y * width + x] = sum / n;
    }
  return { width, height, pixels: out };
}

/** Above this noise level (σ, 0–255) a scan is smoothed before thresholding. */
const NOISY_SCAN_SIGMA = 12;

/**
 * Speckled scans and phone photos: smooth just enough that paper grain stops
 * passing for ink. Clean drawings are returned untouched, so 1-px lines survive.
 */
export function denoise(gray: GrayscaleImage): GrayscaleImage {
  let current = gray;
  // Up to two passes for very noisy inputs.
  for (let pass = 0; pass < 2 && estimateNoise(current) > NOISY_SCAN_SIGMA; pass++)
    current = boxBlur(current);
  return current;
}

/**
 * Otsu, guarded for plans: when ink is sparse and the paper is noisy, Otsu can
 * split the paper's own brightness range and turn half the background into
 * ink. The threshold is therefore kept at least 4σ below the paper level.
 */
export function robustThreshold(gray: GrayscaleImage): number {
  const otsu = automaticThreshold(gray);
  const step = sampleStep(gray);
  const sample: number[] = [];
  for (let i = 0; i < gray.pixels.length; i += step) sample.push(gray.pixels[i]!);
  const paper = median(sample);
  const sigma = estimateNoise(gray);
  return Math.max(1, Math.min(otsu, Math.round(paper - 4 * Math.max(sigma, 1))));
}
