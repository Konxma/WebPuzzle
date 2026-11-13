import { DEFAULT_IMAGE_ID, isPuzzleFileId, isPuzzleShape, isValidPieceCount } from "@web-pazle/shared";
import { MAX_SAVED_PUZZLE_NAME, type SavedPuzzle, type SavedPuzzleCatalog, type SavedPuzzleDetails } from "../../features/lobby/models/PuzzleFiles";

const storageKey = "webpazle-saved-puzzles-v1";

export class BrowserSavedPuzzles implements SavedPuzzleCatalog {
  list(): SavedPuzzle[] {
    try {
      const records: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      if (!Array.isArray(records)) return [];
      return records.filter(record => record && isPuzzleFileId(record.key) && isValidPieceCount(record.pieceCount) &&
        (record.imageId === DEFAULT_IMAGE_ID || isPuzzleFileId(record.imageId)) && Number.isFinite(record.openedAt))
        .map(record => ({
          ...record,
          name: typeof record.name === "string" ? record.name.trim().slice(0, MAX_SAVED_PUZZLE_NAME) : undefined,
        }));
    } catch { return []; }
  }

  remember(puzzle: SavedPuzzle) {
    const saved = this.list();
    const name = saved.find(item => item.key === puzzle.key)?.name;
    localStorage.setItem(storageKey, JSON.stringify([{ ...puzzle, name }, ...saved.filter(item => item.key !== puzzle.key)]));
  }

  rename(key: string, name: string) {
    const saved = this.list();
    if (!saved.some(item => item.key === key)) throw new Error("Пазл не знайдено");
    localStorage.setItem(storageKey, JSON.stringify(saved.map(item => item.key === key ? { ...item, name } : item)));
  }

  async details(save: SavedPuzzle): Promise<SavedPuzzleDetails | null> {
    try {
      const response = await fetch(`/api/saves/${save.key}`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
      if (!response.ok) return null;
      const { shape, placed, savedAt } = await response.json();
      if (!isPuzzleShape(shape) || !Number.isInteger(placed) || placed < 0 || placed > save.pieceCount ||
        !Number.isFinite(savedAt) || !Number.isFinite(new Date(savedAt).getTime())) return null;
      return { shape, placed, savedAt };
    } catch {
      return null;
    }
  }

  async remove(key: string) {
    if (!isPuzzleFileId(key)) throw new Error("Некоректний ключ збереження");
    const response = await fetch(`/api/saves/${key}`, { method: "DELETE" });
    if (response.status === 409) {
      throw new Error("Пазл зараз відкритий. Вийдіть із кімнати на всіх пристроях і спробуйте ще раз.");
    }
    if (response.status !== 204) throw new Error("Не вдалося видалити збереження. Перевірте з’єднання з грою.");

    localStorage.setItem(storageKey, JSON.stringify(this.list().filter(item => item.key !== key)));
  }
}
