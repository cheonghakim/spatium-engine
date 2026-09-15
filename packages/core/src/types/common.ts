/**
 * World coordinates: unit = meter, X = east, Y = north.
 * Screen<->world conversion is owned by the editor camera, never by core.
 */
export interface Point {
  x: number;
  y: number;
}
