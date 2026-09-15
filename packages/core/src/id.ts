/** Stable, globally unique ids for all domain objects. */
export function createId(): string {
  return crypto.randomUUID();
}
