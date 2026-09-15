import type { Condition } from "./actions.js";

function getField(payload: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), payload);
}

function matchesCondition(condition: Condition, payload: unknown): boolean {
  const value = getField(payload, condition.field);
  switch (condition.operator) {
    case "equals":
      return value === condition.value;
    case "notEquals":
      return value !== condition.value;
    case "in":
      return Array.isArray(condition.value) && condition.value.includes(value);
    case "notIn":
      return Array.isArray(condition.value) && !condition.value.includes(value);
    case "gt":
      return typeof value === "number" && typeof condition.value === "number" && value > condition.value;
    case "lt":
      return typeof value === "number" && typeof condition.value === "number" && value < condition.value;
    default:
      return false;
  }
}

/** All conditions must match (AND) — an empty list always matches. */
export function matchesConditions(conditions: readonly Condition[] | undefined, payload: unknown): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((condition) => matchesCondition(condition, payload));
}
