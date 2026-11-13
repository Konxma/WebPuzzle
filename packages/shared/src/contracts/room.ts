import type { Point, PuzzleFeatures, PuzzleTray } from "../domain/puzzle.js";

import type { BoardMarkerDuration } from "./session.js";

// Commands express player intent. The server must validate ownership and membership.
export type RoomCommand =
  | { type: "kick-player"; playerId: string }
  | { type: "create-tray" }
  | { type: "arrange-pieces" | "undo-arrange"; tray: PuzzleTray | null; requestId?: number }
  | { type: "point-at"; position: Point; tray: PuzzleTray | null; tileId?: number | null; duration?: BoardMarkerDuration; requestId?: number }
  | { type: "delete-tray"; tray: PuzzleTray }
  | { type: "rename-tray"; tray: PuzzleTray; name: string }
  | { type: "configure-features"; features: PuzzleFeatures }
  | { type: "grab-group"; groupId: string }
  | { type: "move-group"; groupId: string; position: Point }
  | { type: "stash-group"; groupId: string; tray: PuzzleTray | null; position: Point }
  | { type: "release-group"; groupId: string; position: Point };
