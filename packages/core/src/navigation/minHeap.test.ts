import { describe, expect, it } from "vitest";
import { MinHeap } from "./minHeap.js";

describe("MinHeap", () => {
  it("pops items in ascending priority order", () => {
    const heap = new MinHeap<string>();
    heap.push("c", 3);
    heap.push("a", 1);
    heap.push("b", 2);

    expect(heap.pop()).toBe("a");
    expect(heap.pop()).toBe("b");
    expect(heap.pop()).toBe("c");
  });

  it("handles duplicate priorities without losing any item", () => {
    const heap = new MinHeap<string>();
    heap.push("x", 1);
    heap.push("y", 1);
    heap.push("z", 1);

    const popped = [heap.pop(), heap.pop(), heap.pop()];
    expect(popped.sort()).toEqual(["x", "y", "z"]);
  });

  it("returns undefined when popping an empty heap", () => {
    const heap = new MinHeap<number>();
    expect(heap.pop()).toBeUndefined();
  });

  it("keeps returning undefined once drained, without throwing", () => {
    const heap = new MinHeap<number>();
    heap.push(1, 1);
    expect(heap.pop()).toBe(1);
    expect(heap.pop()).toBeUndefined();
    expect(heap.pop()).toBeUndefined();
  });

  it("tracks size across pushes and pops", () => {
    const heap = new MinHeap<number>();
    expect(heap.size).toBe(0);
    heap.push(1, 5);
    heap.push(2, 3);
    expect(heap.size).toBe(2);
    heap.pop();
    expect(heap.size).toBe(1);
    heap.pop();
    expect(heap.size).toBe(0);
  });

  it("maintains sorted-pop order across many out-of-order pushes", () => {
    const heap = new MinHeap<number>();
    const priorities = [5, 3, 8, 1, 9, 2, 7, 4, 6, 0, -3, 100, 42];
    for (const p of priorities) heap.push(p, p);

    const result: number[] = [];
    while (heap.size > 0) {
      const value = heap.pop();
      if (value !== undefined) result.push(value);
    }

    expect(result).toEqual([...priorities].sort((a, b) => a - b));
  });

  it("supports pushing again after fully draining", () => {
    const heap = new MinHeap<string>();
    heap.push("a", 1);
    heap.pop();
    heap.push("b", 5);
    heap.push("c", 2);
    expect(heap.pop()).toBe("c");
    expect(heap.pop()).toBe("b");
  });
});
