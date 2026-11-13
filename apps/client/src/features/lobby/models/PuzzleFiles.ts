import type { PuzzleShape } from "@web-pazle/shared";

export const MAX_SAVED_PUZZLE_NAME = 60;

export interface SavedPuzzleDetails {
  shape: PuzzleShape;
  placed: number;
  savedAt: number;
}

export interface SavedPuzzle {
  name?: string;
  key: string;
  imageId: string;
  pieceCount: number;
  openedAt: number;
}

export interface SavedPuzzleCatalog {
  list(): SavedPuzzle[];
  remember(puzzle: SavedPuzzle): void;
  rename(key: string, name: string): void;
  details(save: SavedPuzzle): Promise<SavedPuzzleDetails | null>;
  remove(key: string): Promise<void>;
}

export interface PuzzlePhotoGateway {
  upload(file: File): Promise<string>;
}
