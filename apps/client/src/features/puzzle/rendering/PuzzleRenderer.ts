import { GroupSurfaceTextures } from "./GroupSurfaceTextures";
import { FrameScheduler } from "./FrameScheduler";
import { SharpPieceTextures, type DetailPiece } from "./SharpPieceTextures";
import { loadPuzzleArtwork } from "./PuzzleArtwork";
import { watchDisplayDensity } from "./displayDensity";
import { detailResolution } from "./detailPolicy";
import { Application, CanvasSource, Container, Graphics, Rectangle, Sprite, Texture, type FederatedPointerEvent } from "pixi.js";
import { BOARD_MARKER_DURATION, BOARD_WIDTH, BOARD_HEIGHT, SCATTER_BOUNDS, TABLE_BOUNDS, TABLE_WIDTH, TABLE_HEIGHT, clampGroupToTable, puzzleGroupBounds, pathData, type BoardMarker, type PuzzleBounds, type PuzzleGroup, type PuzzleTray, type Tile } from "@web-pazle/shared";
import type { CameraView } from "../models/PuzzleViewPreferences";
import type { BoardChange, PuzzleViewModel } from "../viewmodels/PuzzleViewModel";
export interface BoardControls { cameraLocked: boolean; clickToCarry: boolean }
export interface PuzzleRenderer {
  setReferenceComparison(listener?: (tile: Tile | undefined) => void): void;
  zoom(factor: number): void;
  fit(): void;
  refreshPalette(): void;
  setControls(controls: BoardControls): void;
  dropOnTray(tray: PuzzleTray | null): boolean;
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
  dropTray: (x: number, y: number) => PuzzleTray | null | undefined,
  showDropTarget: (tray: PuzzleTray | null | undefined) => void = () => {},
  cameraPreferences?: { initial?: CameraView; save: (camera: CameraView) => void },
): Promise<PuzzleRenderer> {
  const data=vm.board;if(!data)throw new Error("No puzzle state");
  const tiles=data.tiles;
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
    refreshAtlas();
    app.render();
    updateReferenceComparison();
    drawHint();
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
  const hintCanvas = document.createElement("canvas");
  hintCanvas.className = "tile-hint";
  hintCanvas.setAttribute("aria-hidden", "true");
  host.appendChild(hintCanvas);
  const hintCtx = hintCanvas.getContext("2d")!;
  const hintDirection = document.createElement("button");
  hintDirection.type = "button";
  hintDirection.className = "hint-direction";
  hintDirection.setAttribute("aria-label", "Перейти до мітки");
  hintDirection.title = "Перейти до мітки";
  hintDirection.hidden = true;
  hintDirection.addEventListener("click", () => {
    if (hint && !controls.cameraLocked) centerOnTile(hint.tileId, marker?.position);
  });
  host.appendChild(hintDirection);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const redrawHint = () => frames.request();
  reducedMotion.addEventListener("change", redrawHint);
  let hintColor = "#275b49", hintContrast = "#f5fbed";
  let hint: { tileId: number | undefined; startedAt: number } | undefined;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  let hintPainted = false;
  let marker: BoardMarker | null = null;
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
      if (!group || (group.tray ?? null) !== mark.tray || !container || container.zIndex < topZ) continue;
      if (piece.sprite.hitArea?.contains(mark.position.x - container.x - piece.sprite.x,
        mark.position.y - container.y - piece.sprite.y)) {
        tileId = id;
        topZ = container.zIndex;
      }
    }
    return tileId;
  }
  function clearHint() {
    clearTimeout(hintTimer);
    hint = undefined;
    marker = null;
    hintDirection.hidden = true;
    if (hintPainted) frames.request();
  }
  function dismissHint() {
    const received = marker;
    clearHint();
    if (received) vm.clearMarker(received);
  }
  function showHint(tileId: number) {
    clearHint();
    if (paths.has(tileId)) startHint(tileId, BOARD_MARKER_DURATION);
  }
  function startHint(tileId: number | undefined, duration: number) {
    hint = { tileId, startedAt: performance.now() };
    hintTimer = setTimeout(dismissHint, duration);
    frames.request();
  }
  function drawHint() {
    if (hintPainted) {
      hintCtx.resetTransform();
      hintCtx.clearRect(0, 0, hintCanvas.width, hintCanvas.height);
      hintPainted = false;
    }
    if (!hint) return;
    const { tileId } = hint;
    const piece = tileId === undefined ? undefined : detailPieces.get(tileId);
    const group = tileId === undefined ? undefined : groupContainer(tileId);
    const position = tileId === undefined ? marker?.position : group?.visible ? group.position : undefined;
    if (!position) {
      hintDirection.hidden = true;
      return;
    }
    const scale = camera.scale.x;
    const x = camera.x + position.x * scale;
    const y = camera.y + position.y * scale;
    const { width, height } = app.screen;
    const bounds = piece?.detailBounds;
    const left = x + (bounds?.x ?? 0) * scale, right = left + (bounds?.width ?? 0) * scale;
    const top = y + (bounds?.y ?? 0) * scale, bottom = top + (bounds?.height ?? 0) * scale;
    const outside = right < 0 || bottom < 0 || left > width || top > height;
    hintDirection.hidden = !outside;
    if (outside) {
      const inset = Math.min(32, width / 4, height / 4);
      const usableBottom = Math.min(96, height / 3);
      const cx = width / 2, cy = (height + inset - usableBottom) / 2;
      const dx = (left + right) / 2 - cx, dy = (top + bottom) / 2 - cy;
      const edge = 1 / Math.max(Math.abs(dx) / (cx - inset), Math.abs(dy) / (cy - inset));
      hintDirection.style.left = `${cx + dx * edge}px`;
      hintDirection.style.top = `${cy + dy * edge}px`;
      hintDirection.style.setProperty("--hint-angle", `${Math.atan2(dx, -dy)}rad`);
      hintDirection.disabled = controls.cameraLocked;
      return;
    }

    if (hintCanvas.width !== app.canvas.width) hintCanvas.width = app.canvas.width;
    if (hintCanvas.height !== app.canvas.height) hintCanvas.height = app.canvas.height;
    const density = app.renderer.resolution;
    const moving = !reducedMotion.matches;
    const phase = (performance.now() - hint.startedAt) * 2 * Math.PI / 1400;
    const pulse = moving ? (1 - Math.cos(phase)) / 2 : 0;
    if (tileId === undefined) {
      // Draw at screen size, with the foot of the flagpole anchored to the marked point.
      const flagHeight = 52, flagWidth = 37;
      const direction = y < flagHeight + 6 ? -1 : 1;
      const side = x > width - flagWidth - 6 ? -1 : 1;
      hintCtx.setTransform(density * side, 0, 0, density * direction, density * x, density * y);
      hintCtx.globalAlpha = 1;
      hintCtx.lineJoin = "round";
      hintCtx.lineCap = "round";
      hintCtx.beginPath();
      hintCtx.moveTo(0, 0);
      hintCtx.lineTo(0, -flagHeight);
      hintCtx.lineTo(flagWidth, -flagHeight);
      hintCtx.lineTo(flagWidth - 9, -flagHeight + 13);
      hintCtx.lineTo(flagWidth, -flagHeight + 26);
      hintCtx.lineTo(0, -flagHeight + 26);
      hintCtx.fillStyle = hintColor;
      hintCtx.fill();
      hintCtx.strokeStyle = hintContrast;
      hintCtx.lineWidth = 6 + pulse * 2;
      hintCtx.stroke();
      hintCtx.strokeStyle = hintColor;
      hintCtx.lineWidth = 2.5;
      hintCtx.stroke();
      hintPainted = true;
      if (moving) frames.request();
      return;
    }
    const lineWidth = 2 + pulse * 1.6;

    hintCtx.setTransform(density * scale, 0, 0, density * scale, density * x, density * y);
    hintCtx.lineJoin = "round";
    hintCtx.globalAlpha = .82 + pulse * .18;
    hintCtx.strokeStyle = hintContrast;
    hintCtx.lineWidth = (lineWidth + 2.5) / scale;
    hintCtx.stroke(paths.get(tileId)!);
    hintCtx.strokeStyle = hintColor;
    hintCtx.lineWidth = lineWidth / scale;
    hintCtx.stroke(paths.get(tileId)!);

    hintPainted = true;
    if (!moving) return;

    // Screen coordinates keep the arrow's size and travel constant as the board zooms.
    const centerX = Math.max(9, Math.min(width - 9, (Math.max(0, left) + Math.min(width, right)) / 2));
    const centerY = Math.max(9, Math.min(height - 9, (Math.max(0, top) + Math.min(height, bottom)) / 2));
    const bounce = 5 + pulse * 8;
    let arrowX = centerX, arrowY = top - bounce, rotation = 0;
    if (top < 28) {
      if (bottom < height - 28) {
        arrowY = bottom + bounce;
        rotation = Math.PI;
      } else if (right < width - 28 || left > 28) {
        const onRight = right < width - 28;
        arrowX = onRight ? right + bounce : left - bounce;
        arrowY = centerY;
        rotation = onRight ? Math.PI / 2 : -Math.PI / 2;
      } else {
        arrowY = 15 + bounce;
      }
    }
    hintCtx.setTransform(density, 0, 0, density, density * arrowX, density * arrowY);
    hintCtx.rotate(rotation);
    hintCtx.globalAlpha = 1;
    hintCtx.beginPath();
    hintCtx.moveTo(-6, -10);
    hintCtx.lineTo(6, -10);
    hintCtx.lineTo(0, 0);
    hintCtx.closePath();
    hintCtx.fillStyle = hintColor;
    hintCtx.fill();
    hintCtx.strokeStyle = hintContrast;
    hintCtx.lineWidth = 1.5;
    hintCtx.stroke();
    frames.request();
  }
  function pointAt(global: { x: number; y: number }, tileId: number | null) {
    const { x, y } = camera.toLocal(global);
    vm.pointAt(tileId, {
      x: Math.max(TABLE_BOUNDS.left, Math.min(TABLE_BOUNDS.right, x)),
      y: Math.max(TABLE_BOUNDS.top, Math.min(TABLE_BOUNDS.bottom, y)),
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
    hintColor = palette.getPropertyValue("--hint-color").trim() || "#275b49";
    hintContrast = palette.getPropertyValue("--hint-contrast").trim() || "#f5fbed";
    // Blend puzzle edges against the actual table color in the same rendering pass.
    app.renderer.background.color = palette.getPropertyValue("--board-background").trim();
    boardFrame.clear().rect(0, 0, BOARD_WIDTH, BOARD_HEIGHT)
      .fill({ color: palette.getPropertyValue("--board-frame").trim() })
      .stroke({ width: 2, color: palette.getPropertyValue("--board-line").trim() });
    frames.request();
  }
  const atlas=document.createElement("canvas");atlas.width=4096;
  const slots=new Map<number,{x:number;y:number;w:number;h:number;margin:number}>();
  let sx=2,sy=2,rowHeight=0;
  for(const tile of data.tiles){
    const margin=Math.ceil(Math.min(tile.width,tile.height)*.26)+2;
    const w=Math.ceil(tile.width)+margin*2,h=Math.ceil(tile.height)+margin*2;
    if(sx+w>atlas.width){sx=2;sy+=rowHeight+4;rowHeight=0;}
    slots.set(tile.id,{x:sx,y:sy,w,h,margin});sx+=w+4;rowHeight=Math.max(rowHeight,h);
  }
  atlas.height=sy+rowHeight+2;
  const ctx=atlas.getContext("2d");if(!ctx)throw new Error("Canvas unavailable");
  const hitCanvas=document.createElement("canvas"),hitCtx=hitCanvas.getContext("2d")!;
  const paths=new Map<number,Path2D>();
  for(const tile of data.tiles)paths.set(tile.id,new Path2D(pathData(tile)));
  const atlasWidth=atlas.width,atlasHeight=atlas.height;
  const gl="gl" in app.renderer ? app.renderer.gl as WebGLRenderingContext : null;
  const maxTextureSize=gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) as number : 4096;
  const atlasLimit=Math.min(2,maxTextureSize/atlasWidth,maxTextureSize/atlasHeight);
  const atlasTexture=new Texture({source:new CanvasSource({resource:atlas,scaleMode:"linear",autoGenerateMipmaps:false})});
  let atlasResolution=0;
  function refreshAtlas(){
    const resolution=Math.min(atlasLimit,detailResolution(camera.scale.x,app.renderer.resolution));
    if(resolution===atlasResolution)return;
    // Keep distant pieces in ONE shared texture, redrawn from the original at the
    // current scale. Thousands of independent SVG textures made zooming expensive.
    atlas.width=Math.ceil(atlasWidth*resolution);atlas.height=Math.ceil(atlasHeight*resolution);
    ctx!.setTransform(resolution,0,0,resolution,0,0);
    ctx!.imageSmoothingQuality="high";
    for(const tile of tiles){
      const slot=slots.get(tile.id)!;const path=paths.get(tile.id)!;
      ctx!.save();ctx!.translate(slot.x+slot.margin-tile.x,slot.y+slot.margin-tile.y);
      ctx!.clip(path);ctx!.drawImage(artwork.image,0,0,BOARD_WIDTH,BOARD_HEIGHT);
      ctx!.strokeStyle="rgba(25,45,39,.42)";ctx!.lineWidth=1;ctx!.stroke(path);ctx!.restore();
    }
    atlasTexture.source.resolution=resolution;
    atlasTexture.source.update();
    atlasResolution=resolution;
  }
  const sprites=new Map<number,Sprite>();
  const spriteTiles = new WeakMap<object, Tile>();
  let pointer: { clientX: number; clientY: number } | undefined;
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
  let dropTarget: PuzzleTray | null | undefined;
  function setDropTarget(tray: PuzzleTray | null | undefined) {
    if (tray === dropTarget) return;
    dropTarget = tray;
    showDropTarget(tray);
  }
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
    setDropTarget(undefined);
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
      if (event.button !== 0 || !event.isPrimary || drag || pan || !vm.getSnapshot().connected) return;
      if (finishPointing) {
        event.stopPropagation();
        pointAt(event.global, tile.id);
        return;
      }
      const groupId=pieceGroups.get(tile.id),group=groupId?vm.board!.groups.get(groupId):undefined;
      if(!group||group.placed||(group.owner!==null&&group.owner!==selfId))return;
      event.stopPropagation();
      const pointerId = controls.clickToCarry ? null : event.pointerId;
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
    if(drag?.id!==group.id)container.position.set(group.dx,group.dy);
    container.visible = drag?.id === group.id || vm.isGroupVisible(group);
    container.alpha=group.owner!==null&&group.owner!==selfId? .65:1;
    if(group.placed)container.zIndex=0;
  }
  function synchronize(change?:BoardChange){
    if(disposed||!vm.board)return;
    if (!vm.getSnapshot().connected && drag) stopDrag();
    if(change?.kind==="motion"){
      const group = vm.board.groups.get(change.groupId);
      const container = containers.get(change.groupId);
      if (group && container && hint?.tileId !== undefined && pieceGroups.get(hint.tileId) === group.id &&
        (group.dx !== container.x || group.dy !== container.y)) dismissHint();
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
    if (drag && !vm.board.groups.has(drag.id)) stopDrag();
    details?.request();groupSurfaces?.request();frames.request();
  }
  const unsubscribe=vm.onBoardChange(synchronize);synchronize();
  const point=(event: Pick<PointerEvent, "clientX" | "clientY">)=>{
    const rect=app.canvas.getBoundingClientRect();
    return {x:(event.clientX-rect.left)*app.screen.width/rect.width,y:(event.clientY-rect.top)*app.screen.height/rect.height};
  };
  function applyMove(){
    const current=pendingMove;if(!current)return;pendingMove=null;
    if(drag){
      const position=camera.toLocal(current);const container=containers.get(drag.id);
      if (container) {
        const { dx, dy } = clampGroupToTable(drag.bounds, position.x - drag.offsetX, position.y - drag.offsetY);
        if ((dx !== container.x || dy !== container.y) && hint?.tileId !== undefined &&
          pieceGroups.get(hint.tileId) === drag.id) dismissHint();
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
    if (!event.isPrimary) return;
    pointer = { clientX: event.clientX, clientY: event.clientY };
    if (comparison) frames.request();
    if (drag ? drag.pointerId !== null && drag.pointerId !== event.pointerId : pan?.pointerId !== event.pointerId) return;
    if (drag) {
      // A pointer released outside the window may re-enter without a pointerup event.
      if (drag.pointerId !== null && !(event.buttons & 1)) {
        finishDrag(undefined, true);
        return;
      }
      const tray = dropTray(event.clientX, event.clientY);
      const currentTray = vm.board?.groups.get(drag.id)?.tray ?? null;
      setDropTarget(tray === currentTray ? undefined : tray);
    }
    pendingMove = point(event);
    frames.request();
  }
  function finishDrag(tray?: PuzzleTray | null, cancel = false) {
    if (!drag) return;
    applyMove();
    const { id, startX, startY } = drag;
    const container = containers.get(id);
    const group = vm.board?.groups.get(id);
    const currentTray = group?.tray ?? null;
    if (cancel || (tray !== undefined && tray !== currentTray)) {
      container?.position.set(startX, startY);
      vm.stash(id, cancel ? currentTray : tray!, startX, startY);
    } else if (container) {
      vm.release(id, container.x, container.y);
    }
    stopDrag();
    synchronize({ kind: "visibility" });
  }
  function onUp(event: PointerEvent) {
    const released = event.type === "pointerup";
    if (drag?.pointerId === event.pointerId && (!released || event.button === 0)) {
      if (released) pendingMove = point(event);
      // The actual element under the pointer can be a tray even when the canvas has capture.
      finishDrag(released ? dropTray(event.clientX, event.clientY) : undefined, !released);
    }
    if (pan?.pointerId === event.pointerId && (!released || event.button === 0)) {
      if (released) pendingMove = point(event);
      applyMove();
      pan = null;
      camera.interactiveChildren = true;
      app.canvas.style.cursor = "default";
      frames.request();
    }
  }
  function onBlur() {
    pointer = undefined;
    if (comparison) frames.request();
    endPointing();
    if (drag) finishDrag(undefined, true);
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
    if (finishPointing) endPointing();
    else if (drag?.pointerId === null) finishDrag(undefined, true);
  }
  app.stage.eventMode="static";app.stage.hitArea=new Rectangle(0,0,app.screen.width,app.screen.height);
  app.stage.on("pointerdown", (event: FederatedPointerEvent) => {
    if (event.button !== 0 || !event.isPrimary || pan) return;
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
  const tablePadding = 32;
  const scaleToFit = (width: number, height: number) => Math.max(.001, Math.min(6,
    (app.screen.width - 2 * tablePadding) / width, (app.screen.height - 2 * tablePadding) / height));
  const fitScale = () => scaleToFit(TABLE_WIDTH, TABLE_HEIGHT);
  let saveViewTimer: ReturnType<typeof setTimeout> | undefined;
  function saveView() {
    if (saveViewTimer === undefined) return;
    clearTimeout(saveViewTimer);
    saveViewTimer = undefined;
    const scale = camera.scale.x;
    cameraPreferences?.save({ scale, center: {
      x: (app.screen.width / 2 - camera.x) / scale,
      y: (app.screen.height / 2 - camera.y) / scale,
    } });
  }
  window.addEventListener("pagehide", saveView);
  function positionCamera(x: number, y: number) {
    const scale = camera.scale.x;
    const clampAxis = (offset: number, screen: number, start: number, end: number) => {
      if ((end - start) * scale <= screen - 2 * tablePadding) return (screen - (start + end) * scale) / 2;
      return Math.max(screen - tablePadding - end * scale, Math.min(tablePadding - start * scale, offset));
    };
    camera.position.set(clampAxis(x, app.screen.width, TABLE_BOUNDS.left, TABLE_BOUNDS.right),
      clampAxis(y, app.screen.height, TABLE_BOUNDS.top, TABLE_BOUNDS.bottom));
    if (cameraPreferences) {
      clearTimeout(saveViewTimer);
      saveViewTimer = setTimeout(saveView, 250);
    }
  }
  const zoomAt=(factor:number,x:number,y:number)=>{
    if (controls.cameraLocked) return;
    const before = camera.toLocal({ x, y });
    const scale = Math.max(fitScale(), Math.min(6, camera.scale.x * factor));
    camera.scale.set(scale);
    positionCamera(x - before.x * scale, y - before.y * scale);
    if(drag)showSelection();details?.request();groupSurfaces?.request();frames.request();
  };
  function onWheel(event:WheelEvent){event.preventDefault();const p=point(event);zoomAt(Math.exp(-event.deltaY*.0015),p.x,p.y);}
  function preventContext(event:Event){event.preventDefault();}
  window.addEventListener("keydown", onKeyDown);
  // The toolbar is layered over the canvas, so a release can target it instead.
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);
  window.addEventListener("blur", onBlur);
  app.canvas.addEventListener("wheel",onWheel,{passive:false});app.canvas.addEventListener("contextmenu",preventContext);
  function centerTable(scale: number) {
    camera.scale.set(scale);
    positionCamera(app.screen.width / 2 - (TABLE_BOUNDS.left + TABLE_BOUNDS.right) * scale / 2,
      app.screen.height / 2 - (TABLE_BOUNDS.top + TABLE_BOUNDS.bottom) * scale / 2);
    if(drag)showSelection();details?.request();groupSurfaces?.request();frames.request();
  }
  const savedView = cameraPreferences?.initial;
  if (savedView) {
    const scale = Math.max(fitScale(), Math.min(6, savedView.scale));
    camera.scale.set(scale);
    positionCamera(app.screen.width / 2 - savedView.center.x * scale, app.screen.height / 2 - savedView.center.y * scale);
    frames.request();
  } else {
    centerTable(scaleToFit(SCATTER_BOUNDS.right - SCATTER_BOUNDS.left, SCATTER_BOUNDS.bottom - SCATTER_BOUNDS.top));
  }
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
    const scale = camera.scale.x;
    positionCamera(app.screen.width / 2 - target.x * scale, app.screen.height / 2 - target.y * scale);
    details?.request();
    groupSurfaces?.request();
    frames.request();
  }
  return {
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
      if (!next.clickToCarry && drag?.pointerId === null) finishDrag(undefined, true);
      controls = next;
      hintDirection.disabled = controls.cameraLocked;
    },
    dropOnTray(tray) {
      if (drag?.pointerId !== null) return false;
      finishDrag(tray);
      return true;
    },
    armMarker(onDone) {
      if (drag || pan || finishPointing) return false;
      finishPointing = onDone;
      app.canvas.classList.add("board-pointing");
      return true;
    },
    showHint,
    clearHint,
    showMarker(next, duration = BOARD_MARKER_DURATION) {
      clearHint();
      if (!next) return;
      const tileId = markerTile(next);
      marker = next;
      startHint(tileId !== undefined && paths.has(tileId) ? tileId : undefined, duration);
    },
    centerOnMarker(next) {
      centerOnTile(markerTile(next), next.position);
    },
    refreshPalette,
    dispose(){disposed=true;clearTimeout(hintTimer);reducedMotion.removeEventListener("change", redrawHint);hintCanvas.remove();hintDirection.remove();saveView();window.removeEventListener("pagehide",saveView);clearInterval(carryHeartbeat);window.removeEventListener("keydown",onKeyDown);frames.dispose();groupSurfaces?.dispose();details?.dispose();unsubscribe();observer.disconnect();unwatchDensity();window.removeEventListener("pointermove",onMove,true);window.removeEventListener("pointerup",onUp,true);window.removeEventListener("pointercancel",onUp,true);window.removeEventListener("blur",onBlur);app.canvas.removeEventListener("wheel",onWheel);app.canvas.removeEventListener("contextmenu",preventContext);for(const sprite of sprites.values())sprite.texture.destroy();app.destroy(true,{children:true});atlasTexture.destroy(true);},
  };
}
