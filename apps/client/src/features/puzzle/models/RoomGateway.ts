import type { PuzzleShape, RoomCommand, ServerEvent } from "@web-pazle/shared";
export interface RoomOptions { pieceCount?:number; roomId?:string; imageId?:string; saveKey?:string; shape?:PuzzleShape }
export interface RoomGateway {
  connect(options:RoomOptions,listener:(event:ServerEvent)=>void,onConnection:(online:boolean)=>void,onInviteChanged?:()=>void):Promise<void>;
  send(command:RoomCommand):void;
  leave():Promise<void>;
  shareUrl(roomId:string):string;
  refreshShareUrl(roomId:string):Promise<string>;
}
