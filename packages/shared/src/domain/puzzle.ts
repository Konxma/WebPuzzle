export const MAX_ROOM_PLAYERS = 2;
export const MIN_PIECE_COUNT = 1;
export const MAX_PIECE_COUNT = 3000;
export const DEMO_PIECE_COUNT = 24;
export const DEFAULT_PIECE_COUNT = 1000;
export const DEFAULT_PUZZLE_GRID = { columns: 40, rows: 25 } as const;
export const DEFAULT_IMAGE_ID = "quiet-bay";
export const PUZZLE_SHAPES = ["classic", "classic-wide", "classic-narrow", "wave", "angular"] as const;
export type PuzzleShape = typeof PUZZLE_SHAPES[number];
export const DEFAULT_PUZZLE_SHAPE: PuzzleShape = "classic";
export function isPuzzleShape(value: unknown): value is PuzzleShape {
  return PUZZLE_SHAPES.some(shape => shape === value);
}
export const MAX_PUZZLE_PHOTO_BYTES = 6 * 1024 * 1024;
export const LEGACY_PUZZLE_TRAYS = ["sky", "water", "later"] as const;
export const MAX_PUZZLE_TRAYS = 8;
export const MAX_TRAY_NAME_LENGTH = 40;
export interface PuzzleFeatures { trays: boolean; edgeFilter: boolean }
export const DEFAULT_PUZZLE_FEATURES: PuzzleFeatures = { trays: false, edgeFilter: false };

export function isPuzzleFeatures(value: unknown): value is PuzzleFeatures {
  return typeof value === "object" && value !== null &&
    "trays" in value && typeof value.trays === "boolean" &&
    "edgeFilter" in value && typeof value.edgeFilter === "boolean";
}

export function normalizeTrayName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length > 0 && name.length <= MAX_TRAY_NAME_LENGTH && !/[\u0000-\u001f\u007f]/.test(name) ? name : null;
}
export type PuzzleTray = typeof LEGACY_PUZZLE_TRAYS[number] | `tray-${number}`;
export function isPuzzleTray(value: unknown): value is PuzzleTray {
  if (LEGACY_PUZZLE_TRAYS.some(tray => tray === value)) return true;
  if (typeof value !== "string" || !/^tray-[1-9]\d*$/.test(value)) return false;
  return Number(value.slice(5)) <= MAX_PUZZLE_TRAYS;
}
export function isPuzzleFileId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
}
export function puzzleImageUrl(imageId: string): string {
  return isPuzzleFileId(imageId) ? `/api/photos/${imageId}` : "/art/quiet-bay.svg";
}

export interface Point { x: number; y: number }
export interface PuzzleDefinition {
  id: string;
  imageId: string;
  pieceCount: number;
  seed: number;
  shape?: PuzzleShape;
}
export interface PieceState { id: number; groupId: string }
export interface GroupState {
  id: string;
  position: Point;
  lockedBy: string | null;
}
export function isValidPieceCount(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_PIECE_COUNT && value <= MAX_PIECE_COUNT;
}
export function assertPieceCount(value: number): void {
  if (!isValidPieceCount(value)) {
    throw new RangeError(`Piece count must be an integer from ${MIN_PIECE_COUNT} to ${MAX_PIECE_COUNT}.`);
  }
}
export function getPieceCount(grid: { columns: number; rows: number }): number {
  if (!Number.isInteger(grid.columns) || !Number.isInteger(grid.rows) ||
      grid.columns < 1 || grid.rows < 1) {
    throw new Error("Puzzle dimensions must be positive integers.");
  }
  const count = grid.columns * grid.rows;
  assertPieceCount(count);
  return count;
}
