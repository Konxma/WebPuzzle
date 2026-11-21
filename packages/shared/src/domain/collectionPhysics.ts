import { clampGroupToTable, type PuzzleBounds } from "./geometry.js";

interface MovingGroup {
  id: string;
  dx: number;
  dy: number;
  bounds: PuzzleBounds;
}

export function slideCollection(groups: MovingGroup[], x: number, y: number, table: PuzzleBounds) {
  const moves = groups.map(({ id, dx, dy, bounds }) => {
    const target = { dx: dx + x, dy: dy + y };
    const position = clampGroupToTable(bounds, target.dx, target.dy, table);
    return { id, ...position, bounds, pressureX: target.dx - position.dx, pressureY: target.dy - position.dy };
  });
  let pressureX = 0, pressureY = 0;
  for (const move of moves) {
    if (Math.abs(move.pressureX) > Math.abs(pressureX)) pressureX = move.pressureX;
    if (Math.abs(move.pressureY) > Math.abs(pressureY)) pressureY = move.pressureY;
  }

  if (pressureX || pressureY) {
    const horizontal = Math.abs(pressureX) >= Math.abs(pressureY);
    const pressure = horizontal ? pressureX : pressureY;
    const wall = horizontal ? (pressure < 0 ? "left" : "right") : (pressure < 0 ? "top" : "bottom");
    const axis = horizontal ? "dy" : "dx";
    const start = horizontal ? "top" : "left", end = horizontal ? "bottom" : "right";
    const touching = moves.filter(move =>
      Math.abs(move[horizontal ? "dx" : "dy"] + move.bounds[wall] - table[wall]) < 1e-6);
    if (touching.length > 1) {
      const midpoint = touching.reduce((sum, move) =>
        sum + move[axis] + (move.bounds[start] + move.bounds[end]) / 2, 0) / touching.length;
      // Sweep toward the longer open stretch of wall. Limit the displacement by
      // the applied pressure and group size so pieces slide instead of teleporting.
      const forward = midpoint <= (table[start] + table[end]) / 2;
      const direction = forward ? 1 : -1;
      const leading = forward ? start : end, trailing = forward ? end : start;
      const lead = (move: typeof moves[number]) => direction * (move[axis] + move.bounds[leading]);
      const contactPressure = (move: typeof moves[number]) => Math.abs(horizontal ? move.pressureX : move.pressureY);
      touching.sort((a, b) => lead(a) - lead(b) || contactPressure(b) - contactPressure(a) ||
        (a.id < b.id ? -1 : a.id === b.id ? 0 : 1));
      let occupiedUntil = -Infinity;
      for (const move of touching) {
        const ownPressure = contactPressure(move);
        const size = move.bounds[end] - move.bounds[start];
        const room = direction * (table[trailing] - move[axis] - move.bounds[trailing]);
        const needed = Math.max(0, occupiedUntil - lead(move));
        move[axis] += direction * Math.max(0, Math.min(needed, ownPressure, size * 2, room));
        occupiedUntil = Math.max(occupiedUntil, direction * (move[axis] + move.bounds[trailing]));
      }
    }
  }
  return moves.map(({ id, dx, dy }) => ({ id, dx, dy }));
}
