import { distance, type Point } from "@indoor/core";

/**
 * Data describing a placed reference floor plan image. Framework/DOM-free by
 * design (spec §2, §15) — `imageUrl` is just a string the Studio renderer
 * resolves to an actual <img>; the editor never loads pixels itself.
 */
export interface ReferenceLayerState {
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  /** World position of the image's top-left pixel (0,0). */
  origin: Point;
  /** Uniform scale: world meters per one image pixel. */
  metersPerPixel: number;
  opacity: number;
}

const DEFAULT_METERS_PER_PIXEL = 0.05;

export class ReferenceManager {
  private state: ReferenceLayerState | null = null;

  constructor(private readonly onChange: () => void) {}

  get current(): ReferenceLayerState | null {
    return this.state;
  }

  setImage(imageUrl: string, naturalWidth: number, naturalHeight: number): void {
    this.state = {
      imageUrl,
      naturalWidth,
      naturalHeight,
      origin: {
        x: -(naturalWidth * DEFAULT_METERS_PER_PIXEL) / 2,
        y: (naturalHeight * DEFAULT_METERS_PER_PIXEL) / 2,
      },
      metersPerPixel: DEFAULT_METERS_PER_PIXEL,
      opacity: 0.6,
    };
    this.onChange();
  }

  clear(): void {
    if (!this.state) return;
    this.state = null;
    this.onChange();
  }

  setOpacity(opacity: number): void {
    if (!this.state) return;
    this.state = { ...this.state, opacity: Math.min(1, Math.max(0, opacity)) };
    this.onChange();
  }

  setOrigin(origin: Point): void {
    if (!this.state) return;
    this.state = { ...this.state, origin };
    this.onChange();
  }

  worldToImagePixel(point: Point): Point {
    if (!this.state) return point;
    return {
      x: (point.x - this.state.origin.x) / this.state.metersPerPixel,
      y: (this.state.origin.y - point.y) / this.state.metersPerPixel,
    };
  }

  imagePixelToWorld(pixel: Point): Point {
    if (!this.state) return pixel;
    return {
      x: this.state.origin.x + pixel.x * this.state.metersPerPixel,
      y: this.state.origin.y - pixel.y * this.state.metersPerPixel,
    };
  }

  /**
   * Rescales the image uniformly so the two picked world points end up
   * `realDistanceMeters` apart, anchored at `worldA` (worldA's underlying
   * image pixel stays fixed in world space; everything else scales around it).
   */
  calibrate(worldA: Point, worldB: Point, realDistanceMeters: number): void {
    if (!this.state || realDistanceMeters <= 0) return;

    const pixelA = this.worldToImagePixel(worldA);
    const pixelB = this.worldToImagePixel(worldB);
    const pixelDistance = distance(pixelA, pixelB);
    if (pixelDistance === 0) return;

    const metersPerPixel = realDistanceMeters / pixelDistance;
    const origin: Point = {
      x: worldA.x - pixelA.x * metersPerPixel,
      y: worldA.y + pixelA.y * metersPerPixel,
    };

    this.state = { ...this.state, metersPerPixel, origin };
    this.onChange();
  }
}
