import { useEffect, useRef } from "react";
import { BOARD_HEIGHT, BOARD_WIDTH } from "@web-pazle/shared";
import { watchDisplayDensity } from "../../puzzle/rendering/displayDensity";

export interface PreviewCamera {
  scale: number;
  x: number;
  y: number;
}

export function PuzzlePreviewCanvas({ src, outline, camera, label }: {
  src: string; outline: string; camera: PreviewCamera; label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const current = useRef(camera);
  const target = useRef(camera);
  const redraw = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const surface = canvas;
    const paint = context;
    const image = new Image();
    image.src = src;
    const path = new Path2D(outline);
    let disposed = false;

    function draw() {
      if (disposed || image.naturalWidth === 0) return;
      const width = surface.getBoundingClientRect().width;
      if (!width) return;
      const density = Math.min(4, (window.devicePixelRatio || 1) * 2);
      const pixels = Math.min(4096, Math.max(1, Math.round(width * density)));
      const height = Math.max(1, Math.round(pixels * BOARD_HEIGHT / BOARD_WIDTH));
      if (surface.width !== pixels || surface.height !== height) {
        surface.width = pixels;
        surface.height = height;
      }
      const { scale, x, y } = current.current;
      paint.setTransform(1, 0, 0, 1, 0, 0);
      paint.clearRect(0, 0, pixels, height);
      const factorX = pixels / BOARD_WIDTH * scale;
      const factorY = height / BOARD_HEIGHT * scale;
      paint.setTransform(factorX, 0, 0, factorY, pixels * (.5 - x * scale), height * (.5 - y * scale));

      const cropWidth = Math.min(image.naturalWidth, image.naturalHeight * BOARD_WIDTH / BOARD_HEIGHT);
      const cropHeight = cropWidth * BOARD_HEIGHT / BOARD_WIDTH;
      paint.imageSmoothingEnabled = true;
      paint.imageSmoothingQuality = "high";
      paint.drawImage(image, (image.naturalWidth - cropWidth) / 2, (image.naturalHeight - cropHeight) / 2,
        cropWidth, cropHeight, 0, 0, BOARD_WIDTH, BOARD_HEIGHT);
      // Keep the seam width constant on screen, even when zooming or moving the board.
      paint.lineWidth = BOARD_WIDTH / width / scale;
      paint.lineCap = "round";
      paint.lineJoin = "round";
      paint.strokeStyle = "rgba(23, 32, 25, 0.58)";
      paint.stroke(path);
    }

    redraw.current = draw;
    const observer = new ResizeObserver(draw);
    observer.observe(surface);
    const stopWatchingDensity = watchDisplayDensity(draw);
    image.decode().then(draw).catch(() => {
      if (!disposed) surface.setAttribute("aria-label", "Не вдалося відкрити зображення");
    });
    return () => {
      disposed = true;
      redraw.current = null;
      observer.disconnect();
      stopWatchingDensity();
    };
  }, [src, outline]);

  useEffect(() => {
    const zoomChanged = target.current.scale !== camera.scale;
    target.current = camera;
    if (!zoomChanged || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      current.current = camera;
      redraw.current?.();
      return;
    }

    const from = current.current;
    const started = performance.now();
    let frame = requestAnimationFrame(animate);
    function animate(now: number) {
      const progress = Math.min(1, (now - started) / 210);
      const t = 1 - (1 - progress) ** 3;
      const scale = from.scale + (camera.scale - from.scale) * t;
      // Interpolate translations in screen space to keep the zoom point in place.
      current.current = {
        scale,
        x: (from.x * from.scale * (1 - t) + camera.x * camera.scale * t) / scale,
        y: (from.y * from.scale * (1 - t) + camera.y * camera.scale * t) / scale,
      };
      redraw.current?.();
      if (progress < 1) frame = requestAnimationFrame(animate);
    }

    return () => cancelAnimationFrame(frame);
  }, [camera]);

  return <canvas ref={canvasRef} className="preview-board" role="img" aria-label={label}/>;
}
