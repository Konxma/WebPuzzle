import { TABLE_BOUNDS, TABLE_HEIGHT, TABLE_WIDTH, type PuzzleBounds } from "./geometry.js";

interface Item { id: string; bounds: PuzzleBounds }

// Plan the entire layout before moving any group. Adjacent cells keep the silhouettes apart.
export function arrangeLoosePieces(items: Item[], obstacles: PuzzleBounds[]) {
  if (items.length < 2 && obstacles.length === 0) return null;
  const gap = 8;
  const width = Math.max(1, ...items.map(({ bounds }) => bounds.right - bounds.left)) + gap;
  const height = Math.max(1, ...items.map(({ bounds }) => bounds.bottom - bounds.top)) + gap;
  const columns = Math.floor(TABLE_WIDTH / width);
  const rows = Math.floor(TABLE_HEIGHT / height);
  const left = TABLE_BOUNDS.left + (TABLE_WIDTH - columns * width) / 2;
  const top = TABLE_BOUNDS.top + (TABLE_HEIGHT - rows * height) / 2;
  const blocked = new Set<number>();
  for (const obstacle of obstacles) {
    const minX = Math.max(0, Math.floor((obstacle.left - left) / width));
    const minY = Math.max(0, Math.floor((obstacle.top - top) / height));
    const maxX = Math.min(columns - 1, Math.floor((obstacle.right - left) / width));
    const maxY = Math.min(rows - 1, Math.floor((obstacle.bottom - top) / height));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) blocked.add(y * columns + x);
    }
  }
  const slots: { x: number; y: number; distance: number }[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      if (blocked.has(row * columns + col)) continue;
      const x = left + (col + .5) * width;
      const y = top + (row + .5) * height;
      const distance = ((col + .5 - columns / 2) / columns) ** 2 + ((row + .5 - rows / 2) / rows) ** 2;
      slots.push({ x, y, distance });
    }
  }
  if (slots.length < items.length) return null;
  slots.sort((a, b) => a.distance - b.distance);
  return items.map(({ id, bounds }, index) => ({
    id,
    dx: slots[index]!.x - (bounds.left + bounds.right) / 2,
    dy: slots[index]!.y - (bounds.top + bounds.bottom) / 2,
  }));
}
