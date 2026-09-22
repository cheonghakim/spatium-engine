/**
 * A named, flat collection of object ids on one floor — lets a user bundle
 * spaces/walls/entrances/POIs/furniture/navigation nodes (any mix) together
 * so they can be selected, moved, and deleted as a single unit. Groups don't
 * nest: a member id is never itself a group id.
 */
export interface Group {
  id: string;
  floorId: string;
  label: string;
  memberIds: string[];
}
