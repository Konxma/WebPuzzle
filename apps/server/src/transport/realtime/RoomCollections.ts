import type { Client } from "@colyseus/core";
import type { CollectionPosition, GameDelta, PuzzleEngine } from "@web-pazle/shared";

export class RoomCollections {
  private readonly history = new Map<string, Map<string, CollectionPosition>>();

  constructor(
    private readonly engine: PuzzleEngine,
    private readonly commit: (delta: GameDelta) => void,
    private readonly player: (playerId: string) => Client | undefined,
  ) {}

  canUndo(playerId: string) { return this.history.has(playerId); }

  forget(playerId: string) { this.history.delete(playerId); }

  onDelta(delta: GameDelta) {
    if (this.history.size) {
      const changed = new Set([...delta.removed, ...delta.groups.map(group => group.id)]);
      for (const [playerId, positions] of this.history) {
        if (delta.fieldSize || [...positions.keys()].some(id => changed.has(id))) {
          this.history.delete(playerId);
          this.player(playerId)?.send("collection-undo", false);
        }
      }
    }
  }

  move(client: Client, payload: object) {
    if ("ids" in payload && Array.isArray(payload.ids) && payload.ids.length <= this.engine.tiles.length &&
      payload.ids.every(id => typeof id === "string") && "action" in payload &&
      (payload.action === "slide" || payload.action === "move" || payload.action === "store" || payload.action === "restore") &&
      "x" in payload && typeof payload.x === "number" && Number.isFinite(payload.x) &&
      "y" in payload && typeof payload.y === "number" && Number.isFinite(payload.y)) {
      const before = new Map<string, CollectionPosition>();
      for (const id of payload.ids) {
        const group = this.engine.groups.get(id);
        if (group) before.set(id, { dx:group.dx, dy:group.dy, stored:group.stored === true });
      }
      const delta = this.engine.collect(payload.ids, payload.action, payload.x, payload.y);
      if (!delta) return client.send("save-error", "Добірка змінилася. Виберіть вільні деталі ще раз.");
      delta.groups = delta.groups.filter(group => {
        const previous = before.get(group.id)!;
        if (previous.dx !== group.dx || previous.dy !== group.dy || previous.stored !== (group.stored === true)) return true;
        before.delete(group.id);
        return false;
      });
      if (!before.size) {
        // Reconcile the initiating client's drag preview even when the server clamped every piece.
        client.send("delta", { groups: payload.ids.map(id => this.engine.groups.get(id)), removed: [] });
        return;
      }
      this.history.delete(client.sessionId);
      this.commit(delta);
      this.history.set(client.sessionId, before);
      client.send("collection-undo", true);
    }
  }

  undo(client: Client) {
    const positions = this.history.get(client.sessionId);
    this.forget(client.sessionId);
    client.send("collection-undo", false);
    const delta = positions && this.engine.undoCollection(positions);
    if (!delta) return false;
    this.commit(delta);
    return true;
  }
}
