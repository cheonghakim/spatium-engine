type Listener<T> = (payload: T) => void;

/** Minimal typed pub/sub used by IndoorEditor — no framework dependency. */
export class EventEmitter<EventMap extends object> {
  private listeners = new Map<keyof EventMap, Set<Listener<never>>>();

  on<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(listener as Listener<never>);
    this.listeners.set(event, set);
    return () => this.off(event, listener);
  }

  off<K extends keyof EventMap>(event: K, listener: Listener<EventMap[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<never>);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as Listener<EventMap[K]>)(payload);
    }
  }
}
