import type { GameSnapshot, GameDelta } from "../domain/game.js";
import type { Point } from "../domain/puzzle.js";

export interface BoardMarker { position: Point; tileId?: number | null; duration?: BoardMarkerDuration }
export type BoardMarkerDuration = 5000 | 10000;
export const BOARD_MARKER_DURATION = 5000;
export interface BoardActionResult {
  requestId: number;
  outcome: "done" | "unavailable" | "busy";
}

export const ROOM_KICK_REASON = "kicked-by-host";
export interface PlayerInfo { id:string; name:string; connected:boolean; isHost:boolean }
export interface RoomSnapshot extends GameSnapshot { roomId:string; players:PlayerInfo[]; selfId:string; saveKey?:string; canUndoCollection?: boolean }
export interface GroupMotion { id: string; dx: number; dy: number; owner: string }
export type ServerEvent =
  | { type:"snapshot"; snapshot:RoomSnapshot }
  | { type:"delta"; delta:GameDelta }
  | { type:"motion"; group:GroupMotion }
  | { type:"players"; players:PlayerInfo[] }
  | { type:"board-marker"; marker: BoardMarker }
  | { type:"board-action-result"; result: BoardActionResult }
  | { type:"collection-undo"; available: boolean }
  | { type:"closed"; message:string }
  | { type:"error"; message:string };
