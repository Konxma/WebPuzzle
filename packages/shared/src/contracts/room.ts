import type { FieldSize } from "../domain/geometry.js";
import type { Point } from "../domain/puzzle.js";

import type { BoardMarkerDuration } from "./session.js";

// Commands express player intent. The server must validate ownership and membership.
export type RoomCommand =
  | { type: "resize-field"; size: FieldSize }
  | { type: "kick-player"; playerId: string }
  | { type: "arrange-pieces" | "undo-arrange" | "undo-collection"; requestId?: number }
  | { type: "point-at"; position: Point; tileId?: number | null; duration?: BoardMarkerDuration; requestId?: number }
  | { type: "grab-group"; groupId: string; additional?: boolean }
  | { type: "collection"; ids: string[]; action: "move" | "slide" | "store" | "restore"; x: number; y: number }
  | { type: "move-fingers"; positions: { id: string; x: number; y: number }[] }
  | { type: "move-group"; groupId: string; position: Point }
  | { type: "cancel-group"; groupId: string; position: Point }
  | { type: "release-group"; groupId: string; position: Point };
