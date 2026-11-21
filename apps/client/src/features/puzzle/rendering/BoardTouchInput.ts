import type { Container } from "pixi.js";
import { clampGroupToTable, puzzleGroupBounds, type Point, type PuzzleBounds, type PuzzleGroup, type Tile } from "@web-pazle/shared";
import type { PuzzleViewModel } from "../viewmodels/PuzzleViewModel";

interface TouchContext {
  vm: PuzzleViewModel;
  canvas: HTMLCanvasElement;
  tiles: Tile[];
  containers: ReadonlyMap<string, Container>;
  point(event: PointerEvent): Point;
  localPoint(event: PointerEvent): Point;
  scale(): number;
  table(): PuzzleBounds;
  gestureBlocked(): boolean;
  pointing(): boolean;
  selecting(): boolean;
  tileIdAt(point: Point): number | null;
  pointAt(point: Point, tileId: number | null): void;
  requestFrame(): void;
  raise(container: Container): void;
}

export function createBoardTouchInput({
  vm, canvas, tiles, containers, point, localPoint, scale, table, gestureBlocked,
  pointing, selecting, tileIdAt, pointAt, requestFrame, raise,
}: TouchContext) {
  const fingers = new Map<number, { id: string; start: Point; pointer: Point; bounds: PuzzleBounds; grabbed: boolean }>();
  const markerTouches = new Set<number>();
  let markerTap: { pointerId: number; start: Point; time: number; tileId: number | null; armed: boolean } | undefined;
  let markerSeries: { start: Point; time: number; tileId: number | null; count: number } | undefined;
  const tapDistance = 12;
  const distance = (a: Point, b: Point) => Math.hypot(a.x-b.x,a.y-b.y);

  function beginMarkerTap(event: PointerEvent) {
    if (event.pointerType !== "touch" || event.target !== canvas) return false;
    markerTouches.add(event.pointerId);
    if (markerTouches.size !== 1 || gestureBlocked() || !vm.getSnapshot().connected) {
      markerTap = markerSeries = undefined;
      return false;
    }
    const armed = pointing();
    if (vm.getSnapshot().viewingTray) { markerSeries = undefined; return false; }
    if (!armed && (selecting())) { markerSeries = undefined; return false; }
    const start = point(event);
    markerTap = { pointerId:event.pointerId, start, time:event.timeStamp,
      tileId:tileIdAt(start), armed };
    if (!armed) return false;
    event.stopPropagation();
    canvas.setPointerCapture(event.pointerId);
    return true;
  }

  function finishMarkerTap(event: PointerEvent) {
    if (!markerTouches.delete(event.pointerId) || markerTap?.pointerId !== event.pointerId) return;
    const tap = markerTap;
    markerTap = undefined;
    if (event.type !== "pointerup" || event.timeStamp-tap.time > 300 ||
      distance(tap.start,point(event)) > tapDistance) {
      markerSeries = undefined;
      return;
    }
    if (tap.armed && pointing()) {
      pointAt(tap.start,tap.tileId);
      return;
    }
    if (tap.armed) return;
    const previous = markerSeries;
    const close = previous && event.timeStamp-previous.time <= 380 &&
      previous.tileId === tap.tileId && distance(previous.start,tap.start) <= 36;
    const count = close ? previous.count+1 : 1;
    if (count < 3) {
      markerSeries = { start:close ? previous.start : tap.start, time:event.timeStamp, tileId:tap.tileId, count };
      return;
    }
    markerSeries = undefined;
    const state = vm.getSnapshot();
    if (state.players.some(player => player.id !== state.selfId && player.connected)) pointAt(tap.start,tap.tileId);
    else vm.showBoardNotice("Запроси напарника, щоб показувати йому місця на столі");
  }
  function handleFinger(event: PointerEvent, finish = false) {
    const finger = fingers.get(event.pointerId);
    if (!finger) return false;
    const p = localPoint(event);
    if (!finger.grabbed) {
      if (finish) { fingers.delete(event.pointerId); return true; }
      if (distance(p,finger.pointer)*scale() < 5) return true;
      markerTap = markerSeries = undefined;
      finger.grabbed = true;
      vm.grab(finger.id,true);
      startFingerSync();
      const item = containers.get(finger.id);
      if (item) raise(item);
    }
    const {dx,dy} = clampGroupToTable(finger.bounds, finger.start.x+p.x-finger.pointer.x, finger.start.y+p.y-finger.pointer.y, table());
    const container = containers.get(finger.id);
    container?.position.set(dx,dy);
    if (finish) {
      fingers.delete(event.pointerId);
      if (event.type === "pointercancel") vm.cancelDrag(finger.id,finger.start.x,finger.start.y);
      else vm.release(finger.id,dx,dy);
    }
    requestFrame();
    return true;
  }
  let syncFingers: ReturnType<typeof setInterval> | undefined;
  function startFingerSync() {
    if (syncFingers) return;
    syncFingers = setInterval(() => {
      if (!fingers.size) {
        stopSync();
        return;
      }
      vm.moveFingers([...fingers.values()].flatMap(({id,grabbed}) => {
        const container = grabbed ? containers.get(id) : undefined;
        return container ? [{ id, x:container.x, y:container.y }] : [];
      }));
    }, 65);
  }

  function stopSync() {
    clearInterval(syncFingers);
    syncFingers = undefined;
  }

  return {
    get dragging() { return fingers.size > 0; },
    beginMarkerTap, finishMarkerTap, handleFinger,
    resetMarkerSeries() { markerSeries = undefined; },
    trackMarkerTap(event: PointerEvent) {
      if (markerTap?.pointerId === event.pointerId && distance(markerTap.start,point(event)) > tapDistance) {
        markerTap = markerSeries = undefined;
      }
    },
    startFinger(pointerId: number, position: Point, group: PuzzleGroup) {
      if ([...fingers.values()].some(finger => finger.id === group.id)) return;
      fingers.set(pointerId, { id:group.id, start:{ x:group.dx, y:group.dy },
        pointer:position, bounds:puzzleGroupBounds(tiles,group.pieces), grabbed:false });
    },
    keepsLocalPosition(group: PuzzleGroup, selfId: string) {
      const active = [...fingers].find(([, finger]) => finger.id === group.id);
      if (!active) return false;
      if (!group.placed && !group.stored && (!group.owner || group.owner === selfId)) return true;
      fingers.delete(active[0]);
      return false;
    },
    clearFingers() { fingers.clear(); },
    onBlur() {
      markerTouches.clear();
      markerTap = markerSeries = undefined;
      for (const finger of fingers.values()) {
        if (finger.grabbed) vm.cancelDrag(finger.id,finger.start.x,finger.start.y);
      }
      fingers.clear();
    },
    dispose: stopSync,
  };
}
