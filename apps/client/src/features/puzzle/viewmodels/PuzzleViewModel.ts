import { ObservableViewModel } from "../../../shared/mvvm/ObservableViewModel";
import { BOARD_MARKER_DURATION, DEFAULT_IMAGE_ID, type BoardMarkerDuration, DEFAULT_PUZZLE_FEATURES, type BoardActionResult, type BoardMarker, type RoomCommand, featuresForSnapshot, generateTiles, normalizeTrayName,
  type PuzzleFeatures, type PuzzleOptions, MAX_PUZZLE_TRAYS, traysForSnapshot, type PuzzleShape, type PuzzleTray, type Tile, type PuzzleGroup, type RoomSnapshot, type ServerEvent, type PlayerInfo } from "@web-pazle/shared";
import type { CameraView, PuzzleViewPreferences } from "../models/PuzzleViewPreferences";
import type { RoomGateway, RoomOptions } from "../models/RoomGateway";
import type { SavedPuzzleCatalog } from "../../lobby/models/PuzzleFiles";
export interface PuzzleScreenState {
  screen:"lobby"|"connecting"|"game"|"error";error:string|null;
  roomId:string;shareUrl:string;selfId:string;players:PlayerInfo[];
  pieceCount:number;placed:number;connected:boolean;showReference:boolean;inviteCopied:boolean;
  marker: (BoardMarker & { local?: boolean }) | null;
  markerDuration: BoardMarkerDuration;
  markerShortcut: boolean;
  markerKey: string;
  boardNotice: string | null;
  imageId: string; features: PuzzleFeatures; trayNames: NonNullable<PuzzleOptions["trayNames"]>; trays: PuzzleTray[]; trayView: PuzzleTray | null; edgesOnly: boolean;
}
export interface BoardData { tiles:Tile[];groups:Map<string,PuzzleGroup>;selfId:string;imageId:string;puzzleId:string }
export type BoardChange={kind:"structure"}|{kind:"visibility"}|{kind:"motion";groupId:string};
export class PuzzleViewModel extends ObservableViewModel<PuzzleScreenState>{
  board:BoardData|null=null;
  private boardListeners=new Set<(change:BoardChange)=>void>();
  private lastMove=0;
  private nextActionId = 0;
  private pendingAction?: { id: number; type: "point-at" | "arrange-pieces" | "undo-arrange" };
  private noticeTimer?: ReturnType<typeof setTimeout>;
  constructor(private readonly gateway:RoomGateway, private readonly copyText:(value:string)=>Promise<void>, private readonly saves:SavedPuzzleCatalog,
    private readonly viewPreferences: PuzzleViewPreferences){
    super({screen:"lobby",error:null,roomId:"",shareUrl:"",selfId:"",players:[],pieceCount:0,placed:0,connected:false,showReference:false,inviteCopied:false,
      marker:null,markerDuration:BOARD_MARKER_DURATION,markerShortcut:false,markerKey:"M",boardNotice:null,imageId:DEFAULT_IMAGE_ID,features:DEFAULT_PUZZLE_FEATURES,trayNames:{},trays:[],trayView:null,edgesOnly:false});
  }
  onBoardChange=(listener:(change:BoardChange)=>void)=>{this.boardListeners.add(listener);return()=>{this.boardListeners.delete(listener);};};
  private notifyBoard(change:BoardChange={kind:"structure"}){for(const listener of this.boardListeners)listener(change);}
  create=(pieceCount:number,imageId?:string,shape?:PuzzleShape)=>this.connect({pieceCount,imageId,shape});
  join=(roomId:string)=>this.connect({roomId});
  resume=(saveKey:string)=>this.connect({saveKey});
  private async connect(options:RoomOptions){
    this.resetBoardAction();
    this.setState({...this.getSnapshot(),screen:"connecting",error:null,marker:null,boardNotice:null,edgesOnly:false,trayView:null,showReference:false});
    try{await this.gateway.connect(options,this.receive,connected=>{
      this.setState({...this.getSnapshot(),connected});if(!connected)this.notifyBoard();
    },()=>{
      const state=this.getSnapshot();
      if(state.screen==="game")this.setState({...state,shareUrl:this.gateway.shareUrl(state.roomId),inviteCopied:false});
    });}catch{
      const error = options.saveKey ? "Не вдалося відкрити збереження. Перевірте, чи гра запущена на тому самому ПК і чи в кімнаті є вільне місце."
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
      const trays = traysForSnapshot(data);
      const features = featuresForSnapshot(data, trays);
      const preferences = this.viewPreferences.read(puzzleId);
      const sameRoom = state.screen === "game" && state.roomId === data.roomId;
      const previousTray = sameRoom ? state.trayView : preferences.tray;
      const markerDuration = sameRoom ? state.markerDuration : preferences.markerDuration ?? BOARD_MARKER_DURATION;
      const trayView = features.trays && previousTray && trays.includes(previousTray) ? previousTray : null;
      const markerShortcut = sameRoom ? state.markerShortcut : preferences.markerShortcut === true;
      const markerKey = sameRoom ? state.markerKey : preferences.markerKey ?? "M";
      this.setState({...state,trays,trayView,markerDuration,markerShortcut,markerKey,features,trayNames:data.trayNames??{},screen:"game",roomId:data.roomId,shareUrl:this.gateway.shareUrl(data.roomId),selfId:data.selfId,players:data.players,pieceCount,imageId,error,placed:data.groups.filter(g=>g.placed).reduce((sum,g)=>sum+g.pieces.length,0),connected:true});
      this.notifyBoard();
    }else if(event.type==="delta"&&this.board){
      const { groups, removed, trays = state.trays, features = state.features, trayNames = state.trayNames } = event.delta;
      const trayView = features.trays && state.trayView && trays.includes(state.trayView) ? state.trayView : null;
      const boardChanged = groups.length > 0 || removed.length > 0;
      for (const id of removed) this.board.groups.delete(id);
      for (const group of groups) this.board.groups.set(group.id, group);
      const placed = boardChanged
        ? [...this.board.groups.values()].reduce((sum, group) => sum + (group.placed ? group.pieces.length : 0), 0)
        : state.placed;
      if (trays !== state.trays || features !== state.features || trayNames !== state.trayNames || placed !== state.placed) {
        this.setState({ ...state, trays, trayView, placed, features, trayNames });
      }
      if (trayView !== state.trayView) this.viewPreferences.update(this.board.puzzleId, { tray: trayView });
      if (boardChanged) this.notifyBoard();
      else if (trayView !== state.trayView) this.notifyBoard({ kind: "visibility" });
    }else if(event.type==="motion"&&this.board){
      // PixiJS can move this one group without causing a React render.
      const previous=this.board.groups.get(event.group.id);if(previous){this.board.groups.set(previous.id,{...previous,...event.group});this.notifyBoard({kind:"motion",groupId:previous.id});}
    }else if(event.type==="players")this.setState({...state,players:event.players});
    else if (event.type === "board-marker") this.setState({ ...state, marker: event.marker });
    else if (event.type === "board-action-result") this.receiveBoardAction(event.result);
    else if (event.type === "closed") {
      this.board = null;
      this.setState({ ...state, screen: "error", roomId: "", connected: false, error: event.message });
    }
    else if(event.type==="error")this.setState({...state,error:event.message});
  };
  grab=(id:string)=>{if(this.getSnapshot().connected)this.gateway.send({type:"grab-group",groupId:id});};
  move=(id:string,x:number,y:number)=>{
    if(!this.getSnapshot().connected||performance.now()-this.lastMove<50)return;
    this.lastMove=performance.now();this.gateway.send({type:"move-group",groupId:id,position:{x,y}});
  };
  release=(id:string,x:number,y:number)=>{if(this.getSnapshot().connected)this.gateway.send({type:"release-group",groupId:id,position:{x,y}});};
  stash(id: string, tray: PuzzleTray | null, x: number, y: number) {
    if (this.getSnapshot().connected) this.gateway.send({ type: "stash-group", groupId: id, tray, position: { x, y } });
  }
  createTray = () => {
    const { connected, trays, features } = this.getSnapshot();
    if (connected && features.trays && trays.length < MAX_PUZZLE_TRAYS) this.gateway.send({ type: "create-tray" });
  };
  deleteTray = (tray: PuzzleTray) => {
    const { connected, trays, features } = this.getSnapshot();
    if (connected && features.trays && trays.includes(tray)) this.gateway.send({ type: "delete-tray", tray });
  };
  renameTray = (tray: PuzzleTray, value: string) => {
    const { connected, trays, features } = this.getSnapshot();
    const name = normalizeTrayName(value);
    if (!connected || !features.trays || !trays.includes(tray) || !name) return false;
    this.gateway.send({ type: "rename-tray", tray, name });
    return true;
  };
  configureFeatures = (features: PuzzleFeatures) => {
    const state = this.getSnapshot();
    if (state.connected && state.players.some(player => player.id === state.selfId && player.isHost)) {
      this.gateway.send({ type: "configure-features", features });
    }
  };
  cameraPreferences() {
    const id = this.board?.puzzleId;
    return id ? {
      initial: this.viewPreferences.read(id).camera,
      save: (camera: CameraView) => this.viewPreferences.update(id, { camera }),
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
  private sendBoardAction(command: Extract<RoomCommand, { type: "point-at" | "arrange-pieces" | "undo-arrange" }>) {
    const state = this.getSnapshot();
    if (!state.connected) return this.showBoardNotice("Зачекай, поки відновиться зв’язок із кімнатою");
    this.resetBoardAction();
    const id = ++this.nextActionId;
    this.pendingAction = { id, type: command.type };
    this.setState({ ...state, boardNotice: command.type === "point-at" ? "Надсилаємо позначку…" :
      command.type === "undo-arrange" ? "Повертаємо деталі…" : "Розкладаємо деталі…" });
    this.noticeTimer = setTimeout(() => this.showBoardNotice(
      "Кімната не відповіла. Якщо гру щойно оновили, закрий і знову запусти Start.cmd."
    ), 2800);
    this.gateway.send({ ...command, requestId: id });
  }
  private receiveBoardAction({ requestId, outcome }: BoardActionResult) {
    if (this.pendingAction?.id !== requestId) return;
    const marker = this.pendingAction.type === "point-at";
    const undo = this.pendingAction.type === "undo-arrange";
    if (outcome === "busy") return this.showBoardNotice("Зачекай мить і спробуй ще раз");
    if (outcome === "done") return this.showBoardNotice(marker ? "Позначку надіслано напарнику" :
      undo ? "Деталі повернуто на попередні місця" : "Вільні деталі розкладено");
    this.showBoardNotice(marker ? "Позначка недоступна. Перевір, чи напарник ще в кімнаті."
      : undo ? "На цій ділянці немає розкладання, яке можна скасувати"
        : "Немає деталей, які можна розкласти, або вони вже розкладені");
  }
  setMarkerPreferences = (markerDuration: BoardMarkerDuration, markerShortcut: boolean, markerKey: string) => {
    this.setState({ ...this.getSnapshot(), markerDuration, markerShortcut, markerKey });
    if (this.board) this.viewPreferences.update(this.board.puzzleId, { markerDuration, markerShortcut, markerKey });
  };
  pointAt = (tileId: number | null, position: BoardMarker["position"]) => {
    const state = this.getSnapshot();
    if (!state.connected) return;
    const marker = { position, tileId, tray: state.trayView };
    this.setState({ ...state, marker: { ...marker, local: true } });
    this.sendBoardAction({ type: "point-at", ...marker, duration: state.markerDuration });
  };
  clearMarker = (marker: BoardMarker) => {
    const state = this.getSnapshot();
    if (state.marker === marker) this.setState({ ...state, marker: null });
  };
  arrangePieces = () => this.sendBoardAction({ type: "arrange-pieces", tray: this.getSnapshot().trayView });
  undoArrange = () => this.sendBoardAction({ type: "undo-arrange", tray: this.getSnapshot().trayView });
  showTray = (trayView: PuzzleTray | null) => {
    this.setState({ ...this.getSnapshot(), trayView });
    if (this.board) this.viewPreferences.update(this.board.puzzleId, { tray: trayView });
    this.notifyBoard({ kind: "visibility" });
  };
  toggleEdges = () => {
    this.setState({ ...this.getSnapshot(), edgesOnly: !this.getSnapshot().edgesOnly });
    this.notifyBoard({ kind: "visibility" });
  };
  isGroupVisible(group: PuzzleGroup) {
    const { trayView, edgesOnly } = this.getSnapshot();
    return (group.tray ?? null) === trayView && (!edgesOnly || group.pieces.some(id => this.board?.tiles[id]?.edge));
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
