import type { Command } from './Command.js';

export class CompoundCommand implements Command {
  constructor(readonly label: string, private readonly commands: Command[]) {}
  execute(): void { for (const command of this.commands) command.execute(); }
  undo(): void { for (const command of [...this.commands].reverse()) command.undo(); }
}
