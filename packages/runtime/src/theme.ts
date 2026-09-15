/** Visual theme overrides a Builder config can apply to a Runtime instance (spec §25). */
export interface RuntimeTheme {
  background?: string;
  spaceFill?: string;
  spaceStroke?: string;
  /** Used for POI/marker highlights and the route line in both 2D and 3D. */
  accentColor?: string;
}
