import { ObservableViewModel } from "../../../shared/mvvm/ObservableViewModel";
import { type FieldSize, BOARD_MARKER_DURATION, DEFAULT_IMAGE_ID, type BoardMarkerDuration, type BoardActionResult, type BoardMarker, type RoomCommand, generateTiles,
  type PuzzleShape, type Tile, type PuzzleGroup, type RoomSnapshot, type ServerEvent, type PlayerInfo } from "@web-pazle/shared";
import type { BoardArea, CameraView, PuzzleViewPreferences } from "../models/PuzzleViewPreferences";
import type { RoomGateway, RoomOptions } from "../models/RoomGateway";
import type { SavedPuzzleCatalog } from "../../lobby/models/PuzzleFiles";
export interface PuzzleScreenState {
  screen:"lobby"|"connecting"|"game"|"error";error:string|null;
  roomId:string;shareUrl:string;selfId:string;players:PlayerInfo[];
  fieldSize:FieldSize; pieceCount:number;placed:number;connected:boolean;showReference:boolean;inviteCopied:boolean;
  marker: (BoardMarker & { local?: boolean }) | null;
  markerDuration: BoardMarkerDuration;
  markerShortcut: boolean;
  markerKey: string;
  boardNotice: string | null;
  canUndoCollection: boolean;
  imageId: string; edgesOnly: boolean;
  slideToEdge: boolean; traysEnabled: boolean; viewingTray: boolean;
}
export interface BoardData { tiles:Tile[];groups:Map<string,PuzzleGroup>;selfId:string;imageId:string;puzzleId:string }
export type BoardChange={kind:"structure"}|{kind:"visibility"}|{kind:"motion";groupId:string};
export class PuzzleViewModel extends ObservableViewModel<PuzzleScreenState>{
  board:BoardData|null=null;
  private boardListeners=new Set<(change:BoardChange)=>void>();
  private lastMove=0;
  private nextActionId = 0;
  private pendingAction?: { id: number; type: "point-at" | "arrange-pieces" | "undo-arrange" | "undo-collection" };
  private noticeTimer?: ReturnType<typeof setTimeout>;
  constructor(private readonly gateway:RoomGateway, private readonly copyText:(value:string)=>Promise<void>, private readonly saves:SavedPuzzleCatalog,
    private readonly viewPreferences: PuzzleViewPreferences){
    super({screen:"lobby",error:null,roomId:"",shareUrl:"",selfId:"",players:[],fieldSize:1,pieceCount:0,placed:0,connected:false,showReference:false,inviteCopied:false,
      marker:null,markerDuration:BOARD_MARKER_DURATION,markerShortcut:false,markerKey:"M",boardNotice:null,canUndoCollection:false,imageId:DEFAULT_IMAGE_ID,edgesOnly:false,slideToEdge:false,traysEnabled:true,viewingTray:false});
  }
  onBoardChange=(listener:(change:BoardChange)=>void)=>{this.boardListeners.add(listener);return()=>{this.boardListeners.delete(listener);};};
  private notifyBoard(change:BoardChange={kind:"structure"}){for(const listener of this.boardListeners)listener(change);}
  create=(pieceCount:number,imageId?:string,shape?:PuzzleShape)=>this.connect({pieceCount,imageId,shape});
  join=(roomId:string)=>this.connect({roomId});
  resume=(saveKey:string)=>this.connect({saveKey});
  private async connect(options:RoomOptions){
    this.resetBoardAction();
    this.setState({...this.getSnapshot(),screen:"connecting",roomId:options.roomId ?? "",error:null,marker:null,boardNotice:null,edgesOnly:false,showReference:false});
    try{await this.gateway.connect(options,this.receive,connected=>{
      this.setState({...this.getSnapshot(),connected});if(!connected)this.notifyBoard();
    },()=>{
      const state=this.getSnapshot();
      if(state.screen==="game")this.setState({...state,shareUrl:this.gateway.shareUrl(state.roomId),inviteCopied:false});
    });}catch(cause){
      const locked = cause instanceof Error && /room .* is locked/i.test(cause.message);
      const error = locked ? "У кімнаті зайняті всі місця. Якщо ти щойно повернувся, зачекай кілька секунд і спробуй ще раз."
        : options.saveKey ? "Не вдалося відкрити збереження. Перевірте, чи гра запущена на тому самому ПК і чи в кімнаті є вільне місце."
        : "Не вдалося відкрити кімнату. Перевірте посилання: кімната може бути заповнена або вже закрита.";
      this.setState({...this.getSnapshot(),screen:"error",error});
    }
  }
  private receive=(event:ServerEvent)=>{
    const state=this.getSnapshot();
    if(event.type==="snapshot"){
      const data:RoomSnapshot=event.snapshot;
      // Both clients rebuild the same outlines from the server's piece count and seed.
      const { id: puzzleId, imageId, pieceCount, seed, shape } = data.definition;
      let error = state.error;
      if (data.saveKey) {
        try { this.saves.remember({ key: data.saveKey, imageId, pieceCount, openedAt: Date.now() }); }
        catch { error = "Браузер не зберіг посилання для продовження гри."; }
      }
      this.board={tiles:generateTiles(pieceCount,seed,shape),groups:new Map(data.groups.map(g=>[g.id,g])),selfId:data.selfId,imageId,puzzleId};
      const preferences = this.viewPreferences.read(puzzleId);
      const sameRoom = state.screen === "game" && state.roomId === data.roomId;
      const markerDuration = sameRoom ? state.markerDuration : preferences.markerDuration ?? BOARD_MARKER_DURATION;
      const markerShortcut = sameRoom ? state.markerShortcut : preferences.markerShortcut === true;
      const markerKey = sameRoom ? state.markerKey : preferences.markerKey ?? "M";
      this.setState({...state,canUndoCollection:data.canUndoCollection === true,slideToEdge:sameRoom ? state.slideToEdge : preferences.slideToEdge ?? false,traysEnabled:sameRoom ? state.traysEnabled : preferences.traysEnabled ?? true,viewingTray:sameRoom && state.viewingTray,fieldSize:data.fieldSize ?? 1,markerDuration,markerShortcut,markerKey,screen:"game",roomId:data.roomId,shareUrl:this.gateway.shareUrl(data.roomId),selfId:data.selfId,players:data.players,pieceCount,imageId,error,placed:data.groups.filter(g=>g.placed).reduce((sum,g)=>sum+g.pieces.length,0),connected:true});
      this.notifyBoard();
    }else if(event.type==="delta"&&this.board){
      const { groups, removed } = event.delta;
      const boardChanged = groups.length > 0 || removed.length > 0;
      for (const id of removed) this.board.groups.delete(id);
      for (const group of groups) this.board.groups.set(group.id, group);
      const placed = boardChanged
        ? [...this.board.groups.values()].reduce((sum, group) => sum + (group.placed ? group.pieces.length : 0), 0)
        : state.placed;
      const fieldSize = event.delta.fieldSize ?? state.fieldSize;
      if (placed !== state.placed || fieldSize !== state.fieldSize) this.setState({ ...state, placed, fieldSize });
      if (boardChanged || fieldSize !== state.fieldSize) this.notifyBoard();
    }else if(event.type==="motion"&&this.board){
      // PixiJS can move this one group without causing a React render.
      const previous=this.board.groups.get(event.group.id);if(previous){this.board.groups.set(previous.id,{...previous,...event.group});this.notifyBoard({kind:"motion",groupId:previous.id});}
    }else if(event.type==="players")this.setState({...state,players:event.players});
    else if (event.type === "board-marker") this.setState({ ...state, marker: event.marker });
    else if (event.type === "collection-undo") this.setState({ ...state, canUndoCollection: event.available });
    else if (event.type === "board-action-result") this.receiveBoardAction(event.result);
    else if (event.type === "closed") {
      this.board = null;
      this.setState({ ...state, screen: "error", connected: false, error: event.message,
        roomId: event.message === "Власник видалив вас із кімнати." ? "" : state.roomId });
    }
    else if(event.type==="error")this.setState({...state,error:event.message});
  };
  collect(ids: string[], action: "move" | "store" | "restore", x = 0, y = 0) {
    if (this.getSnapshot().connected && ids.length) this.gateway.send({ type: "collection", ids, action: action === "move" && this.getSnapshot().slideToEdge ? "slide" : action, x, y });
  }
  resizeField(size: FieldSize) {
    if (this.getSnapshot().connected) this.gateway.send({type:"resize-field",size});
  }
  grab=(id:string,additional=false)=>{if(this.getSnapshot().connected)this.gateway.send({type:"grab-group",groupId:id,additional});};
  moveFingers(positions: { id: string; x: number; y: number }[]) {
    if (this.getSnapshot().connected) this.gateway.send({ type: "move-fingers", positions });
  }
  move=(id:string,x:number,y:number)=>{
    if(!this.getSnapshot().connected||performance.now()-this.lastMove<50)return;
    this.lastMove=performance.now();this.gateway.send({type:"move-group",groupId:id,position:{x,y}});
  };
  release=(id:string,x:number,y:number)=>{if(this.getSnapshot().connected)this.gateway.send({type:"release-group",groupId:id,position:{x,y}});};
  cancelDrag(id: string, x: number, y: number) {
    if (this.getSnapshot().connected) this.gateway.send({ type: "cancel-group", groupId: id, position: { x, y } });
  }
  cameraPreferences() {
    const id = this.board?.puzzleId;
    return id ? {
      read: (area: BoardArea) => {
        const preferences = this.viewPreferences.read(id);
        return area === "table" ? preferences.camera : preferences.trayCamera;
      },
      save: (area: BoardArea, camera: CameraView) =>
        this.viewPreferences.update(id, area === "table" ? { camera } : { trayCamera: camera }),
    } : undefined;
  }
  private resetBoardAction() {
    clearTimeout(this.noticeTimer);
    this.pendingAction = undefined;
  }
  showBoardNotice = (boardNotice: string) => {
    this.resetBoardAction();
    this.setState({ ...this.getSnapshot(), boardNotice });
    this.noticeTimer = setTimeout(() => this.setState({ ...this.getSnapshot(), boardNotice: null }), 4500);
  };
  private sendBoardAction(command: Extract<RoomCommand, { type: "point-at" | "arrange-pieces" | "undo-arrange" | "undo-collection" }>) {
    const state = this.getSnapshot();
    if (!state.connected) return this.showBoardNotice("Зачекай, поки відновиться зв’язок із кімнатою");
    this.resetBoardAction();
    const id = ++this.nextActionId;
    this.pendingAction = { id, type: command.type };
    this.setState({ ...state, boardNotice: command.type === "point-at" ? "Надсилаємо позначку…" :
      command.type.startsWith("undo-") ? "Повертаємо деталі…" : "Розкладаємо деталі…" });
    this.noticeTimer = setTimeout(() => this.showBoardNotice(
      "Кімната не відповіла. Якщо гру щойно оновили, закрий і знову запусти Start.cmd."
    ), 2800);
    this.gateway.send({ ...command, requestId: id });
  }
  private receiveBoardAction({ requestId, outcome }: BoardActionResult) {
    if (this.pendingAction?.id !== requestId) return;
    const marker = this.pendingAction.type === "point-at";
    const undoCollection = this.pendingAction.type === "undo-collection";
    const undo = undoCollection || this.pendingAction.type === "undo-arrange";
    if (outcome === "busy") return this.showBoardNotice("Зачекай мить і спробуй ще раз");
    if (outcome === "done") return this.showBoardNotice(marker ? "Позначку надіслано гравцям" :
      undo ? "Деталі повернуто на попередні місця" : "Вільні деталі розкладено");
    this.showBoardNotice(marker ? "Позначка недоступна. Перевір, чи напарник ще в кімнаті."
      : undoCollection ? "Це переміщення вже не можна скасувати"
        : undo ? "Немає розкладання, яке можна скасувати"
        : "Немає деталей, які можна розкласти, або вони вже розкладені");
  }
  setMarkerPreferences = (markerDuration: BoardMarkerDuration, markerShortcut: boolean, markerKey: string) => {
    this.setState({ ...this.getSnapshot(), markerDuration, markerShortcut, markerKey });
    if (this.board) this.viewPreferences.update(this.board.puzzleId, { markerDuration, markerShortcut, markerKey });
  };
  pointAt = (tileId: number | null, position: BoardMarker["position"]) => {
    const state = this.getSnapshot();
    if (!state.connected) return;
    const marker = { position, tileId };
    this.setState({ ...state, marker: { ...marker, local: true } });
    this.sendBoardAction({ type: "point-at", ...marker, duration: state.markerDuration });
  };
  clearMarker = (marker: BoardMarker) => {
    const state = this.getSnapshot();
    if (state.marker === marker) this.setState({ ...state, marker: null });
  };
  arrangePieces = () => this.sendBoardAction({ type: "arrange-pieces" });
  undoCollection = () => this.sendBoardAction({ type: "undo-collection" });
  undoArrange = () => this.sendBoardAction({ type: "undo-arrange" });
  toggleEdges = () => {
    this.setState({ ...this.getSnapshot(), edgesOnly: !this.getSnapshot().edgesOnly });
    this.notifyBoard({ kind: "visibility" });
  };
  setSlideToEdge(enabled: boolean) {
    this.setState({...this.getSnapshot(), slideToEdge:enabled});
    if (this.board) this.viewPreferences.update(this.board.puzzleId,{slideToEdge:enabled});
  }
  setTraysEnabled(enabled: boolean) {
    const state = this.getSnapshot();
    if (state.traysEnabled === enabled) return;
    this.setState({...state,traysEnabled:enabled,viewingTray:enabled && state.viewingTray});
    if (this.board) this.viewPreferences.update(this.board.puzzleId,{traysEnabled:enabled});
    this.notifyBoard({kind:"visibility"});
  }
  showTray(open: boolean) {
    const state = this.getSnapshot();
    if (state.viewingTray === open || (open && !state.traysEnabled)) return;
    this.setState({...state,viewingTray:open});
    this.notifyBoard({kind:"visibility"});
  }
  isGroupVisible(group: PuzzleGroup) {
    const { edgesOnly, viewingTray } = this.getSnapshot();
    if (viewingTray) return group.stored === true;
    return !group.stored && (!edgesOnly || group.pieces.some(id => this.board?.tiles[id]?.edge));
  }
  kickPlayer = (playerId: string) => {
    const { connected, players, selfId } = this.getSnapshot();
    if (connected && playerId !== selfId && players.some(player => player.id === selfId && player.isHost)) {
      this.gateway.send({ type: "kick-player", playerId });
    }
  };
  copyInvite=async()=>{
    const roomId=this.getSnapshot().roomId;
    const shareUrl=await this.gateway.refreshShareUrl(roomId);
    if(this.getSnapshot().roomId!==roomId||this.getSnapshot().screen!=="game")return;
    this.setState({...this.getSnapshot(),shareUrl,inviteCopied:false,error:null});
    if(!shareUrl){this.setState({...this.getSnapshot(),error:"Не вдалося визначити локальну адресу. Відкрийте гру за адресою з вікна Start.cmd."});return;}
    try{await this.copyText(shareUrl);this.setState({...this.getSnapshot(),inviteCopied:true});}
    catch{this.setState({...this.getSnapshot(),error:"Виділіть посилання та скопіюйте його вручну"});}
  };
  toggleReference=()=>this.setState({...this.getSnapshot(),showReference:!this.getSnapshot().showReference});
  leave=async()=>{this.resetBoardAction();await this.gateway.leave();this.board=null;this.setState({...this.getSnapshot(),screen:"lobby",roomId:"",error:null});};
}
