import type { BoardMarkerDuration, Point } from "@web-pazle/shared";

export interface CameraView {
  center: Point;
  scale: number;
}

export type BoardArea = "table" | "tray";

export interface PuzzleViewPreference {
  camera?: CameraView;
  trayCamera?: CameraView;
  slideToEdge?: boolean;
  traysEnabled?: boolean;
  markerDuration?: BoardMarkerDuration;
  markerShortcut?: boolean;
  markerKey?: string;
}

export interface PuzzleViewPreferences {
  read(puzzleId: string): PuzzleViewPreference;
  update(puzzleId: string, change: PuzzleViewPreference): void;
}
