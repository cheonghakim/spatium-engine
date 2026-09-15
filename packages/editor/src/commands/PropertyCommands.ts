import type { Command } from "./Command.js";

export class ChangePropertyCommand<T, K extends keyof T> implements Command {
  readonly label: string;

  private readonly previousValue: T[K];

  constructor(
    private readonly target: T,
    private readonly key: K,
    private readonly newValue: T[K],
    label = "Change Property",
  ) {
    this.previousValue = target[key];
    this.label = label;
  }

  execute(): void {
    this.target[this.key] = this.newValue;
  }

  undo(): void {
    this.target[this.key] = this.previousValue;
  }
}
