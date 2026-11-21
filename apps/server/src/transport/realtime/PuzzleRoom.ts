import { CloseCode, Room, type Client } from "@colyseus/core";
import { PuzzleEngine, DEFAULT_IMAGE_ID, DEFAULT_PUZZLE_SHAPE, isPuzzleShape, MAX_ROOM_PLAYERS, ROOM_KICK_REASON, assertPieceCount, isPuzzleFileId, isFieldSize, type BoardActionResult, type PlayerInfo, type GameDelta, type GroupMotion } from "@web-pazle/shared";
import { randomInt, randomUUID } from "node:crypto";
import { puzzleLibrary } from "../../infrastructure/PuzzleLibrary.js";
import { RoomCollections } from "./RoomCollections.js";

export class PuzzleRoom extends Room {
  maxClients=MAX_ROOM_PLAYERS;
  private engine!:PuzzleEngine;
  private saveKey?: string;
  private saveOwnerId?: string;
  private players=new Map<string,PlayerInfo>();
  private reconnecting = new Map<string, ReturnType<Room["allowReconnection"]>>();
  private rates=new Map<string,{time:number;count:number}>();
  private lastActivity=new Map<string,number>();
  private lastMarker = new Map<string, number>();
  private lastArrange = 0;
  private collections!: RoomCollections;
  private pendingMotion = new Map<string, GroupMotion>();
  onCreate(options:unknown){
    const input = (options ?? {}) as Record<string, unknown>;
    if (input.saveKey !== undefined) {
      if (!isPuzzleFileId(input.saveKey)) throw new Error("Invalid save key");
      const saved = puzzleLibrary.load(input.saveKey);
      this.engine = new PuzzleEngine(saved.definition, saved.groups, saved.arrangeHistory, saved.fieldSize);
      puzzleLibrary.claim(input.saveKey, this.roomId);
      this.saveKey = input.saveKey;
    } else {
      const count = input.pieceCount;
      const imageId = input.imageId ?? DEFAULT_IMAGE_ID;
      const shape = input.shape === undefined ? DEFAULT_PUZZLE_SHAPE : input.shape;
      if (typeof count !== "number" || !puzzleLibrary.hasImage(imageId) || !isPuzzleShape(shape)) {
        throw new Error("Invalid puzzle options");
      }
      assertPieceCount(count);
      this.engine = new PuzzleEngine({ id: randomUUID(), imageId, pieceCount: count, seed: randomInt(1, 2147483647), shape });
      const key = randomUUID();
      puzzleLibrary.save(key, this.engine.snapshot());
      puzzleLibrary.claim(key, this.roomId);
      this.saveKey = key;
    }
    this.collections = new RoomCollections(this.engine, delta => this.commit(delta), id => this.clients.getById(id));
    void this.setPrivate(true);
    this.onMessage("sync",(client)=>this.sendSnapshot(client));
    this.onMessage("command",(client,payload:unknown)=>this.command(client,payload));
    this.clock.setInterval(() => this.flushMotion(), 50);
    this.clock.setInterval(()=>{
      for(const [id,time]of this.lastActivity)if(Date.now()-time>15000){this.commit(this.engine.releaseOwner(id));this.lastActivity.delete(id);}
    },1000);
  }
  onJoin(client:Client){
    this.saveOwnerId ??= client.sessionId;
    const taken = new Set([...this.players.values()].map(player => player.name));
    let slot = 1;
    while (taken.has(`Гравець ${slot}`)) slot++;
    this.players.set(client.sessionId, {
      id: client.sessionId, name: `Гравець ${slot}`, connected: true, isHost: this.players.size === 0,
    });
    this.broadcast("players",[...this.players.values()]);
  }
  private sendSnapshot(client:Client){
    // Only the requesting player needs a full snapshot, including their own seat ID.
    const saveKey = client.sessionId === this.saveOwnerId ? this.saveKey : undefined;
    client.send("snapshot",{...this.engine.snapshot(),roomId:this.roomId,players:[...this.players.values()],selfId:client.sessionId,canUndoCollection:this.collections.canUndo(client.sessionId),...(saveKey ? { saveKey } : {})});
  }
  private publish(delta: GameDelta | null) {
    if (!delta || !(delta.groups.length || delta.removed.length || delta.fieldSize)) return;
    // A structural delta supersedes any queued coordinates for the affected groups.
    for (const group of delta.groups) this.pendingMotion.delete(group.id);
    for (const id of delta.removed) this.pendingMotion.delete(id);
    this.collections.onDelta(delta);
    this.broadcast("delta", delta);
  }
  private flushMotion() {
    if (this.pendingMotion.size === 0) return;
    const motions = [...this.pendingMotion.values()];
    this.pendingMotion.clear();
    if (motions.length === 1) {
      const motion = motions[0]!;
      this.broadcast("motion", motion, { except: this.clients.getById(motion.owner) });
    } else {
      this.broadcast("motion-batch", motions);
    }
  }
  private commit(delta: GameDelta | null) {
    if (!delta || (!delta.groups.length && !delta.removed.length && !delta.fieldSize)) return;
    this.publish(delta);
    if (this.saveKey) {
      try { puzzleLibrary.save(this.saveKey, this.engine.saveSnapshot()); }
      catch (error) {
        console.error("Puzzle autosave failed", error);
        this.broadcast("save-error", "Не вдалося зберегти прогрес на ПК господаря.");
      }
    }
  }
  private command(client:Client,payload:unknown){
    const now=Date.now();let rate=this.rates.get(client.sessionId);
    if(!rate||now-rate.time>=1000){rate={time:now,count:0};this.rates.set(client.sessionId,rate);}
    if(++rate.count>100)return;
    if (typeof payload !== "object" || payload === null || !("type" in payload)) return;
    if (payload.type === "resize-field") {
      if (this.players.get(client.sessionId)?.isHost && "size" in payload && isFieldSize(payload.size)) {
        this.commit(this.engine.resizeField(payload.size));
      }
      return;
    }
    if (payload.type === "kick-player") {
      if ("playerId" in payload && typeof payload.playerId === "string") this.kickPlayer(client, payload.playerId);
      return;
    }
    if (payload.type === "point-at" || payload.type === "arrange-pieces" || payload.type === "undo-arrange" || payload.type === "undo-collection") {
      this.boardAction(client, payload, payload.type, now);
      return;
    }
    if (payload.type === "move-fingers") {
      if (!("positions" in payload) || !Array.isArray(payload.positions) || payload.positions.length > this.engine.tiles.length) return;
      this.lastActivity.set(client.sessionId, now);
      for (const p of payload.positions) {
        if (typeof p?.id !== "string") continue;
        const before = this.engine.groups.get(p.id);
        if (!before || (before.dx === p.x && before.dy === p.y)) continue;
        const group = this.engine.move(p.id, client.sessionId, p.x, p.y)?.groups[0];
        if (group) this.pendingMotion.set(group.id, { id: group.id, dx: group.dx, dy: group.dy, owner: client.sessionId });
      }
      return;
    }
    if (payload.type === "collection") {
      this.collections.move(client, payload);
      return;
    }
    if (!("groupId" in payload) || typeof payload.groupId !== "string") return;
    const id=payload.groupId;
    this.lastActivity.set(client.sessionId,now);
    if(payload.type==="grab-group"){this.publish(this.engine.grab(id,client.sessionId, 'additional' in payload && payload.additional === true));return;}
    if(!("position" in payload)||typeof payload.position!=="object"||payload.position===null||!("x" in payload.position)||!("y" in payload.position))return;
    const {x,y}=payload.position;
    if(typeof x!=="number"||typeof y!=="number"||!Number.isFinite(x)||!Number.isFinite(y))return;
    // Motion sends coordinates only. Release may join groups or snap them into place.
    if (payload.type === "move-group") {
      const previous = this.engine.groups.get(id);
      const dx = previous?.dx, dy = previous?.dy;
      const group = this.engine.move(id, client.sessionId, x, y)?.groups[0];
      if (group && (group.dx !== dx || group.dy !== dy)) {
        this.pendingMotion.set(group.id, { id: group.id, dx: group.dx, dy: group.dy, owner: client.sessionId });
      }
    }
    else if(payload.type==="release-group")this.commit(this.engine.release(id,client.sessionId,x,y));
    else if (payload.type === "cancel-group") this.commit(this.engine.cancelDrag(id, client.sessionId, x, y));
  }
  private boardAction(client: Client, payload: object, type: "point-at" | "arrange-pieces" | "undo-arrange" | "undo-collection", now: number) {
    const requestId = "requestId" in payload ? payload.requestId : undefined;
    const reply = (outcome: BoardActionResult["outcome"]) => {
      if (typeof requestId === "number" && Number.isSafeInteger(requestId)) {
        const result: BoardActionResult = { requestId, outcome };
        client.send("board-action-result", result);
      } else if (type === "arrange-pieces" && outcome === "unavailable") {
        client.send("arrange-unavailable", {});
      }
    };
    if (type === "undo-collection") return reply(this.collections.undo(client) ? "done" : "unavailable");
    if (type === "undo-arrange") {
      const delta = this.engine.undoArrange();
      if (!delta) return reply("unavailable");
      this.commit(delta);
      return reply("done");
    }
    if (type === "arrange-pieces") {
      if (now - this.lastArrange < 750) return reply("busy");
      this.lastArrange = now;
      const delta = this.engine.arrange();
      if (!delta) return reply("unavailable");
      this.commit(delta);
      return reply("done");
    }

    const position = "position" in payload ? payload.position : undefined;
    if (typeof position !== "object" || position === null || !("x" in position) || !("y" in position)) return reply("unavailable");
    const { x, y } = position;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y) ||
      x < this.engine.table.left || x > this.engine.table.right || y < this.engine.table.top || y > this.engine.table.bottom) return reply("unavailable");
    const tileId = "tileId" in payload ? payload.tileId : undefined;
    if (tileId != null && (typeof tileId !== "number" || !Number.isInteger(tileId) ||
      !this.engine.tiles[tileId] ||
      ![...this.engine.groups.values()].some(group => group.pieces.includes(tileId)))) {
      return reply("unavailable");
    }
    const peers = this.clients.filter(peer => peer !== client && this.players.get(peer.sessionId)?.connected);
    if (!peers.length) return reply("unavailable");
    if (now - (this.lastMarker.get(client.sessionId) ?? 0) < 750) return reply("busy");
    this.lastMarker.set(client.sessionId, now);
    const duration = "duration" in payload && payload.duration === 10000 ? 10000 : undefined;
    const marker = { position: { x, y },
      ...(tileId === undefined ? {} : { tileId }),
      ...(duration === undefined ? {} : { duration }),
    };
    for (const peer of peers) peer.send("board-marker", marker);
    reply("done");
  }
  private kickPlayer(client: Client, playerId: string) {
    if (!this.players.get(client.sessionId)?.isHost || playerId === client.sessionId) return;
    const guest = this.clients.getById(playerId);
    if (guest) {
      // A consented close releases the seat without starting automatic reconnection.
      guest.leave(CloseCode.CONSENTED, ROOM_KICK_REASON);
    } else {
      this.reconnecting.get(playerId)?.reject(new Error(ROOM_KICK_REASON));
    }
  }
  async onDrop(client:Client){
    // Keep the seat for reconnect, but release any pieces the disconnected player was holding.
    const player=this.players.get(client.sessionId);
    if(player)player.connected=false;
    this.commit(this.engine.releaseOwner(client.sessionId));
    this.broadcast("players",[...this.players.values()]);
    const reservation = this.allowReconnection(client, 60);
    this.reconnecting.set(client.sessionId, reservation);
    try { await reservation; }
    catch { /* Colyseus calls onLeave after expiration or explicit rejection. */ }
    finally {
      if (this.reconnecting.get(client.sessionId) === reservation) this.reconnecting.delete(client.sessionId);
    }
  }
  onReconnect(client:Client){
    const player=this.players.get(client.sessionId);if(player)player.connected=true;
    this.broadcast("players",[...this.players.values()]);
  }
  onLeave(client:Client){
    const wasHost = this.players.get(client.sessionId)?.isHost;
    this.lastMarker.delete(client.sessionId);
    this.collections.forget(client.sessionId);
    this.players.delete(client.sessionId);this.rates.delete(client.sessionId);this.lastActivity.delete(client.sessionId);
    // A temporary drop keeps the host's role. A permanent departure transfers it.
    if (wasHost) {
      const nextHost = this.players.values().next().value;
      if (nextHost) nextHost.isHost = true;
    }
    this.commit(this.engine.releaseOwner(client.sessionId));
    this.broadcast("players",[...this.players.values()]);
  }
  onDispose() {
    if (this.saveKey) puzzleLibrary.close(this.saveKey, this.roomId);
  }
}
