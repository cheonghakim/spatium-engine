import type { BinaryImage } from "./binarize.js";

export interface PixelSegment {
  orientation: "horizontal" | "vertical";
  offset: number;
  start: number;
  end: number;
}

/** Bridge small scan defects, but require at least 80% actual ink. */
function scan(image: BinaryImage, minLength: number, maxGap: number, orientation: PixelSegment['orientation']): PixelSegment[] {
  const result: PixelSegment[] = [];
  const horizontal = orientation === 'horizontal';
  const length = horizontal ? image.width : image.height;
  const rows = horizontal ? image.height : image.width;
  for (let offset = 0; offset < rows; offset++) {
    let start = -1, last = -1, support = 0;
    const flush = () => {
      if (start >= 0 && last - start + 1 >= minLength && support / (last - start + 1) >= 0.8) {
        result.push({ orientation, offset, start, end: last });
      }
      start = -1; support = 0;
    };
    for (let position = 0; position <= length; position++) {
      const index = horizontal ? offset * image.width + position : position * image.width + offset;
      if (position < length && image.ink[index] === 1) {
        if (start < 0) start = position;
        last = position; support++;
      } else if (start >= 0 && (position === length || position - last > maxGap)) flush();
    }
  }
  return result;
}

export function detectHorizontalSegments(image: BinaryImage, minLength: number, maxGap = 0): PixelSegment[] {
  return scan(image, minLength, maxGap, 'horizontal');
}
export function detectVerticalSegments(image: BinaryImage, minLength: number, maxGap = 0): PixelSegment[] {
  return scan(image, minLength, maxGap, 'vertical');
}

/** Keep multiple active strokes per row so interleaved walls merge independently. */
export function mergeParallelSegments(segments: PixelSegment[], maxGapPx: number, orientation: PixelSegment['orientation']): Array<PixelSegment & { thicknessPx: number }> {
  type Bucket = { min: number; max: number; start: number; end: number };
  const active: Bucket[] = [];
  const merged: Array<PixelSegment & { thicknessPx: number }> = [];
  const flush = (b: Bucket) => merged.push({ orientation, offset: (b.min + b.max) / 2, start: b.start, end: b.end, thicknessPx: b.max - b.min + 1 });
  for (const seg of [...segments].sort((a,b) => a.offset - b.offset || a.start - b.start)) {
    for (let i = active.length - 1; i >= 0; i--) {
      if (seg.offset - active[i]!.max > maxGapPx) flush(active.splice(i, 1)[0]!);
    }
    let best: Bucket | undefined;
    let bestOverlap = 0;
    for (const b of active) {
      if (seg.offset === b.max) continue;
      const overlap = Math.min(seg.end, b.end) - Math.max(seg.start, b.start) + 1;
      const ratio = overlap / Math.min(seg.end - seg.start + 1, b.end - b.start + 1);
      if (ratio >= 0.6 && overlap > bestOverlap) { best = b; bestOverlap = overlap; }
    }
    if (best) {
      best.max = seg.offset;
      best.start = Math.min(best.start, seg.start);
      best.end = Math.max(best.end, seg.end);
    } else active.push({ min: seg.offset, max: seg.offset, start: seg.start, end: seg.end });
  }
  active.forEach(flush);
  return merged;
}
