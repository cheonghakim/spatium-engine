export interface SelectionEntry {
  /** id of the owning object: Space, Wall, Entrance, POI, NavigationNode, or NavigationEdge. */
  id: string;
  /** Present when a single vertex of that object's polygon is selected. */
  vertexIndex?: number;
}

function sameEntry(a: SelectionEntry, b: SelectionEntry): boolean {
  return a.id === b.id && a.vertexIndex === b.vertexIndex;
}

/**
 * Tracks the current selection. select() replaces it with one entry;
 * add()/remove()/toggle() extend it (Shift/Ctrl+click), and setAll() replaces
 * it wholesale with a single change notification (marquee selection).
 */
export class SelectionManager {
  private entries: SelectionEntry[] = [];

  constructor(private readonly onChange: (entries: readonly SelectionEntry[]) => void) {}

  select(id: string, vertexIndex?: number): void {
    this.entries = [vertexIndex === undefined ? { id } : { id, vertexIndex }];
    this.onChange(this.entries);
  }

  add(id: string, vertexIndex?: number): void {
    const entry = vertexIndex === undefined ? { id } : { id, vertexIndex };
    if (this.entries.some((e) => sameEntry(e, entry))) return;
    this.entries = [...this.entries, entry];
    this.onChange(this.entries);
  }

  remove(id: string, vertexIndex?: number): void {
    const before = this.entries.length;
    this.entries =
      vertexIndex === undefined
        ? this.entries.filter((e) => e.id !== id)
        : this.entries.filter((e) => !(e.id === id && e.vertexIndex === vertexIndex));
    if (this.entries.length !== before) this.onChange(this.entries);
  }

  /** Adds the entry if absent, removes it if present (Shift/Ctrl+click). */
  toggle(id: string, vertexIndex?: number): void {
    if (this.isSelected(id, vertexIndex)) this.remove(id, vertexIndex);
    else this.add(id, vertexIndex);
  }

  /** Replaces the whole selection (duplicates dropped) with one change notification. */
  setAll(entries: readonly SelectionEntry[]): void {
    const next: SelectionEntry[] = [];
    for (const entry of entries)
      if (!next.some((e) => sameEntry(e, entry))) next.push({ ...entry });
    if (next.length === this.entries.length && next.every((e, i) => sameEntry(e, this.entries[i]!)))
      return;
    this.entries = next;
    this.onChange(this.entries);
  }

  clear(): void {
    if (this.entries.length === 0) return;
    this.entries = [];
    this.onChange(this.entries);
  }

  isSelected(id: string, vertexIndex?: number): boolean {
    return this.entries.some((e) =>
      sameEntry(e, vertexIndex === undefined ? { id } : { id, vertexIndex }),
    );
  }

  get current(): readonly SelectionEntry[] {
    return this.entries;
  }
}
