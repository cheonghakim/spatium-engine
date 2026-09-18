import type { Condition } from "./actions.js";

/**
 * Called when a condition's `operator` doesn't match any known
 * `ConditionOperator` — a stale/hand-edited config that TS's compile-time
 * exhaustiveness can't catch at runtime. The condition still safely
 * evaluates to `false` (a broken rule shouldn't crash the runtime); this is
 * purely an observability hook so a caller (IndoorBuilder) can surface a
 * diagnostic on top of that safe no-op.
 */
export type UnknownOperatorHandler = (operator: string, condition: Condition) => void;

function getField(payload: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
      payload,
    );
}

function matchesCondition(
  condition: Condition,
  payload: unknown,
  onUnknownOperator?: UnknownOperatorHandler,
): boolean {
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
      return (
        typeof value === "number" && typeof condition.value === "number" && value > condition.value
      );
    case "lt":
      return (
        typeof value === "number" && typeof condition.value === "number" && value < condition.value
      );
    default:
      onUnknownOperator?.(condition.operator, condition);
      return false;
  }
}

/** All conditions must match (AND) — an empty list always matches. */
export function matchesConditions(
  conditions: readonly Condition[] | undefined,
  payload: unknown,
  onUnknownOperator?: UnknownOperatorHandler,
): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every((condition) => matchesCondition(condition, payload, onUnknownOperator));
}
