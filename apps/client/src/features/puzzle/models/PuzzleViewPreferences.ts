import type { BoardMarkerDuration, Point, PuzzleTray } from "@web-pazle/shared";

export interface CameraView {
  center: Point;
  scale: number;
}

export interface PuzzleViewPreference {
  camera?: CameraView;
  tray?: PuzzleTray | null;
  markerDuration?: BoardMarkerDuration;
  markerShortcut?: boolean;
  markerKey?: string;
}

export interface PuzzleViewPreferences {
  read(puzzleId: string): PuzzleViewPreference;
  update(puzzleId: string, change: PuzzleViewPreference): void;
}
