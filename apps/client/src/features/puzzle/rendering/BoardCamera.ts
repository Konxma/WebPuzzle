import type { Container } from "pixi.js";
import { SCATTER_BOUNDS, type Point, type PuzzleBounds } from "@web-pazle/shared";
import type { BoardArea, CameraView } from "../models/PuzzleViewPreferences";

export interface BoardCameraPreferences {
  read(area: BoardArea): CameraView | undefined;
  save(area: BoardArea, camera: CameraView): void;
}

export function createBoardCamera(
  camera: Container,
  screen: { width: number; height: number },
  bounds: () => PuzzleBounds,
  initialArea: BoardArea,
  preferences?: BoardCameraPreferences,
) {
  const padding = 32;
  const views = new Map<BoardArea, CameraView>();
  let area = initialArea;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scaleToFit = (width: number, height: number) => Math.max(.001, Math.min(6,
    (screen.width - 2 * padding) / width, (screen.height - 2 * padding) / height));
  function fitScale() {
    const table = bounds();
    return scaleToFit(table.right - table.left, table.bottom - table.top);
  }
  function save() {
    clearTimeout(timer);
    timer = undefined;
    const scale = camera.scale.x;
    const view = { scale, center: {
      x: (screen.width / 2 - camera.x) / scale,
      y: (screen.height / 2 - camera.y) / scale,
    } };
    views.set(area, view);
    preferences?.save(area, view);
  }
  function position(x: number, y: number) {
    const table = bounds();
    const scale = camera.scale.x;
    const clampAxis = (offset: number, size: number, start: number, end: number) => {
      if ((end - start) * scale <= size - 2 * padding) return (size - (start + end) * scale) / 2;
      return Math.max(size - padding - end * scale, Math.min(padding - start * scale, offset));
    };
    camera.position.set(clampAxis(x, screen.width, table.left, table.right),
      clampAxis(y, screen.height, table.top, table.bottom));
    clearTimeout(timer);
    if (preferences) timer = setTimeout(save, 250);
  }
  function centerOn(point: Point, scale = camera.scale.x) {
    camera.scale.set(scale);
    position(screen.width / 2 - point.x * scale, screen.height / 2 - point.y * scale);
  }
  function centerTable(scale: number) {
    const table = bounds();
    centerOn({ x:(table.left + table.right) / 2, y:(table.top + table.bottom) / 2 },scale);
  }
  function restore() {
    const view = views.get(area) ?? preferences?.read(area);
    if (view) centerOn(view.center, Math.max(fitScale(), Math.min(6, view.scale)));
    else centerTable(area === "tray" ? fitScale() :
      scaleToFit(SCATTER_BOUNDS.right - SCATTER_BOUNDS.left, SCATTER_BOUNDS.bottom - SCATTER_BOUNDS.top));
  }
  restore();
  window.addEventListener("pagehide", save);
  return {
    fitScale, position, centerOn, centerTable,
    switchArea(next: BoardArea) {
      if (next === area) return;
      save();
      area = next;
      restore();
    },
    dispose() {
      save();
      window.removeEventListener("pagehide", save);
    },
  };
}
