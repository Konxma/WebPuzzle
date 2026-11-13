import { isPuzzleTray } from "@web-pazle/shared";
import type { PuzzleViewPreference, PuzzleViewPreferences } from "../../features/puzzle/models/PuzzleViewPreferences";

const keyFor = (id: string) => `webpazle-board-view:${id}`;

export class BrowserPuzzleViewPreferences implements PuzzleViewPreferences {
  read(id: string): PuzzleViewPreference {
    try {
      const data = JSON.parse(localStorage.getItem(keyFor(id)) ?? "{}");
      const camera = data?.camera;
      const center = camera?.center;
      return {
        camera: Number.isFinite(camera?.scale) && camera.scale > 0 && Number.isFinite(center?.x) && Number.isFinite(center?.y)
          ? camera : undefined,
        tray: data?.tray === null || isPuzzleTray(data?.tray) ? data.tray : undefined,
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
