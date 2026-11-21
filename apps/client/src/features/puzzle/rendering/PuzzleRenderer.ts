import { createBoardCollection } from "./BoardCollection";
import { createBoardTouchInput } from "./BoardTouchInput";
import { createBoardHints } from "./BoardHints";
import { GroupSurfaceTextures } from "./GroupSurfaceTextures";
import { FrameScheduler } from "./FrameScheduler";
import { SharpPieceTextures, type DetailPiece } from "./SharpPieceTextures";
import { loadPuzzleArtwork } from "./PuzzleArtwork";
import { watchDisplayDensity } from "./displayDensity";
import { createPieceAtlas } from "./PieceAtlas";
import { Application, Container, Graphics, Rectangle, Sprite, Texture, type FederatedPointerEvent } from "pixi.js";
import { BOARD_MARKER_DURATION, BOARD_WIDTH, BOARD_HEIGHT, fieldBounds, clampGroupToTable, puzzleGroupBounds, type BoardMarker, type PuzzleBounds, type PuzzleGroup, type Tile } from "@web-pazle/shared";
import { createBoardCamera, type BoardCameraPreferences } from "./BoardCamera";
import type { BoardChange, PuzzleViewModel } from "../viewmodels/PuzzleViewModel";
export interface BoardControls { cameraLocked: boolean; clickToCarry: boolean }
export interface PuzzleRenderer {
  setReferenceComparison(listener?: (tile: Tile | undefined) => void): void;
  zoom(factor: number): void;
  fit(): void;
  refreshPalette(): void;
  setCollectionMode(active: boolean): void;
  storeSelected(): void;
  restoreTray(): void;
  setControls(controls: BoardControls): void;
  armMarker(onDone: () => void): boolean;
  showHint(tileId: number): void;
  clearHint(): void;
  showMarker(marker: BoardMarker | null, duration?: number): void;
  centerOnMarker(marker: BoardMarker): void;
  dispose(): void;
}
export async function createPuzzleRenderer(
  host: HTMLElement,
  vm: PuzzleViewModel,
  cameraPreferences?: BoardCameraPreferences,
  reportCollection?: (selected: number, stored: number) => void,
): Promise<PuzzleRenderer> {
  const data=vm.board;if(!data)throw new Error("No puzzle state");
  const tiles=data.tiles;
  let fieldSize = vm.getSnapshot().fieldSize ?? 1;
  let table = fieldBounds(fieldSize);
  const selfId=data.selfId;
  const artwork = await loadPuzzleArtwork(data.imageId);
  const app=new Application();
  const initialSize = host.getBoundingClientRect();
  const background = getComputedStyle(host).getPropertyValue("--board-background").trim();
  // Match the display's pixel density so the browser does not downsample the finished board.
  await app.init({width:initialSize.width,height:initialSize.height,background,backgroundAlpha:1,
    antialias:true,autoDensity:true,resolution:devicePixelRatio,preference:"webgl",autoStart:false});
  let disposed=false;
  const debugRender=new URLSearchParams(location.search).has("debugRender");
  let renderedFrames=0;
  const frames=new FrameScheduler(()=>{
    applyMove();
    if (pinch) updatePinch();
    else atlas.refresh(camera.scale.x);
    app.render();
    updateReferenceComparison();
    hints.draw();
    if(debugRender){
      app.canvas.dataset.renderedFrames=String(++renderedFrames);
      app.canvas.dataset.zoom=String(camera.scale.x);
      app.canvas.dataset.cameraX=String(camera.x);
      app.canvas.dataset.cameraY=String(camera.y);
      app.canvas.dataset.resolution=String(app.renderer.resolution);
      app.canvas.dataset.refinedPieces=String([...detailPieces.values()].filter(piece=>piece.sprite.texture!==piece.baseTexture).length);
      app.canvas.dataset.atlasResolution=String(atlasTexture.source.resolution);
      app.canvas.dataset.groupSurfaces=String(groupSurfaces?.count??0);
    }
  });
  app.renderer.events.features.globalMove=false;
  host.appendChild(app.canvas);
  app.canvas.setAttribute("aria-label","Поле пазла: перетягуйте деталі мишею, коліщатко змінює масштаб, порожнє місце переміщує стіл");
  app.canvas.setAttribute("role","img");
  const camera=new Container();app.stage.addChild(camera);
  const selection=new Graphics();selection.eventMode="none";selection.zIndex=Number.MAX_SAFE_INTEGER;
  selection.visible=false;camera.addChild(selection);
  const hints = createBoardHints(host, app, camera, () => frames.request(),
    id => detailPieces.get(id), groupContainer, id => paths.get(id), centerOnTile, vm.clearMarker);
  let finishPointing: (() => void) | undefined;

  function groupContainer(tileId: number) {
    const id = pieceGroups.get(tileId);
    return id === undefined ? undefined : containers.get(id);
  }
  function markerTile(mark: BoardMarker) {
    if (mark.tileId !== undefined) return mark.tileId ?? undefined;
    // Older servers relay coordinates only. Use the same silhouette and stacking order as the board.
    let tileId: number | undefined;
    let topZ = -Infinity;
    for (const [id, piece] of detailPieces) {
      const groupId = pieceGroups.get(id);
      const group = groupId === undefined ? undefined : vm.board?.groups.get(groupId);
      const container = groupContainer(id);
      if (!group || !container || container.zIndex < topZ) continue;
      if (piece.sprite.hitArea?.contains(mark.position.x - container.x - piece.sprite.x,
        mark.position.y - container.y - piece.sprite.y)) {
        tileId = id;
        topZ = container.zIndex;
      }
    }
    return tileId;
  }
  function pointAt(global: { x: number; y: number }, tileId: number | null) {
    const { x, y } = camera.toLocal(global);
    vm.pointAt(tileId, {
      x: Math.max(table.left, Math.min(table.right, x)),
      y: Math.max(table.top, Math.min(table.bottom, y)),
    });
    endPointing();
  }
  function endPointing() {
    if (!finishPointing) return;
    const done = finishPointing;
    finishPointing = undefined;
    app.canvas.classList.remove("board-pointing");
    done();
  }
  const boardFrame = new Graphics();
  camera.addChild(boardFrame);
  function refreshPalette() {
    const palette = getComputedStyle(host);
    hints.setPalette(palette);
    // Blend puzzle edges against the actual table color in the same rendering pass.
    app.renderer.background.color = palette.getPropertyValue("--board-background").trim();
    boardFrame.clear().rect(0, 0, BOARD_WIDTH, BOARD_HEIGHT)
      .fill({ color: palette.getPropertyValue("--board-frame").trim() })
      .stroke({ width: 2, color: palette.getPropertyValue("--board-line").trim() });
    frames.request();
  }
  const atlas = createPieceAtlas(app, tiles, artwork);
  const { slots, paths, texture: atlasTexture } = atlas;
  const hitCtx = document.createElement("canvas").getContext("2d")!;
  const sprites=new Map<number,Sprite>();
  const spriteTiles = new WeakMap<object, Tile>();
  let pointer: { clientX: number; clientY: number } | undefined;
  const touches = new Map<number, { x: number; y: number }>();
  let pinching = false;
  let pinch: { distance: number; scale: number; anchor: { x: number; y: number } } | undefined;
  let comparison: ((tile: Tile | undefined) => void) | undefined;
  let comparedTile: Tile | undefined;
  const containers=new Map<string,Container>();
  const detailPieces=new Map<number,DetailPiece>();
  let details:SharpPieceTextures|undefined;
  let groupSurfaces:GroupSurfaceTextures|undefined;
  const groupSizes=new Map<string,number>();
  const pieceGroups=new Map<number,string>();
  let controls: BoardControls = { cameraLocked: false, clickToCarry: true };
  let drag: { id: string; offsetX: number; offsetY: number; startX: number; startY: number;
    bounds: PuzzleBounds; acknowledged: boolean; pointerId: number | null } | null = null;
  let pan: { x: number; y: number; cameraX: number; cameraY: number; pointerId: number } | null = null;
  let carryHeartbeat: ReturnType<typeof setInterval> | undefined;
  let z=1;
  let pendingMove:{x:number;y:number}|null=null;
  const collection = createBoardCollection({
    host, vm, camera, tiles, containers, reportCollection,
    boundsForTable: () => table, highlightColor: () => hints.color,
    localPoint: event => camera.toLocal(point(event)),
    requestFrame: () => frames.request(),
    syncBoard: () => synchronize({kind:"structure"}),
  });

  const touchInput = createBoardTouchInput({
    vm, canvas: app.canvas, tiles, containers, point: event => point(event),
    localPoint: event => camera.toLocal(point(event)),
    scale: () => camera.scale.x, table: () => table,
    gestureBlocked: () => !!(pinching || drag || pan), pointing: () => !!finishPointing,
    selecting: () => collection.active || collection.hasSelection,
    tileIdAt: position => tileAt(position)?.id ?? null,
    pointAt, requestFrame: () => frames.request(), raise: container => { container.zIndex = ++z; },
  });

  function collectionDown(event: PointerEvent) {
    if (touchInput.beginMarkerTap(event)) return;
    if (vm.getSnapshot().viewingTray) return;
    if (event.target !== app.canvas || event.button !== 0 || drag || pan || pinching || finishPointing || !vm.getSnapshot().connected) return;
    const screen = point(event);
    const local = camera.toLocal(screen);
    const tile = tileAt(screen);
    const id = tile && pieceGroups.get(tile.id);
    const g = id ? vm.board?.groups.get(id) : undefined;
    const eligible = g && !g.placed && !g.owner && !g.stored;
    if (event.pointerType === "mouse") {
      if (!collection.beginMouse(event,local,g)) return;
    } else if (collection.acceptsBatch(g)) {
      if (collection.batchActive) {
        const previous = event.pointerType === "touch" && !g ? collection.takeEmptyBatch() : undefined;
        if (previous) {
          touches.set(previous.pointerId, camera.toGlobal(previous.start));
          return;
        }
        event.stopPropagation();
        return;
      }
      if (g && !eligible) return;
      collection.startBatch(event.pointerId, local, g?.id);
    } else if (event.pointerType === "touch" && eligible && !touches.size) {
      touchInput.startFinger(event.pointerId, local, g);
    } else if (touchInput.dragging) { event.stopPropagation(); return; }
    else return;
    event.stopPropagation();
    app.canvas.setPointerCapture(event.pointerId);
  }
  host.addEventListener("pointerdown", collectionDown, true);
  function showSelection(){
    const group=drag&&vm.board?.groups.get(drag.id);
    selection.clear();selection.visible=!!group;
    if(debugRender)app.canvas.dataset.activeGroup=group?group.id:"";
    if(!group){frames.request();return;}
    for(const id of group.pieces){
      for(const command of detailPieces.get(id)!.tile.path){
        if(command.op==="M")selection.moveTo(...command.values);
        else if(command.op==="L")selection.lineTo(...command.values);
        else if(command.op==="C")selection.bezierCurveTo(...command.values);
        else selection.closePath();
      }
    }
    selection.fill({color:0xffd28a,alpha:.17}).stroke({width:2.5/camera.scale.x,color:0xd38b37,alpha:1});
    const container=containers.get(group.id);if(container)selection.position.copyFrom(container.position);
    frames.request();
  }
  function stopDrag() {
    drag = null;
    pendingMove = null;
    clearInterval(carryHeartbeat);
    carryHeartbeat = undefined;
    camera.interactiveChildren = !pan;
    app.canvas.style.cursor = pan ? "grabbing" : "default";
    showSelection();
  }
  function capture(event:FederatedPointerEvent){try{app.canvas.setPointerCapture(event.pointerId);}catch{/* older browsers */}}
  for(const tile of data.tiles){
    const slot=slots.get(tile.id)!;
    const texture=new Texture({source:atlasTexture.source,frame:new Rectangle(slot.x,slot.y,slot.w,slot.h),dynamic:true});
    const sprite=new Sprite(texture);sprite.position.set(tile.x-slot.margin,tile.y-slot.margin);
    const baseBounds={x:tile.x-slot.margin,y:tile.y-slot.margin,width:slot.w,height:slot.h};
    const xs:number[]=[],ys:number[]=[];
    for(const command of tile.path)for(let i=0;i<command.values.length;i+=2){xs.push(command.values[i]!);ys.push(command.values[i+1]!);}
    const left=Math.min(...xs)-1,top=Math.min(...ys)-1;
    const detailBounds={x:left,y:top,width:Math.max(...xs)-left+1,height:Math.max(...ys)-top+1};
    const piece:DetailPiece={tile,sprite,baseTexture:texture,baseBounds,detailBounds,bounds:baseBounds};detailPieces.set(tile.id,piece);
    sprite.eventMode="static";sprite.cursor="grab";
    sprite.hitArea={contains:(x:number,y:number)=>{
      const px=x+piece.bounds.x,py=y+piece.bounds.y,bounds=piece.detailBounds;
      // Reject distant pieces before asking Canvas to test their curved silhouette.
      return px>=bounds.x&&py>=bounds.y&&px<=bounds.x+bounds.width&&py<=bounds.y+bounds.height&&hitCtx.isPointInPath(paths.get(tile.id)!,px,py);
    }};
    sprite.on("pointerdown",(event:FederatedPointerEvent)=>{
      if (pinching || event.button !== 0 || !event.isPrimary || drag || pan || !vm.getSnapshot().connected) return;
      if (finishPointing) {
        event.stopPropagation();
        pointAt(event.global, tile.id);
        return;
      }
      const groupId=pieceGroups.get(tile.id),group=groupId?vm.board!.groups.get(groupId):undefined;
      if(!group||group.stored||group.placed||(group.owner!==null&&group.owner!==selfId))return;
      event.stopPropagation();
      const pointerId = controls.clickToCarry && event.pointerType === "mouse" ? null : event.pointerId;
      if (pointerId !== null) capture(event);
      const position=camera.toLocal(event.global);
      drag={id:group.id,offsetX:position.x-group.dx,offsetY:position.y-group.dy,startX:group.dx,startY:group.dy,
        bounds:puzzleGroupBounds(tiles,group.pieces),acknowledged:false,pointerId};
      if (pointerId === null) {
        // Refresh the existing server lock while the player pauses with a piece in hand.
        carryHeartbeat = setInterval(() => {
          if (!drag?.acknowledged) return;
          const carried = containers.get(drag.id);
          if (carried) vm.move(drag.id, carried.x, carried.y);
        }, 5000);
      }
      const container=containers.get(group.id);if(container)container.zIndex=++z;
      camera.interactiveChildren=false;showSelection();
      vm.grab(group.id);app.canvas.style.cursor="grabbing";
    });sprites.set(tile.id,sprite);
    spriteTiles.set(sprite, tile);
  }
  camera.sortableChildren=true;
  function applyGroup(group:PuzzleGroup){
    let container=containers.get(group.id);
    if(!container){container=new Container();containers.set(group.id,container);camera.addChild(container);container.zIndex=group.placed?0:1;}
    if(groupSizes.get(group.id)!==group.pieces.length){for(const piece of group.pieces)container.addChild(sprites.get(piece)!);groupSizes.set(group.id,group.pieces.length);}
    if (drag?.id === group.id) {
      if (group.owner === selfId) drag.acknowledged = true;
      else if (group.placed || group.owner !== null || drag.acknowledged) stopDrag();
    }
    const fingerActive = touchInput.keepsLocalPosition(group, selfId);
    if (drag?.id !== group.id && !fingerActive) container.position.set(group.dx,group.dy);
    container.visible = drag?.id === group.id || vm.isGroupVisible(group);
    container.alpha=group.owner!==null&&group.owner!==selfId? .65:1;
    if(group.placed)container.zIndex=0;
  }
  function synchronize(change?:BoardChange){
    if(disposed||!vm.board)return;
    const state = vm.getSnapshot();
    boardCamera.switchArea(state.viewingTray ? "tray" : "table");
    const nextSize = state.fieldSize ?? 1;
    if (fieldSize !== nextSize) {
      fieldSize = nextSize; table = fieldBounds(fieldSize);
      camera.scale.set(Math.max(fitScale(),camera.scale.x));
      positionCamera(camera.x,camera.y);
    }
    if (!vm.getSnapshot().connected) { collection.stopGestures(); touchInput.clearFingers(); collection.clear(); if (drag) stopDrag(); }
    if(change?.kind==="motion"){
      const group = vm.board.groups.get(change.groupId);
      const container = containers.get(change.groupId);
      if (group && container && hints.tileId !== undefined && pieceGroups.get(hints.tileId) === group.id &&
        (group.dx !== container.x || group.dy !== container.y)) hints.dismissHint();
      if (group) applyGroup(group);
      details?.request();groupSurfaces?.request();frames.request();return;
    }
    if (change?.kind === "visibility") {
      for (const group of vm.board.groups.values()) {
        const container = containers.get(group.id);
        if (container) container.visible = drag?.id === group.id || vm.isGroupVisible(group);
      }
      details?.request();groupSurfaces?.request();frames.request();return;
    }
    // A structural update can merge groups, so rebuild the piece-to-group hit-test index.
    for(const [id,container]of containers)if(!vm.board.groups.has(id)){container.removeChildren();container.destroy();containers.delete(id);groupSizes.delete(id);}
    pieceGroups.clear();
    for(const group of vm.board.groups.values()){
      applyGroup(group);
      for(const id of group.pieces)pieceGroups.set(id,group.id);
    }
    collection.refreshPicked();
    if (drag && !vm.board.groups.has(drag.id)) stopDrag();
    details?.request();groupSurfaces?.request();frames.request();
  }
  const point=(event: Pick<PointerEvent, "clientX" | "clientY">)=>{
    const rect=app.canvas.getBoundingClientRect();
    return {x:(event.clientX-rect.left)*app.screen.width/rect.width,y:(event.clientY-rect.top)*app.screen.height/rect.height};
  };
  function applyMove(){
    const current=pendingMove;if(!current)return;pendingMove=null;
    if(drag){
      const position=camera.toLocal(current);const container=containers.get(drag.id);
      if (container) {
        const { dx, dy } = clampGroupToTable(drag.bounds, position.x - drag.offsetX, position.y - drag.offsetY, table);
        if ((dx !== container.x || dy !== container.y) && hints.tileId !== undefined &&
          pieceGroups.get(hints.tileId) === drag.id) hints.dismissHint();
        container.position.set(dx, dy);
        selection.position.copyFrom(container.position);
        vm.move(drag.id, dx, dy);
      }
    } else if (pan) {
      positionCamera(pan.cameraX + current.x - pan.x, pan.cameraY + current.y - pan.y);
    }
    if(drag||pan){details?.request();groupSurfaces?.request();}
  }
  function tileAt(position: { x: number; y: number }) {
    return spriteTiles.get(app.renderer.events.rootBoundary.hitTest(position.x, position.y));
  }
  function pointerOnBoard() {
    return pointer && document.elementFromPoint(pointer.clientX, pointer.clientY) === app.canvas
      ? point(pointer) : undefined;
  }
  function updateReferenceComparison() {
    if (!comparison) return;
    const position = !drag && !pan ? pointerOnBoard() : undefined;
    const tile = position && tileAt(position);
    if (tile === comparedTile) return;
    comparedTile = tile;
    comparison(tile);
  }
  function onMove(event: PointerEvent) {
    touchInput.trackMarkerTap(event);
    if (collection.handleMouse(event) || touchInput.handleFinger(event) || collection.handleBatch(event)) return;
    if (touches.has(event.pointerId)) {
      touches.set(event.pointerId, point(event));
      if (pinching) {
        frames.request();
        return;
      }
    }
    if (!event.isPrimary) return;
    pointer = { clientX: event.clientX, clientY: event.clientY };
    if (comparison) frames.request();
    if (drag ? drag.pointerId !== null && drag.pointerId !== event.pointerId : pan?.pointerId !== event.pointerId) return;
    if (drag) {
      // A pointer released outside the window may re-enter without a pointerup event.
      if (drag.pointerId !== null && event.pointerType === "mouse" && !(event.buttons & 1)) {
        finishDrag(true);
        return;
      }
    }
    pendingMove = point(event);
    frames.request();
  }
  function finishDrag(cancel = false) {
    if (!drag) return;
    applyMove();
    const { id, startX, startY } = drag;
    const container = containers.get(id);
    if (cancel) {
      container?.position.set(startX, startY);
      vm.cancelDrag(id, startX, startY);
    } else if (container) {
      vm.release(id, container.x, container.y);
    }
    stopDrag();
    synchronize({ kind: "visibility" });
  }
  function onUp(event: PointerEvent) {
    touchInput.finishMarkerTap(event);
    if (collection.handleMouse(event,true) || touchInput.handleFinger(event,true) || collection.handleBatch(event,true)) return;
    if (touches.delete(event.pointerId) && pinching) {
      pinch = undefined;
      details?.request(); groupSurfaces?.request(); frames.request();
      if (touches.size >= 2) {
        const span = touchSpan()!;
        pinch = { distance: span.distance, scale: camera.scale.x, anchor: camera.toLocal(span) };
      } else if (!touches.size) pinching = false;
      return;
    }
    const released = event.type === "pointerup";
    const endsGesture = !released || event.pointerType === "touch" || event.button === 0;
    if (drag?.pointerId === event.pointerId && endsGesture) {
      if (released) pendingMove = point(event);
      finishDrag(!released);
    }
    if (pan?.pointerId === event.pointerId && endsGesture) {
      if (released) pendingMove = point(event);
      applyMove();
      pan = null;
      camera.interactiveChildren = true;
      app.canvas.style.cursor = "default";
      frames.request();
    }
  }
  function onBlur() {
    collection.stopGestures();
    touchInput.onBlur();
    synchronize({kind:'structure'});
    touches.clear();
    pinching = false;
    pinch = undefined;
    pointer = undefined;
    if (comparison) frames.request();
    endPointing();
    if (drag) finishDrag(true);
    if (!pan) return;
    pan = null;
    pendingMove = null;
    camera.interactiveChildren = true;
    app.canvas.style.cursor = "default";
  }
  function onKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    const markerKey = vm.getSnapshot().markerKey;
    const matchesMarker = event.key.toUpperCase() === markerKey || (markerKey === "M" && event.code === "KeyM");
    if (matchesMarker && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey &&
      !event.shiftKey && !drag && !pan && !event.isComposing &&
      !(event.target instanceof HTMLElement && (event.target.isContentEditable ||
        event.target.closest("input, textarea, select, [role='textbox']"))) &&
      !document.querySelector("dialog[open], .board-menu:popover-open")) {
      const state = vm.getSnapshot();
      if (!state.markerShortcut || !state.connected || !state.players.some(player => player.id !== state.selfId && player.connected)) return;
      const position = pointerOnBoard();
      if (!position) return;
      event.preventDefault();
      pointAt(position, tileAt(position)?.id ?? null);
      return;
    }
    if (event.key !== "Escape") return;
    if (collection.mouseActive || (collection.hasSelection && window.matchMedia("(pointer: fine)").matches && !document.querySelector("dialog[open]"))) {
      collection.cancelMouse(); collection.clear(); synchronize({kind:"structure"}); return;
    }
    if (finishPointing) endPointing();
    else if (drag?.pointerId === null) finishDrag(true);
  }
  app.stage.eventMode="static";app.stage.hitArea=new Rectangle(0,0,app.screen.width,app.screen.height);
  app.stage.on("pointerdown", (event: FederatedPointerEvent) => {
    if (pinching || event.button !== 0 || !event.isPrimary || pan) return;
    if (finishPointing) {
      pointAt(event.global, null);
      return;
    }
    if (drag?.pointerId === null) {
      pendingMove = { x: event.global.x, y: event.global.y };
      finishDrag();
      return;
    }
    if (drag || controls.cameraLocked) return;
    capture(event);
    camera.interactiveChildren = false;
    pan = { x: event.global.x, y: event.global.y, cameraX: camera.x, cameraY: camera.y, pointerId: event.pointerId };
    app.canvas.style.cursor = "grabbing";
  });
  const boardCamera = createBoardCamera(camera, app.screen, () => table,
    vm.getSnapshot().viewingTray ? "tray" : "table", cameraPreferences);
  const { fitScale, position: positionCamera } = boardCamera;
  const zoomAt=(factor:number,x:number,y:number)=>{
    if (controls.cameraLocked) return;
    const before = camera.toLocal({ x, y });
    const scale = Math.max(fitScale(), Math.min(6, camera.scale.x * factor));
    camera.scale.set(scale);
    positionCamera(x - before.x * scale, y - before.y * scale);
    if(drag)showSelection();details?.request();groupSurfaces?.request();frames.request();
  };
  function touchSpan() {
    const [first, second] = touches.values();
    if (!first || !second) return;
    return {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
      distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
    };
  }
  function startTouch(event: PointerEvent) {
    if (event.pointerType !== "touch") return;
    touches.set(event.pointerId, point(event));
    if (touches.size !== 2) return;
    pinching = true;
    endPointing();
    pendingMove = null;
    if (drag) finishDrag(true);
    pan = null;
    camera.interactiveChildren = true;
    app.canvas.style.cursor = "default";
    const span = touchSpan()!;
    pinch = { distance: span.distance, scale: camera.scale.x, anchor: camera.toLocal(span) };
  }
  function updatePinch() {
    const span = touchSpan();
    if (!span || !pinch || controls.cameraLocked) return;
    const target = Math.max(fitScale(), Math.min(6, pinch.scale * span.distance / pinch.distance));
    const scale = Math.abs(target-camera.scale.x) < .0002 ? target : camera.scale.x + (target-camera.scale.x)*.55;
    camera.scale.set(scale);
    positionCamera(span.x - pinch.anchor.x * scale, span.y - pinch.anchor.y * scale);
    if (scale !== target) frames.request();
  }
  function onWheel(event:WheelEvent){event.preventDefault();const p=point(event);zoomAt(Math.exp(-event.deltaY*.0015),p.x,p.y);}
  function preventContext(event:Event){event.preventDefault();}
  app.canvas.addEventListener("pointerdown", startTouch, true);
  window.addEventListener("keydown", onKeyDown);
  // The toolbar is layered over the canvas, so a release can target it instead.
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);
  window.addEventListener("blur", onBlur);
  app.canvas.addEventListener("wheel",onWheel,{passive:false});app.canvas.addEventListener("contextmenu",preventContext);
  function centerTable(scale: number) {
    boardCamera.centerTable(scale);
    if (drag) showSelection();
    details?.request();
    groupSurfaces?.request();
    frames.request();
  }
  const unsubscribe = vm.onBoardChange(synchronize);
  synchronize();
  details=new SharpPieceTextures(artwork,detailPieces,()=>{
    const corner=camera.toLocal({x:0,y:0});
    return {x:corner.x,y:corner.y,width:app.screen.width/camera.scale.x,height:app.screen.height/camera.scale.y,zoom:camera.scale.x,resolution:app.renderer.resolution};
  },()=>frames.request());details.request();
  groupSurfaces=new GroupSurfaceTextures(artwork,detailPieces,containers,()=>vm.board?.groups??new Map(),()=>{
    const corner=camera.toLocal({x:0,y:0});
    return {x:corner.x,y:corner.y,width:app.screen.width/camera.scale.x,height:app.screen.height/camera.scale.y,zoom:camera.scale.x,resolution:app.renderer.resolution};
  },()=>{details?.request();frames.request();});groupSurfaces.request();
  function resize(){
    if(disposed)return;
    // Keep the same point under the viewport center when the panel opens or fullscreen changes.
    const center = camera.toLocal({ x: app.screen.width / 2, y: app.screen.height / 2 });
    const wasFitted = Math.abs(camera.scale.x - fitScale()) < .000001;
    const size = host.getBoundingClientRect();
    app.renderer.resize(size.width, size.height, devicePixelRatio);
    if (wasFitted && !controls.cameraLocked) centerTable(fitScale());
    else {
      camera.scale.set(Math.max(fitScale(), camera.scale.x));
      positionCamera(app.screen.width / 2 - center.x * camera.scale.x, app.screen.height / 2 - center.y * camera.scale.y);
    }
    app.stage.hitArea=new Rectangle(0,0,app.screen.width,app.screen.height);details?.request();groupSurfaces?.request();frames.request();
  }
  const observer=new ResizeObserver(resize);observer.observe(host);
  const unwatchDensity=watchDisplayDensity(resize);
  function centerOnTile(tileId: number | undefined, fallback?: BoardMarker["position"]) {
    if (controls.cameraLocked) return;
    const piece = tileId === undefined ? undefined : detailPieces.get(tileId);
    const group = piece && groupContainer(piece.tile.id);
    const target = piece && group ? {
      x: piece.tile.x + piece.tile.width / 2 + group.x,
      y: piece.tile.y + piece.tile.height / 2 + group.y,
    } : fallback;
    if (!target) return;
    boardCamera.centerOn(target);
    details?.request();
    groupSurfaces?.request();
    frames.request();
  }
  return {
    setCollectionMode(active) {
      if (drag) finishDrag(true);
      collection.setMode(active);
    },
    storeSelected: collection.storeSelected,
    restoreTray() { vm.collect([...vm.board!.groups.values()].filter(g=>g.stored).map(g=>g.id),"restore"); },
    setReferenceComparison(listener) {
      comparison = listener;
      comparedTile = undefined;
      if (comparison) frames.request();
    },
    zoom:factor=>zoomAt(factor,app.screen.width/2,app.screen.height/2),
    fit: () => { if (!controls.cameraLocked) centerTable(fitScale()); },
    setControls(next) {
      if (next.cameraLocked && pan) {
        pan = null;
        pendingMove = null;
        camera.interactiveChildren = true;
        app.canvas.style.cursor = "default";
      }
      if (!next.clickToCarry && drag?.pointerId === null) finishDrag(true);
      controls = next;
      hints.setCameraLocked(controls.cameraLocked);
    },
    armMarker(onDone) {
      if (drag || pan || touchInput.dragging || collection.batchActive || finishPointing) return false;
      touchInput.resetMarkerSeries();
      finishPointing = onDone;
      app.canvas.classList.add("board-pointing");
      return true;
    },
    showHint: hints.showHint,
    clearHint: hints.clearHint,
    showMarker(next, duration = BOARD_MARKER_DURATION) {
      hints.showMarker(next, next ? markerTile(next) : undefined, duration);
    },
    centerOnMarker(next) {
      centerOnTile(markerTile(next), next.position);
    },
    refreshPalette,
    dispose() {
      disposed = true;
      collection.dispose();
      touchInput.dispose();
      hints.dispose();
      boardCamera.dispose();
      clearInterval(carryHeartbeat);
      frames.dispose();
      groupSurfaces?.dispose();
      details?.dispose();
      unsubscribe();
      observer.disconnect();
      unwatchDensity();

      host.removeEventListener("pointerdown", collectionDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("blur", onBlur);
      app.canvas.removeEventListener("pointerdown", startTouch, true);
      app.canvas.removeEventListener("wheel", onWheel);
      app.canvas.removeEventListener("contextmenu", preventContext);

      for (const sprite of sprites.values()) sprite.texture.destroy();
      app.destroy(true, {children:true});
      atlasTexture.destroy(true);
    },
  };
}
