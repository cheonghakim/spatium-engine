import type { BinaryImage } from "./binarize.js";

/** Builds a BinaryImage from ASCII art: '#' = ink, anything else = background. */
export function gridToBinary(rows: string[]): BinaryImage {
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const ink = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      ink[y * width + x] = row[x] === "#" ? 1 : 0;
    }
  });
  return { width, height, ink };
}
