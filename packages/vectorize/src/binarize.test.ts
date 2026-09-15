import { describe, expect, it } from "vitest";
import { binarize, toGrayscale } from "./binarize.js";

function makeImage(pixels: Array<[number, number, number, number]>, width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  pixels.forEach(([r, g, b, a], i) => {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  });
  return { data, width, height };
}

describe("toGrayscale", () => {
  it("converts pure white and black opaque pixels correctly", () => {
    const image = makeImage(
      [
        [255, 255, 255, 255],
        [0, 0, 0, 255],
      ],
      2,
      1,
    );
    const gray = toGrayscale(image);
    expect(gray.pixels[0]).toBe(255);
    expect(gray.pixels[1]).toBe(0);
  });

  it("composites transparent pixels against a white background", () => {
    const image = makeImage([[0, 0, 0, 0]], 1, 1);
    const gray = toGrayscale(image);
    expect(gray.pixels[0]).toBe(255);
  });
});

describe("binarize", () => {
  it("marks pixels darker than the threshold as ink", () => {
    const image = makeImage(
      [
        [255, 255, 255, 255],
        [10, 10, 10, 255],
      ],
      2,
      1,
    );
    const binary = binarize(toGrayscale(image), 128);
    expect(Array.from(binary.ink)).toEqual([0, 1]);
  });
});
