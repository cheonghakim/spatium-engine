import type { IndoorRuntime } from "@indoor/runtime";
import type { BuilderControlsConfig } from "./BuilderConfig.js";

/**
 * The default on-map controls `BuilderConfig.controls` turns on: a floor
 * selector (building floors plus the site's outdoor plane) and a 2D/3D
 * toggle. Plain DOM so every host — exported vanilla/Vue apps, Studio's
 * preview — gets the same behavior without a UI framework. Hosts that want
 * their own UI set both flags to false and drive the runtime directly
 * (setFloor / getPlanes / setCameraMode).
 */
export class BuilderControls {
  private readonly root: HTMLDivElement;
  private readonly floorSelect: HTMLSelectElement;
  private readonly cameraButton: HTMLButtonElement;
  private readonly unsubscribers: Array<() => void>;
  private restorePosition: (() => void) | null = null;

  constructor(
    container: HTMLElement,
    private readonly runtime: IndoorRuntime,
  ) {
    this.root = document.createElement("div");
    this.root.className = "indoor-builder-controls";
    this.root.setAttribute("role", "toolbar");
    this.root.setAttribute("aria-label", "Map controls");
    Object.assign(this.root.style, {
      position: "absolute",
      top: "8px",
      right: "8px",
      display: "flex",
      gap: "6px",
      zIndex: "2",
      font: "13px system-ui, sans-serif",
    });

    this.floorSelect = document.createElement("select");
    this.floorSelect.className = "indoor-builder-floor-select";
    this.floorSelect.setAttribute("aria-label", "Floor");
    this.floorSelect.addEventListener("change", () => {
      this.runtime.setFloor(this.floorSelect.value);
    });

    this.cameraButton = document.createElement("button");
    this.cameraButton.type = "button";
    this.cameraButton.className = "indoor-builder-camera-toggle";
    this.cameraButton.addEventListener("click", () => {
      this.runtime.setCameraMode(this.mode === "3d" ? "2d" : "3d");
    });

    for (const element of [this.floorSelect, this.cameraButton]) {
      Object.assign(element.style, {
        padding: "4px 8px",
        border: "1px solid rgba(0,0,0,0.2)",
        borderRadius: "6px",
        background: "rgba(255,255,255,0.95)",
        color: "#1f2328",
        font: "inherit",
      });
    }

    // Absolute positioning needs a positioned container; don't override one the host set.
    if (
      typeof getComputedStyle === "function" &&
      getComputedStyle(container).position === "static"
    ) {
      const previous = container.style.position;
      container.style.position = "relative";
      this.restorePosition = () => {
        container.style.position = previous;
      };
    }
    this.root.append(this.floorSelect, this.cameraButton);
    container.appendChild(this.root);

    this.unsubscribers = [
      runtime.on("map.loaded", () => this.syncFloors()),
      runtime.on("floor.changed", () => this.syncFloors()),
      runtime.on("camera.changed", ({ mode }) => this.syncCamera(mode)),
      runtime.on("render3d.unavailable", () => {
        this.cameraButton.disabled = true;
        this.cameraButton.title = "3D is not available in this browser (WebGL)";
      }),
    ];
    this.syncFloors();
    this.syncCamera("2d");
  }

  private mode: "2d" | "3d" = "2d";

  apply(config: BuilderControlsConfig): void {
    this.floorSelect.style.display = config.floorSelector ? "" : "none";
    this.cameraButton.style.display = config.cameraToggle ? "" : "none";
    this.root.style.display = config.floorSelector || config.cameraToggle ? "flex" : "none";
    this.syncFloors();
  }

  destroy(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.root.remove();
    this.restorePosition?.();
  }

  private syncFloors(): void {
    const planes = this.runtime.getPlanes();
    const active = this.runtime.getActiveFloor()?.id ?? "";
    const buildings = new Set(planes.map((p) => p.buildingId).filter(Boolean));
    this.floorSelect.replaceChildren(
      ...planes.map((plane) => {
        const option = document.createElement("option");
        option.value = plane.id;
        option.textContent =
          plane.kind === "floor" && buildings.size > 1
            ? `${plane.buildingName} · ${plane.name}`
            : plane.name;
        return option;
      }),
    );
    this.floorSelect.value = active;
    this.floorSelect.disabled = planes.length < 2;
  }

  private syncCamera(mode: "2d" | "3d"): void {
    this.mode = mode;
    this.cameraButton.textContent = mode === "3d" ? "2D" : "3D";
    this.cameraButton.setAttribute("aria-label", mode === "3d" ? "Switch to 2D" : "Switch to 3D");
    this.cameraButton.setAttribute("aria-pressed", String(mode === "3d"));
  }
}
