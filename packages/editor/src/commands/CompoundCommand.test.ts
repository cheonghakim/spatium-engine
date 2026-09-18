import { describe, expect, it } from "vitest";
import type { Command } from "./Command.js";
import { CompoundCommand } from "./CompoundCommand.js";

function makeSpyCommand(log: string[], name: string): Command {
  return {
    label: name,
    execute: () => log.push(`execute ${name}`),
    undo: () => log.push(`undo ${name}`),
  };
}

describe("CompoundCommand", () => {
  it("executes its sub-commands in order", () => {
    const log: string[] = [];
    const compound = new CompoundCommand("Batch", [
      makeSpyCommand(log, "A"),
      makeSpyCommand(log, "B"),
      makeSpyCommand(log, "C"),
    ]);

    compound.execute();

    expect(log).toEqual(["execute A", "execute B", "execute C"]);
  });

  it("undoes its sub-commands in reverse order", () => {
    const log: string[] = [];
    const compound = new CompoundCommand("Batch", [
      makeSpyCommand(log, "A"),
      makeSpyCommand(log, "B"),
      makeSpyCommand(log, "C"),
    ]);

    compound.execute();
    log.length = 0;
    compound.undo();

    expect(log).toEqual(["undo C", "undo B", "undo A"]);
  });

  it("redoes (re-executes) in original order after an undo", () => {
    const log: string[] = [];
    const compound = new CompoundCommand("Batch", [
      makeSpyCommand(log, "A"),
      makeSpyCommand(log, "B"),
    ]);

    compound.execute();
    compound.undo();
    log.length = 0;
    compound.execute();

    expect(log).toEqual(["execute A", "execute B"]);
  });

  it("carries a label and preserves real state changes across execute/undo, in reverse-order-correct fashion", () => {
    // A case where order actually matters: B's execute depends on state A's
    // execute produced, so undo must run in exactly the reverse order or B's
    // undo would run against state A has already reverted from under it.
    const counter = { value: 0, log: [] as number[] };
    const addFive: Command = {
      label: "add 5",
      execute: () => {
        counter.value += 5;
      },
      undo: () => {
        counter.value -= 5;
      },
    };
    const doubleIt: Command = {
      label: "double",
      execute: () => {
        counter.value *= 2;
      },
      undo: () => {
        counter.value /= 2;
      },
    };
    const compound = new CompoundCommand("Math", [addFive, doubleIt]);

    compound.execute();
    expect(counter.value).toBe(10); // (0 + 5) * 2

    compound.undo();
    expect(counter.value).toBe(0); // 10 / 2 = 5, then 5 - 5 = 0

    expect(compound.label).toBe("Math");
  });
});
