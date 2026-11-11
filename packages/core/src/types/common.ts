/**
 * World coordinates: unit = meter, X = east, Y = north.
 * Screen<->world conversion is owned by the editor camera, never by core.
 */
export interface Point {
  x: number;
  y: number;
}

/** BCP-47 language tag → text, e.g. { ko: "정문", en: "Main Gate" }. Shown as names[locale] ?? name. */
export type LocalizedText = Record<string, string>;
