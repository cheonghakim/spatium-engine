import { polygonCentroid } from "../geometry/polygon.js";
import type { Point } from "../types/common.js";
import type { POI } from "../types/poi.js";
import type { IndoorProject } from "../types/project.js";
import type { Space } from "../types/space.js";

export type SearchResultKind = "poi" | "space";

export interface SearchResult {
  kind: SearchResultKind;
  id: string;
  /** Display name in the requested locale (names[locale] ?? name). */
  name: string;
  buildingId: string;
  floorId: string;
  /** A representative point: the POI position or the space centroid. */
  position: Point;
  /** Higher is better. Exact match > prefix > word prefix > substring > initials. */
  score: number;
  item: POI | Space;
}

export interface SearchOptions {
  /** BCP-47 tag used to pick the display name. Every locale's names are searched regardless. */
  locale?: string;
  kinds?: readonly SearchResultKind[];
  buildingId?: string;
  floorId?: string;
  /** Default 20. */
  limit?: number;
}

/** Display name for a labeled object: `names[locale]`, then `name`. */
export function localizedName(
  item: { name?: string; names?: Record<string, string> },
  locale?: string,
): string {
  if (locale && item.names) {
    const exact = item.names[locale];
    if (exact) return exact;
    // "ko-KR" falls back to "ko".
    const base = item.names[locale.split("-")[0]!];
    if (base) return base;
  }
  return item.name ?? "";
}

function normalize(text: string): string {
  // NFKC folds full-width forms, but would also turn compatibility jamo
  // ("ㅅ") into conjoining jamo, breaking initial-consonant queries — skip those.
  return text
    .replace(/[^ㄱ-ㅎ]+/g, (run) => run.normalize("NFKC"))
    .toLowerCase()
    .replace(/\s+/g, "");
}

const CHOSEONG = [..."ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"];
const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

/** Korean initial consonants of each syllable ("스타벅스" → "ㅅㅌㅂㅅ"); other characters pass through. */
function initials(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    out +=
      code >= HANGUL_START && code <= HANGUL_END
        ? CHOSEONG[Math.floor((code - HANGUL_START) / 588)]
        : ch;
  }
  return out;
}

const isAllChoseong = (text: string): boolean => /^[ㄱ-ㅎ]+$/.test(text);

function scoreText(candidate: string, query: string): number {
  const text = normalize(candidate);
  if (!text) return 0;
  if (text === query) return 100;
  if (text.startsWith(query)) return 80;
  // Word prefix: "커피" in "스타벅스 커피" (spaces are stripped by normalize).
  if (
    candidate
      .toLowerCase()
      .split(/[\s\-_/()·]+/)
      .some((w) => normalize(w).startsWith(query))
  ) {
    return 60;
  }
  if (text.includes(query)) return 40;
  if (isAllChoseong(query) && initials(text).includes(query)) return 30;
  return 0;
}

function bestScore(texts: readonly (string | undefined)[], query: string): number {
  let best = 0;
  for (const text of texts) {
    if (text) best = Math.max(best, scoreText(text, query));
  }
  return best;
}

/**
 * Searches POIs and named spaces by name (all locales), external id and space
 * code/category. Case, width and spaces are ignored; an all-initials Korean
 * query ("ㅅㅌㅂ") matches syllables ("스타벅스"). Results are sorted by score,
 * then name.
 */
export function searchProject(
  project: IndoorProject,
  query: string,
  options: SearchOptions = {},
): SearchResult[] {
  const q = normalize(query);
  if (!q) return [];
  const kinds = new Set(options.kinds ?? ["poi", "space"]);
  const results: SearchResult[] = [];

  for (const building of project.buildings) {
    if (options.buildingId && building.id !== options.buildingId) continue;
    for (const floor of building.floors) {
      if (options.floorId && floor.id !== options.floorId) continue;

      if (kinds.has("poi")) {
        for (const poi of floor.pois) {
          const score = bestScore([poi.name, ...Object.values(poi.names ?? {}), poi.externalId], q);
          if (score > 0) {
            results.push({
              kind: "poi",
              id: poi.id,
              name: localizedName(poi, options.locale),
              buildingId: building.id,
              floorId: floor.id,
              position: poi.position,
              score,
              item: poi,
            });
          }
        }
      }

      if (kinds.has("space")) {
        for (const space of floor.spaces) {
          const p = space.properties;
          const score = bestScore(
            [p.name, ...Object.values(p.names ?? {}), p.externalId, p.code, p.category],
            q,
          );
          if (score > 0) {
            results.push({
              kind: "space",
              id: space.id,
              name: localizedName(p, options.locale),
              buildingId: building.id,
              floorId: floor.id,
              position: polygonCentroid(space.polygon),
              score,
              item: space,
            });
          }
        }
      }
    }
  }

  results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return results.slice(0, options.limit ?? 20);
}
