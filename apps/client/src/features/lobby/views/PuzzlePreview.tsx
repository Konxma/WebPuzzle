import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { DEFAULT_IMAGE_ID, puzzleImageUrl, puzzleSeamPath, type PuzzleShape } from "@web-pazle/shared";
import { PuzzlePreviewCanvas, type PreviewCamera } from "./PuzzlePreviewCanvas";
import { pieceNoun } from "../../../shared/format";

interface PreviewProps {
  pieceCount: number;
  shape: PuzzleShape;
  shapeLabel: string;
  name: string;
  customPhoto: boolean;
  photo: File | null;
}

const ZOOM_LEVELS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5];
const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!;
const FULL_VIEW: PreviewCamera = { scale: 1, x: .5, y: .5 };

function keepInPicture(camera: PreviewCamera): PreviewCamera {
  const margin = .5 / camera.scale;
  return {
    ...camera,
    x: Math.min(1 - margin, Math.max(margin, camera.x)),
    y: Math.min(1 - margin, Math.max(margin, camera.y)),
  };
}

function zoomAt(camera: PreviewCamera, scale: number, x = .5, y = .5): PreviewCamera {
  const next = Math.min(MAX_ZOOM, Math.max(1, scale));
  if (next === camera.scale) return camera;
  const shift = 1 / camera.scale - 1 / next;
  return keepInPicture({ scale: next, x: camera.x + (x - .5) * shift, y: camera.y + (y - .5) * shift });
}

function stepScale(scale: number, direction: 1 | -1): number {
  return direction === 1
    ? ZOOM_LEVELS.find(level => level > scale + .001) ?? MAX_ZOOM
    : [...ZOOM_LEVELS].reverse().find(level => level < scale - .001) ?? 1;
}

export function PuzzlePreview({ pieceCount, shape, shapeLabel, name, customPhoto, photo }: PreviewProps) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [camera, setCamera] = useState(FULL_VIEW);
  const [dragging, setDragging] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const boardId = useId();
  const outline = useMemo(() => puzzleSeamPath(pieceCount, 42, shape), [pieceCount, shape]);
  const imageUrl = customPhoto ? photoUrl : puzzleImageUrl(DEFAULT_IMAGE_ID);
  const zoomed = camera.scale > 1;

  useEffect(() => {
    const url = photo ? URL.createObjectURL(photo) : null;
    setPhotoUrl(url);
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [photo]);

  useEffect(() => {
    setCamera(FULL_VIEW);
    drag.current = null;
    setDragging(false);
    const element = viewport.current;
    if (!element || !imageUrl) return;

    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      const rect = element!.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      setCamera(current => zoomAt(current, current.scale * Math.exp(-pixels * .004), x, y));
    }

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [imageUrl]);

  function stepZoom(direction: 1 | -1) {
    setCamera(current => zoomAt(current, stepScale(current.scale, direction)));
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!zoomed || event.button !== 0 || !event.isPrimary) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setDragging(true);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const previous = drag.current;
    if (previous?.id !== event.pointerId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - previous.x) / rect.width;
    const dy = (event.clientY - previous.y) / rect.height;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setCamera(current => keepInPicture({
      ...current, x: current.x - dx / current.scale, y: current.y - dy / current.scale,
    }));
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "+" || event.key === "=" || event.key === "-") {
      event.preventDefault();
      stepZoom(event.key === "-" ? -1 : 1);
    } else if (event.key === "Home" && zoomed) {
      event.preventDefault();
      setCamera(FULL_VIEW);
    } else if (zoomed && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const dx = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      const dy = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      setCamera(current => keepInPicture({
        ...current, x: current.x + dx * .12 / current.scale, y: current.y + dy * .12 / current.scale,
      }));
    }
  }

  return <figure className="puzzle-figure">
    <div className="preview-heading">
      <h2>Попередній перегляд</h2>
      {imageUrl && <div className="preview-zoom-controls" role="group" aria-label="Масштаб перегляду">
        <button type="button" className="button quiet-button preview-zoom-step" aria-label="Віддалити" title="Віддалити"
          aria-controls={boardId} disabled={!zoomed} onClick={() => stepZoom(-1)}>−</button>
        <button type="button" className="button quiet-button preview-zoom-reset" aria-controls={boardId} disabled={!zoomed}
          title="Уся картина" aria-label={`Уся картина, поточний масштаб ${Math.round(camera.scale * 100)}%`}
          onClick={() => setCamera(FULL_VIEW)}>{Math.round(camera.scale * 100)}%</button>
        <button type="button" className="button quiet-button preview-zoom-step" aria-label="Наблизити" title="Наблизити"
          aria-controls={boardId} disabled={camera.scale >= MAX_ZOOM} onClick={() => stepZoom(1)}>+</button>
      </div>}
    </div>
    <div className="art-surface">
      {imageUrl ? <div id={boardId} ref={viewport} className="preview-viewport" data-zoomed={zoomed} data-dragging={dragging}
        role="group" tabIndex={0} aria-label="Картина. Плюс і мінус змінюють масштаб, стрілки пересувають збільшену картину."
        onKeyDown={onKeyDown} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} onLostPointerCapture={onPointerEnd}>
        <PuzzlePreviewCanvas src={imageUrl} outline={outline} camera={camera}
          label={`${name}, ${pieceCount} ${pieceNoun(pieceCount)}`}/>
      </div> : <div className="preview-board preview-empty">Виберіть або вставте фото для перегляду</div>}
    </div>
    <figcaption>
      <span className="preview-name">{name}</span>
      <span>{pieceCount} {pieceNoun(pieceCount)} · {shapeLabel}</span>
    </figcaption>
  </figure>;
}
