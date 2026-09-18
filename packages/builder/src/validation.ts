import type { Action, Condition, ConditionOperator, EventActionRule } from "./actions.js";
import type { BuilderConfig } from "./BuilderConfig.js";
import { RUNTIME_EVENT_NAMES } from "./IndoorBuilder.js";

const CONDITION_OPERATORS: ReadonlySet<ConditionOperator> = new Set([
  "equals",
  "notEquals",
  "in",
  "notIn",
  "gt",
  "lt",
]);

const ANIMATION_TYPES: ReadonlySet<string> = new Set(["marker", "flythrough"]);
const ANIMATION_CAMERA_MODES: ReadonlySet<string> = new Set(["first", "third"]);
const ANIMATION_CURVES: ReadonlySet<string> = new Set(["straight", "smooth"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates a BuilderConfig's `events` rules at the shape level. This is a
 * runtime safety net for persisted/hand-authored JSON that TypeScript's
 * compile-time checking can't see: a stale `action.type` left over from a
 * renamed action, a required field dropped by a lossy round-trip, an
 * unrecognized condition `operator`. Mirrors @indoor/core's validation
 * modules in spirit — collect human-readable issues, never throw — but
 * returns plain strings since there's no shared object graph here to attach
 * severities/ids to.
 */
export function validateBuilderConfig(config: BuilderConfig): string[] {
  if (!isPlainObject(config)) {
    return ["config must be an object."];
  }

  const issues: string[] = [];
  const events = config.events ?? [];

  if (!Array.isArray(events)) {
    issues.push(`config.events must be an array.`);
    return issues;
  }

  events.forEach((rule, ruleIndex) => {
    if (!isPlainObject(rule)) {
      issues.push(`config.events[${ruleIndex}] must be an object.`);
      return;
    }
    validateRule(rule as unknown as EventActionRule, ruleIndex, issues);
  });
  return issues;
}

function validateRule(rule: EventActionRule, ruleIndex: number, issues: string[]): void {
  const ruleLabel = isNonEmptyString(rule.event)
    ? `Rule "${rule.event}" (index ${ruleIndex})`
    : `Rule at index ${ruleIndex}`;

  if (!isNonEmptyString(rule.event)) {
    issues.push(`${ruleLabel}: missing a valid "event" string.`);
  } else if (!RUNTIME_EVENT_NAMES.includes(rule.event as (typeof RUNTIME_EVENT_NAMES)[number])) {
    issues.push(`${ruleLabel}: Rule event "${rule.event}" is not a recognized runtime event.`);
  }

  const conditions = rule.conditions ?? [];
  if (!Array.isArray(conditions)) {
    issues.push(`${ruleLabel}: rule.conditions must be an array.`);
  } else {
    conditions.forEach((condition, conditionIndex) => {
      if (!isPlainObject(condition)) {
        issues.push(`${ruleLabel}: rule.conditions[${conditionIndex}] must be an object.`);
        return;
      }
      validateCondition(condition as unknown as Condition, ruleLabel, conditionIndex, issues);
    });
  }

  const actions = rule.actions ?? [];
  if (!Array.isArray(actions)) {
    issues.push(`${ruleLabel}: rule.actions must be an array.`);
  } else {
    actions.forEach((action, actionIndex) => {
      if (!isPlainObject(action)) {
        issues.push(`${ruleLabel}: rule.actions[${actionIndex}] must be an object.`);
        return;
      }
      validateAction(action as unknown as Action, ruleLabel, actionIndex, issues);
    });
  }
}

function validateCondition(
  condition: Condition,
  ruleLabel: string,
  index: number,
  issues: string[],
): void {
  const label = `${ruleLabel}, condition ${index}`;

  if (!isNonEmptyString(condition.field)) {
    issues.push(`${label}: missing a valid "field" string.`);
  }
  if (!CONDITION_OPERATORS.has(condition.operator as ConditionOperator)) {
    issues.push(`${label}: unrecognized operator "${String(condition.operator)}".`);
  }
}

function validateAction(action: Action, ruleLabel: string, index: number, issues: string[]): void {
  const label = `${ruleLabel}, action ${index}`;

  switch (action.type) {
    case "poi.focus":
      if (action.poiId !== undefined && !isNonEmptyString(action.poiId)) {
        issues.push(`${label} (poi.focus): "poiId" must be a string when present.`);
      }
      break;
    case "space.highlight":
      if (action.spaceId !== undefined && !isNonEmptyString(action.spaceId)) {
        issues.push(`${label} (space.highlight): "spaceId" must be a string when present.`);
      }
      break;
    case "popup.open":
      if (!isNonEmptyString(action.content)) {
        issues.push(`${label} (popup.open): missing required "content" string.`);
      }
      break;
    case "panel.open":
      if (!isNonEmptyString(action.panelId)) {
        issues.push(`${label} (panel.open): missing required "panelId" string.`);
      }
      break;
    case "panel.close":
      if (!isNonEmptyString(action.panelId)) {
        issues.push(`${label} (panel.close): missing required "panelId" string.`);
      }
      break;
    case "marker.add":
      if (!isNonEmptyString(action.markerId))
        issues.push(`${label} (marker.add): missing required "markerId" string.`);
      if (!isNonEmptyString(action.floorId))
        issues.push(`${label} (marker.add): missing required "floorId" string.`);
      if (!isFiniteNumber(action.x))
        issues.push(`${label} (marker.add): missing required numeric "x".`);
      if (!isFiniteNumber(action.y))
        issues.push(`${label} (marker.add): missing required numeric "y".`);
      break;
    case "marker.remove":
      if (!isNonEmptyString(action.markerId)) {
        issues.push(`${label} (marker.remove): missing required "markerId" string.`);
      }
      break;
    case "floor.change":
      if (!isNonEmptyString(action.floorId)) {
        issues.push(`${label} (floor.change): missing required "floorId" string.`);
      }
      break;
    case "camera.move":
      if (!isFiniteNumber(action.x))
        issues.push(`${label} (camera.move): missing required numeric "x".`);
      if (!isFiniteNumber(action.y))
        issues.push(`${label} (camera.move): missing required numeric "y".`);
      if (action.zoom !== undefined && !isFiniteNumber(action.zoom)) {
        issues.push(`${label} (camera.move): "zoom" must be a number when present.`);
      }
      break;
    case "camera.setMode2d":
    case "camera.setMode3d":
    case "route.clear":
    case "route.stopAnimation":
      break;
    case "route.start":
      if (!isNonEmptyString(action.fromNodeId))
        issues.push(`${label} (route.start): missing required "fromNodeId" string.`);
      if (!isNonEmptyString(action.toNodeId))
        issues.push(`${label} (route.start): missing required "toNodeId" string.`);
      break;
    case "route.playAnimation":
      if (action.animationType !== undefined && !ANIMATION_TYPES.has(action.animationType)) {
        issues.push(
          `${label} (route.playAnimation): "animationType" must be "marker" or "flythrough".`,
        );
      }
      if (action.cameraMode !== undefined && !ANIMATION_CAMERA_MODES.has(action.cameraMode)) {
        issues.push(`${label} (route.playAnimation): "cameraMode" must be "first" or "third".`);
      }
      if (action.curve !== undefined && !ANIMATION_CURVES.has(action.curve)) {
        issues.push(`${label} (route.playAnimation): "curve" must be "straight" or "smooth".`);
      }
      if (action.durationSeconds !== undefined && !isFiniteNumber(action.durationSeconds)) {
        issues.push(
          `${label} (route.playAnimation): "durationSeconds" must be a number when present.`,
        );
      }
      break;
    case "url.open":
      if (!isNonEmptyString(action.url)) {
        issues.push(`${label} (url.open): missing required "url" string.`);
      }
      break;
    case "event.emit":
      if (!isNonEmptyString(action.name)) {
        issues.push(`${label} (event.emit): missing required "name" string.`);
      }
      if (action.payload !== undefined && !isPlainObject(action.payload)) {
        issues.push(`${label} (event.emit): "payload" must be an object when present.`);
      }
      break;
    default:
      issues.push(
        `${label}: unrecognized action type "${String((action as { type: unknown }).type)}".`,
      );
  }
}
