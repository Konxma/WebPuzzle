import { Client, CloseCode, type Room } from "@colyseus/sdk";
import { ROOM_KICK_REASON, type RoomCommand, type ServerEvent, type RoomSnapshot, type GameDelta, type PlayerInfo, type BoardMarker, type BoardActionResult } from "@web-pazle/shared";
import type { RoomGateway, RoomOptions } from "../../features/puzzle/models/RoomGateway";
import { InviteAddress } from "../http/InviteAddress";
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
  private readonly client=new Client(`${location.protocol==="https:"?"wss:":"ws:"}//${location.host}/realtime`);
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
      const token=sessionStorage.getItem("puzzle:"+roomId);
      if(token)try{room=await this.client.reconnect(token);}catch{sessionStorage.removeItem("puzzle:"+roomId);}
      if (!room) {
        try { room = await this.client.joinById(roomId); }
        catch (error) {
          // The previous room can disappear between the lookup and the join.
          if (!options.saveKey || await this.savedRoom(options.saveKey)) throw error;
        }
      }
    }
    room ??= await this.client.create("puzzle", options.saveKey ? { saveKey: options.saveKey } : { pieceCount: options.pieceCount, imageId: options.imageId, shape: options.shape });
    this.room=room;
    clearInterval(this.inviteHeartbeat);
    this.reportInvite(room,true);
    const activeRoom=room;
    this.inviteHeartbeat=setInterval(()=>{
      this.reportInvite(activeRoom,true);
      const before=this.shareUrl(activeRoom.roomId);
      void this.refreshShareUrl(activeRoom.roomId).then(after=>{if(this.room===activeRoom&&before!==after)onInviteChanged?.();});
    },10000);
    sessionStorage.setItem("puzzle:"+room.roomId,room.reconnectionToken);
    room.onMessage("snapshot",(snapshot:RoomSnapshot)=>listener({type:"snapshot",snapshot}));
    room.onMessage("delta",(delta:GameDelta)=>listener({type:"delta",delta}));
    room.onMessage("motion",(group:{id:string;dx:number;dy:number;owner:string|null})=>listener({type:"motion",group}));
    room.onMessage("board-marker", (marker: BoardMarker) => listener({ type: "board-marker", marker }));
    room.onMessage("board-action-result", (result: BoardActionResult) => listener({ type: "board-action-result", result }));
    room.onMessage("players",(players:PlayerInfo[])=>listener({type:"players",players}));
    room.onMessage("save-error",(message:string)=>listener({type:"error",message}));
    room.onError(()=>listener({type:"error",message:"Помилка з’єднання з кімнатою"}));
    room.onDrop(()=>onConnection(false));
    room.onReconnect(()=>{onConnection(true);room.send("sync");sessionStorage.setItem("puzzle:"+room.roomId,room.reconnectionToken);});
    room.onLeave((code, reason) => {
      if (this.room !== activeRoom) return;
      this.stopInvite(activeRoom);
      this.room = null;
      sessionStorage.removeItem("puzzle:" + activeRoom.roomId);
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
  async leave(){if(this.room){const room=this.room;this.stopInvite(room);sessionStorage.removeItem("puzzle:"+room.roomId);await room.leave();this.room=null;}}
  shareUrl(roomId:string){return this.inviteAddress.url(roomId);}
  async refreshShareUrl(roomId:string){await this.inviteAddress.refresh();return this.shareUrl(roomId);}
}
