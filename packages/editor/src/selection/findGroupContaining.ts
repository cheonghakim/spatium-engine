import type { Floor, Group } from "@indoor/core";

/** Finds the group (if any) that has `memberId` in its memberIds — lets a click on a member resolve to its group. */
export function findGroupContaining(floor: Floor, memberId: string): Group | null {
  return floor.groups.find((g) => g.memberIds.includes(memberId)) ?? null;
}
