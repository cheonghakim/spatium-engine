export type LayerId =
  "reference" | "spaces" | "walls" | "entrances" | "pois" | "furniture" | "navigation";

const DEFAULT_VISIBILITY: Record<LayerId, boolean> = {
  reference: true,
  spaces: true,
  walls: true,
  entrances: true,
  pois: true,
  furniture: true,
  navigation: true,
};

/** Per-layer show/hide toggles for the Studio canvas (spec §8, §15). */
export class LayerVisibilityManager {
  private visibility: Record<LayerId, boolean> = { ...DEFAULT_VISIBILITY };

  constructor(private readonly onChange: () => void) {}

  isVisible(layer: LayerId): boolean {
    return this.visibility[layer];
  }

  setVisible(layer: LayerId, visible: boolean): void {
    if (this.visibility[layer] === visible) return;
    this.visibility = { ...this.visibility, [layer]: visible };
    this.onChange();
  }

  toggle(layer: LayerId): void {
    this.setVisible(layer, !this.visibility[layer]);
  }

  /** Restores every layer's visibility to its default (all visible) — used when swapping to a new project. */
  reset(): void {
    this.visibility = { ...DEFAULT_VISIBILITY };
    this.onChange();
  }

  get all(): Readonly<Record<LayerId, boolean>> {
    return this.visibility;
  }
}
