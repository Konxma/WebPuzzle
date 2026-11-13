import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { BOARD_WIDTH, BOARD_HEIGHT, pathData, type Tile } from "@web-pazle/shared";
import { Icon } from "../../../shared/ui/Icon";

export function PuzzleReference({ src, name, comparedTile, onClose }: {
  src: string; name: string; comparedTile?: Tile; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number }>();
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const cropCenter = useRef({ x: .5, y: .5 });

  function clampPosition(x: number, y: number) {
    const window = panel.current;
    const board = window?.parentElement;
    if (!window || !board) return { x, y };
    return {
      x: Math.max(0, Math.min(board.clientWidth - window.offsetWidth, x)),
      y: Math.max(0, Math.min(board.clientHeight - window.offsetHeight, y)),
    };
  }

  useEffect(() => {
    const window = panel.current;
    const board = window?.parentElement;
    if (!window || !board) return;
    const observer = new ResizeObserver(() => setPosition(previous => previous && clampPosition(previous.x, previous.y)));
    observer.observe(board);
    observer.observe(window);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const box = viewport.current;
    if (box) {
      box.scrollLeft = cropCenter.current.x * box.scrollWidth - box.clientWidth / 2;
      box.scrollTop = cropCenter.current.y * box.scrollHeight - box.clientHeight / 2;
    }
  }, [zoom]);

  useLayoutEffect(() => {
    const box = viewport.current;
    if (!box || !comparedTile || zoom === 1) return;
    const x = (comparedTile.x + comparedTile.width / 2) / BOARD_WIDTH * box.scrollWidth;
    const y = (comparedTile.y + comparedTile.height / 2) / BOARD_HEIGHT * box.scrollHeight;
    if (x < box.scrollLeft || x > box.scrollLeft + box.clientWidth) box.scrollLeft = x - box.clientWidth / 2;
    if (y < box.scrollTop || y > box.scrollTop + box.clientHeight) box.scrollTop = y - box.clientHeight / 2;
  }, [comparedTile, zoom]);

  function changeZoom(factor: number) {
    const box = viewport.current;
    if (box) cropCenter.current = {
      x: (box.scrollLeft + box.clientWidth / 2) / box.scrollWidth,
      y: (box.scrollTop + box.clientHeight / 2) / box.scrollHeight,
    };
    setZoom(current => factor === 1 ? 1 : Math.min(4, Math.max(1, current * factor)));
  }

  function startDrag(event: PointerEvent<HTMLElement>, left: number, top: number) {
    if (event.button !== 0 || !event.isPrimary) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left, top };
  }

  function dragOffset(event: PointerEvent<HTMLElement>) {
    const start = drag.current;
    if (start?.id !== event.pointerId) return;
    return { x: start.left + event.clientX - start.x, y: start.top + event.clientY - start.y };
  }

  function stopDrag(event: PointerEvent<HTMLElement>) {
    if (drag.current?.id === event.pointerId) drag.current = null;
  }

  return <div className="reference" ref={panel} role="group" aria-label="Зразок картини"
    style={position && { left: position.x, top: position.y, right: "auto" }}>
    <header className="reference-header">
      <span className="reference-handle" title="Перетягніть, щоб пересунути зразок"
        onPointerDown={event => {
          const window = panel.current;
          if (window) startDrag(event, window.offsetLeft, window.offsetTop);
        }}
        onPointerMove={event => {
          const next = dragOffset(event);
          if (next) setPosition(clampPosition(next.x, next.y));
        }}
        onLostPointerCapture={stopDrag}>Зразок картини</span>
      <button type="button" className="button quiet-button" aria-label="Закрити зразок" title="Закрити зразок" onClick={onClose}>
        <Icon name="close"/>
      </button>
    </header>
    <div ref={viewport} className="reference-viewport" data-zoomed={zoom > 1}
      tabIndex={zoom > 1 ? 0 : undefined} aria-label="Фрагмент картини"
      onPointerDown={event => {
        if (zoom > 1) startDrag(event, event.currentTarget.scrollLeft, event.currentTarget.scrollTop);
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (start?.id === event.pointerId) {
          event.currentTarget.scrollLeft = start.left + start.x - event.clientX;
          event.currentTarget.scrollTop = start.top + start.y - event.clientY;
        }
      }}
      onLostPointerCapture={stopDrag}>
      <div className="reference-image" style={{ width: `${zoom * 100}%` }}>
        <img src={src} alt={name} draggable={false}/>
        {comparedTile && <svg className="reference-highlight" viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`} aria-hidden="true">
          <path d={pathData(comparedTile)} vectorEffect="non-scaling-stroke"/>
        </svg>}
      </div>
    </div>
    <div className="reference-controls" role="group" aria-label="Масштаб зразка">
      <button type="button" className="button quiet-button" aria-label="Віддалити зразок" disabled={zoom === 1}
        onClick={() => changeZoom(.8)}>−</button>
      <button type="button" className="button quiet-button" aria-label="Уся картина" onClick={() => changeZoom(1)}>
        {Math.round(zoom * 100)}%
      </button>
      <button type="button" className="button quiet-button" aria-label="Наблизити зразок" disabled={zoom === 4}
        onClick={() => changeZoom(1.25)}>+</button>
    </div>
  </div>;
}
