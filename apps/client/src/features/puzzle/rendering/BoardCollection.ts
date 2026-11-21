import { Graphics, type Container } from "pixi.js";
import { puzzleGroupBounds, slideCollection, type Point, type PuzzleBounds, type PuzzleGroup, type Tile } from "@web-pazle/shared";
import type { PuzzleViewModel } from "../viewmodels/PuzzleViewModel";

interface CollectionContext {
  host: HTMLElement;
  vm: PuzzleViewModel;
  camera: Container;
  tiles: Tile[];
  containers: ReadonlyMap<string, Container>;
  boundsForTable(): PuzzleBounds;
  highlightColor(): string;
  localPoint(event: PointerEvent): Point;
  requestFrame(): void;
  syncBoard(): void;
  reportCollection?(selected: number, stored: number): void;
}

export function createBoardCollection({
  host, vm, camera, tiles, containers, boundsForTable, highlightColor, localPoint,
  requestFrame, syncBoard, reportCollection,
}: CollectionContext) {
  let collecting = false;
  const picked = new Set<string>();
  let batchDrag: { pointerId: number; start: Point; id?: string; moved: boolean; bounds?: PuzzleBounds } | undefined;

  function refreshPicked() {
    let stored = 0, count = 0;
    for (const id of picked) if (!vm.board?.groups.has(id)) picked.delete(id);
    for (const group of vm.board?.groups.values() ?? []) {
      if (group.stored) stored += group.pieces.length;
      if (group.owner || group.placed || !vm.isGroupVisible(group)) picked.delete(group.id);
      if (picked.has(group.id)) count += group.pieces.length;
      const container = containers.get(group.id);
      if (container) container.tint = picked.has(group.id) ? 0xffce83 : 0xffffff;
    }
    reportCollection?.(count, stored);
    requestFrame();
  }
  function submitPicked(action: "move" | "store", x = 0, y = 0) {
    vm.collect([...picked], action, x, y);
    picked.clear();
    refreshPicked();
  }
  const marquee = new Graphics();
  marquee.eventMode = "none";
  marquee.zIndex = Number.MAX_SAFE_INTEGER;
  camera.addChild(marquee);
  type MouseGesture = {
    pointer: number; start: Point; id?: string; additive: boolean; moved: boolean;
    bounds?: PuzzleBounds;
  };
  let mouseGesture: MouseGesture | undefined;
  let trayDropTarget: HTMLElement | undefined;

  function showTrayDropTarget(target?: HTMLElement, over = false) {
    if (trayDropTarget !== target) {
      trayDropTarget?.removeAttribute("data-drop-ready");
      trayDropTarget?.removeAttribute("data-drop-active");
      trayDropTarget = target;
      target?.setAttribute("data-drop-ready", "true");
    }
    target?.toggleAttribute("data-drop-active", over);
  }

  function trayDropPanel() {
    const state = vm.getSnapshot();
    if (!state.connected || !state.traysEnabled || state.viewingTray) return undefined;
    return host.parentElement?.querySelector<HTMLElement>("[data-tray-drop]") ?? undefined;
  }

  const cachedCollectionBounds = new WeakMap<number[], PuzzleBounds>();
  function collectionGroupBounds(group: PuzzleGroup) {
    let bounds = cachedCollectionBounds.get(group.pieces);
    if (!bounds) {
      bounds = puzzleGroupBounds(tiles,group.pieces);
      cachedCollectionBounds.set(group.pieces,bounds);
    }
    return bounds;
  }
  function selectionBounds(): PuzzleBounds {
    const bounds = {left:Infinity,top:Infinity,right:-Infinity,bottom:-Infinity};
    for (const id of picked) {
      const g = vm.board?.groups.get(id);
      if (!g) continue;
      const b = collectionGroupBounds(g);
      bounds.left = Math.min(bounds.left,b.left+g.dx);
      bounds.top = Math.min(bounds.top,b.top+g.dy);
      bounds.right = Math.max(bounds.right,b.right+g.dx);
      bounds.bottom = Math.max(bounds.bottom,b.bottom+g.dy);
    }
    return bounds;
  }
  function softStop(bounds: PuzzleBounds, x: number, y: number) {
    const table = boundsForTable();
    // Each axis slows independently so a collection can slide along a wall.
    const axis = (travel: number, room: number) => {
      const band = Math.min(18 / camera.scale.x, Math.max(0,room));
      if (!band) return 0;
      const free = room-band, distance = Math.abs(travel);
      if (distance <= free) return travel;
      const t = Math.min(1,(distance-free)/(2*band));
      return Math.sign(travel)*(free+band*t*(2-t));
    };
    return {dx:axis(x,x<0 ? bounds.left-table.left : table.right-bounds.right),
      dy:axis(y,y<0 ? bounds.top-table.top : table.bottom-bounds.bottom)};
  }
  function previewSelection(bounds: PuzzleBounds, x: number, y: number) {
    const slide = vm.getSnapshot().slideToEdge;
    if (slide) {
      const groups = [];
      for (const id of picked) {
        const group = vm.board?.groups.get(id);
        if (group) groups.push({ id, dx:group.dx, dy:group.dy, bounds:collectionGroupBounds(group) });
      }
      for (const {id, dx, dy} of slideCollection(groups,x,y,boundsForTable())) containers.get(id)?.position.set(dx,dy);
      return {dx:x,dy:y};
    }
    const move = softStop(bounds,x,y);
    for (const id of picked) {
      const group = vm.board?.groups.get(id);
      if (group) containers.get(id)?.position.set(group.dx+move.dx,group.dy+move.dy);
    }
    return move;
  }
  function beginMouse(event: PointerEvent, start: Point, group?: PuzzleGroup) {
    const additive = collecting || event.shiftKey;
    if (group && (group.owner || group.placed || group.stored)) return false;
    if (!additive && !(group && picked.has(group.id))) {
      if (picked.size) { picked.clear(); refreshPicked(); }
      return false;
    }
    mouseGesture = { pointer: event.pointerId, start, id: group?.id, additive, moved: false };
    return true;
  }
  function endMouseGesture() {
    mouseGesture = undefined;
    showTrayDropTarget();
    marquee.clear();
    requestFrame();
  }
  function handleMouse(event: PointerEvent, finish = false) {
    const gesture = mouseGesture;
    if (!gesture || gesture.pointer !== event.pointerId) return false;
    if (event.type === "pointercancel") {
      endMouseGesture();
      syncBoard();
      return true;
    }
    const p = localPoint(event);
    const x = p.x - gesture.start.x, y = p.y - gesture.start.y;
    if (!gesture.moved && Math.hypot(x,y)*camera.scale.x >= 5) {
      gesture.moved = true;
      if (gesture.id) {
        picked.add(gesture.id);
        refreshPicked();
        gesture.bounds = selectionBounds();
      }
    }
    if (gesture.moved && gesture.id && gesture.bounds && picked.size) {
      const panel = trayDropPanel();
      // Pointer capture keeps the drag on the canvas, so check what is under the mouse.
      const hovered = document.elementFromPoint(event.clientX, event.clientY);
      const overTray = !!panel && panel.contains(hovered);
      if (finish && overTray) {
        endMouseGesture();
        submitPicked("store");
        syncBoard();
        return true;
      }
      showTrayDropTarget(panel, overTray);
      const {dx,dy} = previewSelection(gesture.bounds,x,y);
      if (finish) vm.collect([...picked],"move",dx,dy);
    } else if (gesture.moved && !gesture.id) {
      const left=Math.min(gesture.start.x,p.x), top=Math.min(gesture.start.y,p.y);
      marquee.clear().rect(left,top,Math.abs(x),Math.abs(y))
        .fill({color:highlightColor(),alpha:.12}).stroke({color:highlightColor(),width:1.5/camera.scale.x});
      if (finish) {
        for (const g of vm.board?.groups.values() ?? []) {
          if (g.owner || g.placed || !vm.isGroupVisible(g)) continue;
          if (g.pieces.some(id => {
            const t=tiles[id]!, cx=t.x+t.width/2+g.dx, cy=t.y+t.height/2+g.dy;
            return cx>=left && cx<=left+Math.abs(x) && cy>=top && cy<=top+Math.abs(y);
          })) picked.add(g.id);
        }
        refreshPicked();
      }
    } else if (finish && !gesture.moved && gesture.id && gesture.additive) {
      if (!picked.delete(gesture.id)) picked.add(gesture.id);
      refreshPicked();
    }
    if (finish) endMouseGesture();
    requestFrame();
    return true;
  }
  function handleBatch(event: PointerEvent, finish = false) {
    if (!batchDrag || batchDrag.pointerId !== event.pointerId) return false;
    const p = localPoint(event);
    let x = p.x-batchDrag.start.x, y = p.y-batchDrag.start.y;
    if (Math.hypot(x,y)*camera.scale.x > 5) batchDrag.moved = true;
    const id = batchDrag.id;
    if (batchDrag.moved) {
      if (id) picked.add(id);
      if (picked.size) {
        batchDrag.bounds ??= selectionBounds();
        const movement = previewSelection(batchDrag.bounds,x,y);
        x = movement.dx; y = movement.dy;
      }
    }
    if (finish) {
      const moved = batchDrag.moved;
      batchDrag = undefined;
      if (event.type !== "pointercancel") {
        if (moved && picked.size) { submitPicked("move",x,y); return true; }
        else if (id) { if (!picked.delete(id)) picked.add(id); }
        else if (picked.size) {
          const first = vm.board?.groups.get(picked.values().next().value!);
          if (!first) { refreshPicked(); return true; }
          const tile = tiles[first.pieces[0]!]!;
          submitPicked("move", p.x-first.dx-tile.x-tile.width/2, p.y-first.dy-tile.y-tile.height/2);
        }
      }
      syncBoard();
    } else if (batchDrag.moved) {
      requestFrame();
    }
    return true;
  }

  return {
    get hasSelection() { return picked.size > 0; },
    get mouseActive() { return mouseGesture !== undefined; },
    get batchActive() { return batchDrag !== undefined; },
    get active() { return collecting; },
    acceptsBatch(group?: PuzzleGroup) {
      return collecting || (picked.size > 0 && (!group || picked.has(group.id)));
    },
    startBatch(pointerId: number, start: Point, id?: string) {
      batchDrag = { pointerId, start, id, moved:false };
    },
    takeEmptyBatch() {
      if (!batchDrag || batchDrag.id || batchDrag.moved) return undefined;
      const { pointerId, start } = batchDrag;
      batchDrag = undefined;
      return { pointerId, start };
    },
    beginMouse, handleMouse, handleBatch, refreshPicked, cancelMouse: endMouseGesture,
    stopGestures() {
      endMouseGesture();
      batchDrag = undefined;
    },
    clear() { picked.clear(); },
    setMode(active: boolean) {
      collecting = active;
      if (!active) picked.clear();
      refreshPicked();
    },
    storeSelected() { if (vm.getSnapshot().traysEnabled) submitPicked("store"); },
    dispose() { showTrayDropTarget(); marquee.destroy(); },
  };
}
