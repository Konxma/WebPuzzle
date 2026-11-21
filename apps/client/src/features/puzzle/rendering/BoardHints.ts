import type { Application, Container } from "pixi.js";
import { BOARD_MARKER_DURATION, type BoardMarker } from "@web-pazle/shared";
import type { DetailPiece } from "./SharpPieceTextures";

export function createBoardHints(
  host: HTMLElement, app: Application, camera: Container,
  requestFrame: () => void,
  pieceAt: (tileId: number) => DetailPiece | undefined,
  groupAt: (tileId: number) => Container | undefined,
  pathAt: (tileId: number) => Path2D | undefined,
  centerOnTile: (tileId: number | undefined, fallback?: BoardMarker["position"]) => void,
  clearMarker: (marker: BoardMarker) => void,
) {
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
    if (hint && !hintDirection.disabled) centerOnTile(hint.tileId, marker?.position);
  });
  host.appendChild(hintDirection);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const redrawHint = () => requestFrame();
  reducedMotion.addEventListener("change", redrawHint);
  let hintColor = "#275b49", hintContrast = "#f5fbed";
  let hint: { tileId: number | undefined; startedAt: number } | undefined;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  let hintPainted = false;
  let marker: BoardMarker | null = null;
  function clearHint() {
    clearTimeout(hintTimer);
    hint = undefined;
    marker = null;
    hintDirection.hidden = true;
    if (hintPainted) requestFrame();
  }
  function dismissHint() {
    const received = marker;
    clearHint();
    if (received) clearMarker(received);
  }
  function showHint(tileId: number) {
    clearHint();
    if (pathAt(tileId)) startHint(tileId, BOARD_MARKER_DURATION);
  }
  function startHint(tileId: number | undefined, duration: number) {
    hint = { tileId, startedAt: performance.now() };
    hintTimer = setTimeout(dismissHint, duration);
    requestFrame();
  }
  function drawHint() {
    if (hintPainted) {
      hintCtx.resetTransform();
      hintCtx.clearRect(0, 0, hintCanvas.width, hintCanvas.height);
      hintPainted = false;
    }
    if (!hint) return;
    const { tileId } = hint;
    const piece = tileId === undefined ? undefined : pieceAt(tileId);
    const group = tileId === undefined ? undefined : groupAt(tileId);
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
      if (moving) requestFrame();
      return;
    }
    const lineWidth = 2 + pulse * 1.6;

    hintCtx.setTransform(density * scale, 0, 0, density * scale, density * x, density * y);
    hintCtx.lineJoin = "round";
    hintCtx.globalAlpha = .82 + pulse * .18;
    hintCtx.strokeStyle = hintContrast;
    hintCtx.lineWidth = (lineWidth + 2.5) / scale;
    hintCtx.stroke(pathAt(tileId)!);
    hintCtx.strokeStyle = hintColor;
    hintCtx.lineWidth = lineWidth / scale;
    hintCtx.stroke(pathAt(tileId)!);

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
    requestFrame();
  }
  return {
    draw: drawHint, showHint, clearHint, dismissHint,
    get tileId() { return hint?.tileId; },
    get color() { return hintColor; },
    setPalette(palette: CSSStyleDeclaration) {
      hintColor = palette.getPropertyValue("--hint-color").trim() || "#275b49";
      hintContrast = palette.getPropertyValue("--hint-contrast").trim() || "#f5fbed";
    },
    setCameraLocked(locked: boolean) { hintDirection.disabled = locked; },
    showMarker(next: BoardMarker | null, tileId: number | undefined, duration: number) {
      clearHint();
      if (!next) return;
      marker = next;
      startHint(tileId !== undefined && pathAt(tileId) ? tileId : undefined, duration);
    },
    dispose() {
      clearTimeout(hintTimer);
      reducedMotion.removeEventListener("change", redrawHint);
      hintCanvas.remove();
      hintDirection.remove();
    },
  };
}
