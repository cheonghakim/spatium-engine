import { describe, expect, it, vi } from "vitest";
import { SelectionManager } from "./SelectionManager.js";

describe("SelectionManager", () => {
  it("select replaces the current selection", () => {
    const onChange = vi.fn();
    const selection = new SelectionManager(onChange);

    selection.select("a");
    selection.select("b");

    expect(selection.current).toEqual([{ id: "b" }]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("add extends the selection without duplicates", () => {
    const selection = new SelectionManager(() => {});

    selection.select("a");
    selection.add("b");
    selection.add("a");

    expect(selection.current).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("remove drops a single entry", () => {
    const selection = new SelectionManager(() => {});
    selection.select("a");
    selection.add("b");

    selection.remove("a");

    expect(selection.current).toEqual([{ id: "b" }]);
  });

  it("clear empties the selection and skips redundant notifications", () => {
    const onChange = vi.fn();
    const selection = new SelectionManager(onChange);

    selection.clear();
    expect(onChange).not.toHaveBeenCalled();

    selection.select("a");
    selection.clear();
    expect(selection.current).toEqual([]);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("supports selecting a specific vertex of an object", () => {
    const selection = new SelectionManager(() => {});
    selection.select("space-1", 2);

    expect(selection.isSelected("space-1", 2)).toBe(true);
    expect(selection.isSelected("space-1", 0)).toBe(false);
    expect(selection.isSelected("space-1")).toBe(false);
  });
});
