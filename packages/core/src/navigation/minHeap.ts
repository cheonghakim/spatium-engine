interface HeapEntry<T> {
  item: T;
  priority: number;
}

/**
 * Standard binary min-heap over an array, keyed by an explicit priority.
 * Used by A* (see pathfinding.ts) as an open-set priority queue: rather than
 * supporting decrease-key (awkward with an array heap), callers just push
 * a node again whenever they find a cheaper path to it. The first pop of a
 * given item is always its cheapest pushed priority — see the comment in
 * pathfinding.ts — so later, staler pushes are simply skipped by the caller.
 */
export class MinHeap<T> {
  private readonly entries: HeapEntry<T>[] = [];

  get size(): number {
    return this.entries.length;
  }

  push(item: T, priority: number): void {
    this.entries.push({ item, priority });
    this.siftUp(this.entries.length - 1);
  }

  pop(): T | undefined {
    const top = this.entries[0];
    if (!top) return undefined;

    const last = this.entries.pop() as HeapEntry<T>;
    if (this.entries.length > 0) {
      this.entries[0] = last;
      this.siftDown(0);
    }
    return top.item;
  }

  private siftUp(startIndex: number): void {
    let index = startIndex;
    while (index > 0) {
      const parentIndex = (index - 1) >> 1;
      const parent = this.entries[parentIndex] as HeapEntry<T>;
      const current = this.entries[index] as HeapEntry<T>;
      if (parent.priority <= current.priority) break;
      this.swap(parentIndex, index);
      index = parentIndex;
    }
  }

  private siftDown(startIndex: number): void {
    let index = startIndex;
    const length = this.entries.length;
    for (;;) {
      const left = index * 2 + 1;
      const right = index * 2 + 2;
      let smallest = index;

      if (
        left < length &&
        (this.entries[left] as HeapEntry<T>).priority <
          (this.entries[smallest] as HeapEntry<T>).priority
      ) {
        smallest = left;
      }
      if (
        right < length &&
        (this.entries[right] as HeapEntry<T>).priority <
          (this.entries[smallest] as HeapEntry<T>).priority
      ) {
        smallest = right;
      }
      if (smallest === index) break;

      this.swap(smallest, index);
      index = smallest;
    }
  }

  private swap(i: number, j: number): void {
    const tmp = this.entries[i] as HeapEntry<T>;
    this.entries[i] = this.entries[j] as HeapEntry<T>;
    this.entries[j] = tmp;
  }
}
