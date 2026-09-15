import { describe, expect, it } from "vitest";
import type { Command } from "../commands/Command.js";
import { HistoryManager } from "./HistoryManager.js";

function makeCounterCommand(counter: { value: number }, delta: number): Command {
  return {
    label: "increment",
    execute: () => {
      counter.value += delta;
    },
    undo: () => {
      counter.value -= delta;
    },
  };
}

describe("HistoryManager", () => {
  it("executes a command and tracks canUndo", () => {
    const counter = { value: 0 };
    const history = new HistoryManager();

    history.execute(makeCounterCommand(counter, 5));

    expect(counter.value).toBe(5);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
  });

  it("undoes and redoes in order", () => {
    const counter = { value: 0 };
    const history = new HistoryManager();

    history.execute(makeCounterCommand(counter, 5));
    history.execute(makeCounterCommand(counter, 3));
    expect(counter.value).toBe(8);

    history.undo();
    expect(counter.value).toBe(5);

    history.undo();
    expect(counter.value).toBe(0);
    expect(history.canUndo).toBe(false);

    history.redo();
    expect(counter.value).toBe(5);
    history.redo();
    expect(counter.value).toBe(8);
    expect(history.canRedo).toBe(false);
  });

  it("clears the redo stack when a new command is executed", () => {
    const counter = { value: 0 };
    const history = new HistoryManager();

    history.execute(makeCounterCommand(counter, 1));
    history.undo();
    expect(history.canRedo).toBe(true);

    history.execute(makeCounterCommand(counter, 10));
    expect(history.canRedo).toBe(false);
    expect(counter.value).toBe(10);
  });

  it("undo/redo on an empty stack are no-ops that return false", () => {
    const history = new HistoryManager();
    expect(history.undo()).toBe(false);
    expect(history.redo()).toBe(false);
  });
});
