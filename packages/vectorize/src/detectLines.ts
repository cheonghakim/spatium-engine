import type { BinaryImage } from "./binarize.js";

export interface PixelSegment {
  orientation: "horizontal" | "vertical";
  offset: number;
  start: number;
  end: number;
}

/** Bridge small scan defects, but require at least 80% actual ink. */
function scan(
  image: BinaryImage,
  minLength: number,
  maxGap: number,
  orientation: PixelSegment["orientation"],
): PixelSegment[] {
  const result: PixelSegment[] = [];
  const horizontal = orientation === "horizontal";
  const length = horizontal ? image.width : image.height;
  const rows = horizontal ? image.height : image.width;
  for (let offset = 0; offset < rows; offset++) {
    let start = -1,
      last = -1,
      support = 0;
    const flush = () => {
      if (start >= 0 && last - start + 1 >= minLength && support / (last - start + 1) >= 0.8) {
        result.push({ orientation, offset, start, end: last });
      }
      start = -1;
      support = 0;
    };
    for (let position = 0; position <= length; position++) {
      const index = horizontal ? offset * image.width + position : position * image.width + offset;
      if (position < length && image.ink[index] === 1) {
        if (start < 0) start = position;
        last = position;
        support++;
      } else if (start >= 0 && (position === length || position - last > maxGap)) flush();
    }
  }
  return result;
}

export function detectHorizontalSegments(
  image: BinaryImage,
  minLength: number,
  maxGap = 0,
): PixelSegment[] {
  return scan(image, minLength, maxGap, "horizontal");
}
export function detectVerticalSegments(
  image: BinaryImage,
  minLength: number,
  maxGap = 0,
): PixelSegment[] {
  return scan(image, minLength, maxGap, "vertical");
}

/** Keep multiple active strokes per row so interleaved walls merge independently. */
export function mergeParallelSegments(
  segments: PixelSegment[],
  maxGapPx: number,
  orientation: PixelSegment["orientation"],
): Array<PixelSegment & { thicknessPx: number }> {
  type Bucket = {
    min: number;
    max: number;
    start: number;
    end: number;
    runs: Array<{ offset: number; start: number; end: number }>;
  };
  const active: Bucket[] = [];
  const merged: Array<PixelSegment & { thicknessPx: number }> = [];
  const flush = (b: Bucket) => {
    const base = { orientation, offset: (b.min + b.max) / 2, thicknessPx: b.max - b.min + 1 };
    // Thick strokes: keep only the stretch where most rows have ink. One stray
    // row (a door leaf or swing drawn touching the wall) must not bridge a gap
    // that every other row of the wall leaves open.
    if (b.runs.length <= 2) {
      merged.push({ ...base, start: b.start, end: b.end });
      return;
    }
    const need = Math.ceil(b.runs.length / 2);
    const n = b.end - b.start + 1;
    const delta = new Int32Array(n + 1);
    for (const run of b.runs) {
      delta[run.start - b.start]!++;
      delta[run.end - b.start + 1]!--;
    }
    // covered[i]: most rows have ink at column i. gaps: prefix count of uncovered columns.
    const covered = new Uint8Array(n),
      gaps = new Int32Array(n + 1);
    for (let i = 0, count = 0; i < n; i++) {
      count += delta[i]!;
      covered[i] = count >= need ? 1 : 0;
      gaps[i + 1] = gaps[i]! + (covered[i] ? 0 : 1);
    }
    // A row that runs through an open gap is a stray (leaf/swing touching the
    // wall): it must not shift the centre line of the stretches either side.
    const stray = (r: { start: number; end: number }) =>
      gaps[r.end - b.start + 1]! - gaps[r.start - b.start]! > 0;
    const emit = (start: number, end: number) => {
      const covering = b.runs.filter(
        (r) => Math.min(r.end, end) - Math.max(r.start, start) + 1 >= (end - start + 1) / 2,
      );
      const solid = covering.filter((r) => !stray(r));
      const rows = (solid.length ? solid : covering).map((r) => r.offset);
      const min = Math.min(...rows),
        max = Math.max(...rows);
      merged.push({ orientation, offset: (min + max) / 2, start, end, thicknessPx: max - min + 1 });
    };
    let from = -1;
    for (let i = 0; i <= n; i++) {
      const on = i < n && covered[i] === 1;
      if (on && from < 0) from = i;
      else if (!on && from >= 0) {
        emit(b.start + from, b.start + i - 1);
        from = -1;
      }
    }
  };
  for (const seg of [...segments].sort((a, b) => a.offset - b.offset || a.start - b.start)) {
    for (let i = active.length - 1; i >= 0; i--) {
      if (seg.offset - active[i]!.max > maxGapPx) flush(active.splice(i, 1)[0]!);
    }
    let best: Bucket | undefined;
    let bestOverlap = 0;
    for (const b of active) {
      if (seg.offset === b.max) continue;
      const overlap = Math.min(seg.end, b.end) - Math.max(seg.start, b.start) + 1;
      const ratio = overlap / Math.min(seg.end - seg.start + 1, b.end - b.start + 1);
      // A perpendicular wall's short cross-section must not extend a long
      // wall's row bucket through the entire height of the building.
      if (overlap / Math.max(seg.end - seg.start + 1, b.end - b.start + 1) < 0.25) continue;
      if (ratio >= 0.6 && overlap > bestOverlap) {
        best = b;
        bestOverlap = overlap;
      }
    }
    if (best) {
      best.max = seg.offset;
      best.start = Math.min(best.start, seg.start);
      best.end = Math.max(best.end, seg.end);
      best.runs.push({ offset: seg.offset, start: seg.start, end: seg.end });
    } else
      active.push({
        min: seg.offset,
        max: seg.offset,
        start: seg.start,
        end: seg.end,
        runs: [{ offset: seg.offset, start: seg.start, end: seg.end }],
      });
  }
  active.forEach(flush);
  return merged;
}
