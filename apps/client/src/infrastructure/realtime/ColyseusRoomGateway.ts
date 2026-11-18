import { Client, CloseCode, type Room } from "@colyseus/sdk";
import { ROOM_KICK_REASON, type RoomCommand, type ServerEvent, type RoomSnapshot, type GameDelta, type PlayerInfo, type BoardMarker, type BoardActionResult, type GroupMotion } from "@web-pazle/shared";
import type { RoomGateway, RoomOptions } from "../../features/puzzle/models/RoomGateway";
import { InviteAddress } from "../http/InviteAddress";
const tokenKey = (roomId: string) => "puzzle:" + roomId;
type SavedSeat = { token: string; validUntil: number };

function savedSeat(roomId: string): SavedSeat | null {
  try {
    const seat = JSON.parse(localStorage.getItem(tokenKey(roomId)) ?? "null");
    return typeof seat?.token === "string" && seat.validUntil > Date.now() ? seat : null;
  } catch { return null; }
}

function rememberSeat(room: Room) {
  const key = tokenKey(room.roomId);
  try { sessionStorage.setItem(key, room.reconnectionToken); } catch { /* Storage can be disabled. */ }
  try {
    const seat: SavedSeat = { token: room.reconnectionToken, validUntil: Date.now() + 5 * 60_000 };
    localStorage.setItem(key, JSON.stringify(seat));
  } catch { /* The tab token still works. */ }
}

function forgetSeat(room: Room) {
  const key = tokenKey(room.roomId);
  try {
    if (sessionStorage.getItem(key) === room.reconnectionToken) sessionStorage.removeItem(key);
  } catch { /* Storage can be disabled. */ }
  try {
    if (savedSeat(room.roomId)?.token === room.reconnectionToken) localStorage.removeItem(key);
  } catch { /* Storage can be disabled. */ }
}

export class ColyseusRoomGateway implements RoomGateway {
  private room:Room|null=null;
  private readonly inviteAddress=new InviteAddress(location.origin);
  private inviteHeartbeat:ReturnType<typeof setInterval>|undefined;
  private reportInvite(room:Room,active:boolean){
    void fetch("/api/lan-invite",{method:"POST",keepalive:true,headers:{"Content-Type":"application/json"},
      body:JSON.stringify({sessionId:room.sessionId,roomId:active?room.roomId:null}),signal:AbortSignal.timeout(2000)}).catch(()=>{});
  }
  private stopInvite(room:Room){
    clearInterval(this.inviteHeartbeat);this.inviteHeartbeat=undefined;this.reportInvite(room,false);
  }
  private readonly client = new Client(
    document.querySelector('meta[name="webpuzzle-realtime"]') ? location.origin
      : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/realtime`,
  );
  private async savedRoom(key: string): Promise<string | null> {
    const response = await fetch(`/api/saves/${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!response.ok) throw new Error("Save unavailable");
    return (await response.json()).roomId;
  }
  async connect(options:RoomOptions,listener:(event:ServerEvent)=>void,onConnection:(online:boolean)=>void,onInviteChanged?:()=>void){
    await this.inviteAddress.refresh();
    let room:Room|undefined;
    const roomId = options.saveKey ? await this.savedRoom(options.saveKey) : options.roomId;
    if(roomId){
      let token = savedSeat(roomId)?.token;
      try { token = sessionStorage.getItem(tokenKey(roomId)) ?? token; } catch { /* Use the saved seat. */ }
      const deadline = Date.now() + 12_000;
      while (!room) {
        if (token) try { room = await this.client.reconnect(token); } catch { /* The old socket may still be closing. */ }
        if (room) break;
        try { room = await this.client.joinById(roomId); }
        catch (error) {
          // The previous room can disappear between the lookup and the join.
          if (options.saveKey && !await this.savedRoom(options.saveKey)) break;
          const locked = error instanceof Error && /room .* is locked/i.test(error.message);
          if (!token || !locked || Date.now() >= deadline) throw error;
          await new Promise(resolve => setTimeout(resolve, 1_000));
        }
      }
    }
    room ??= await this.client.create("puzzle", options.saveKey ? { saveKey: options.saveKey } : { pieceCount: options.pieceCount, imageId: options.imageId, shape: options.shape });
    this.room=room;
    clearInterval(this.inviteHeartbeat);
    this.reportInvite(room,true);
    const activeRoom=room;
    this.inviteHeartbeat=setInterval(()=>{
      if (activeRoom.connection.isOpen) rememberSeat(activeRoom);
      this.reportInvite(activeRoom,true);
      const before=this.shareUrl(activeRoom.roomId);
      void this.refreshShareUrl(activeRoom.roomId).then(after=>{if(this.room===activeRoom&&before!==after)onInviteChanged?.();});
    },10000);
    rememberSeat(room);
    room.onMessage("snapshot",(snapshot:RoomSnapshot)=>listener({type:"snapshot",snapshot}));
    room.onMessage("delta",(delta:GameDelta)=>listener({type:"delta",delta}));
    room.onMessage("motion", (group: GroupMotion) => listener({ type: "motion", group }));
    room.onMessage("motion-batch", (groups: GroupMotion[]) => {
      for (const group of groups) {
        if (group.owner !== room.sessionId) listener({ type: "motion", group });
      }
    });
    room.onMessage("board-marker", (marker: BoardMarker) => listener({ type: "board-marker", marker }));
    room.onMessage("board-action-result", (result: BoardActionResult) => listener({ type: "board-action-result", result }));
    room.onMessage("players",(players:PlayerInfo[])=>listener({type:"players",players}));
    room.onMessage("save-error",(message:string)=>listener({type:"error",message}));
    room.onError(()=>listener({type:"error",message:"Помилка з’єднання з кімнатою"}));
    room.onDrop(()=>onConnection(false));
    room.onReconnect(()=>{onConnection(true);room.send("sync");rememberSeat(room);});
    room.onLeave((code, reason) => {
      if (this.room !== activeRoom) return;
      this.stopInvite(activeRoom);
      this.room = null;
      if (code === CloseCode.CONSENTED || reason === ROOM_KICK_REASON) forgetSeat(activeRoom);
      onConnection(false);
      if (reason === ROOM_KICK_REASON) {
        listener({ type: "closed", message: "Власник видалив вас із кімнати." });
      } else if (code !== CloseCode.CONSENTED) {
        listener({ type: "closed", message: "З’єднання з кімнатою завершено. Поверніться на головну, щоб приєднатися знову." });
      }
    });
    onConnection(true);
    // Subscribe before asking for the initial snapshot so the board cannot miss it.
    room.send("sync");
  }
  send(command:RoomCommand){this.room?.send("command",command);}
  async leave(){if(this.room){const room=this.room;this.stopInvite(room);forgetSeat(room);await room.leave();this.room=null;}}
  shareUrl(roomId:string){return this.inviteAddress.url(roomId);}
  async refreshShareUrl(roomId:string){await this.inviteAddress.refresh();return this.shareUrl(roomId);}
}
