import { describe, expect, it } from "vitest";
import { add, cross, dot, length, lerp, normalize, scale, subtract } from "./vector2.js";

describe("add", () => {
  it("adds two vectors component-wise", () => {
    expect(add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
  });
});

describe("subtract", () => {
  it("subtracts two vectors component-wise", () => {
    expect(subtract({ x: 5, y: 1 }, { x: 2, y: 3 })).toEqual({ x: 3, y: -2 });
  });
});

describe("scale", () => {
  it("scales a vector by a factor", () => {
    expect(scale({ x: 2, y: -3 }, 2.5)).toEqual({ x: 5, y: -7.5 });
  });

  it("returns the zero vector when scaled by 0", () => {
    expect(scale({ x: 4, y: 4 }, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe("length", () => {
  it("computes the magnitude of a vector", () => {
    expect(length({ x: 3, y: 4 })).toBe(5);
  });

  it("returns 0 for the zero vector", () => {
    expect(length({ x: 0, y: 0 })).toBe(0);
  });
});

describe("normalize", () => {
  it("returns a unit vector in the same direction", () => {
    const result = normalize({ x: 3, y: 4 });
    expect(result.x).toBeCloseTo(0.6);
    expect(result.y).toBeCloseTo(0.8);
    expect(length(result)).toBeCloseTo(1);
  });

  it("returns the zero vector for a zero-length input, rather than dividing by zero", () => {
    expect(normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe("dot", () => {
  it("computes the dot product", () => {
    expect(dot({ x: 1, y: 2 }, { x: 3, y: 4 })).toBe(11);
  });

  it("returns 0 for perpendicular vectors", () => {
    expect(dot({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(0);
  });
});

describe("cross", () => {
  it("computes the z-component of the 3D cross product", () => {
    expect(cross({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(1);
    expect(cross({ x: 0, y: 1 }, { x: 1, y: 0 })).toBe(-1);
  });

  it("returns 0 for parallel vectors", () => {
    expect(cross({ x: 2, y: 4 }, { x: 1, y: 2 })).toBe(0);
  });
});

describe("lerp", () => {
  it("returns the start point at t=0", () => {
    expect(lerp({ x: 0, y: 0 }, { x: 10, y: 10 }, 0)).toEqual({ x: 0, y: 0 });
  });

  it("returns the end point at t=1", () => {
    expect(lerp({ x: 0, y: 0 }, { x: 10, y: 10 }, 1)).toEqual({ x: 10, y: 10 });
  });

  it("interpolates at the midpoint", () => {
    expect(lerp({ x: 0, y: 0 }, { x: 10, y: 20 }, 0.5)).toEqual({ x: 5, y: 10 });
  });

  it("extrapolates for t outside [0, 1]", () => {
    expect(lerp({ x: 0, y: 0 }, { x: 10, y: 0 }, 2)).toEqual({ x: 20, y: 0 });
  });
});
