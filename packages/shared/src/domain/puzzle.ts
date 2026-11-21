export const MAX_ROOM_PLAYERS = 8;
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
