import type { CameraView, PuzzleViewPreference, PuzzleViewPreferences } from "../../features/puzzle/models/PuzzleViewPreferences";

const keyFor = (id: string) => `webpazle-board-view:${id}`;

function readCamera(camera: CameraView | undefined) {
  return camera && Number.isFinite(camera.scale) && camera.scale > 0 &&
    Number.isFinite(camera.center?.x) && Number.isFinite(camera.center?.y) ? camera : undefined;
}

export class BrowserPuzzleViewPreferences implements PuzzleViewPreferences {
  read(id: string): PuzzleViewPreference {
    try {
      const data = JSON.parse(localStorage.getItem(keyFor(id)) ?? "{}");
      return {
        camera: readCamera(data?.camera),
        trayCamera: readCamera(data?.trayCamera),
        slideToEdge: data?.slideToEdge === true,
        traysEnabled: typeof data?.traysEnabled === "boolean" ? data.traysEnabled : undefined,
        markerDuration: data?.markerDuration === 10000 ? 10000 : undefined,
        markerShortcut: data?.markerShortcut === true,
        markerKey: typeof data?.markerKey === "string" && /^\p{L}$/u.test(data.markerKey) ? data.markerKey : undefined,
      };
    } catch { return {}; }
  }

  update(id: string, change: PuzzleViewPreference) {
    try {
      localStorage.setItem(keyFor(id), JSON.stringify({ ...this.read(id), ...change }));
    } catch { /* Storage can be disabled. The current view still works. */ }
  }
}
