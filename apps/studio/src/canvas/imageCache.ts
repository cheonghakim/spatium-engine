/**
 * Loads and caches <img> elements by URL for the canvas renderer. The editor
 * only ever hands render.ts a URL string (spec §2/§15 — no DOM in @indoor/core
 * or @indoor/editor); actual pixel loading happens here, at the Studio layer.
 */
const cache = new Map<string, HTMLImageElement>();
let onLoad: (() => void) | null = null;

export function setImageLoadListener(listener: () => void): void {
  onLoad = listener;
}

/** Returns the image once loaded, or null while it's still loading (triggers a redraw on completion). */
export function getLoadedImage(url: string): HTMLImageElement | null {
  const existing = cache.get(url);
  if (existing) return existing.complete && existing.naturalWidth > 0 ? existing : null;

  const image = new Image();
  image.onload = () => onLoad?.();
  image.src = url;
  cache.set(url, image);
  return null;
}
