import { Application, CanvasSource, Texture } from "pixi.js";
import { BOARD_WIDTH, BOARD_HEIGHT, pathData, type Tile } from "@web-pazle/shared";
import type { PuzzleArtwork } from "./PuzzleArtwork";
import { detailResolution } from "./detailPolicy";

export function createPieceAtlas(app: Application, tiles: Tile[], artwork: PuzzleArtwork) {
  const atlas = document.createElement("canvas");
  atlas.width = 4096;
  const slots = new Map<number, { x: number; y: number; w: number; h: number; margin: number }>();
  const paths = new Map<number, Path2D>();
  let x = 2, y = 2, rowHeight = 0;
  for (const tile of tiles) {
    const margin = Math.ceil(Math.min(tile.width, tile.height) * .26) + 2;
    const w = Math.ceil(tile.width) + margin * 2, h = Math.ceil(tile.height) + margin * 2;
    if (x + w > atlas.width) {
      x = 2;
      y += rowHeight + 4;
      rowHeight = 0;
    }
    slots.set(tile.id, { x, y, w, h, margin });
    paths.set(tile.id, new Path2D(pathData(tile)));
    x += w + 4;
    rowHeight = Math.max(rowHeight, h);
  }
  atlas.height = y + rowHeight + 2;
  const context = atlas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  const baseWidth = atlas.width, baseHeight = atlas.height;
  const gl = "gl" in app.renderer ? app.renderer.gl as WebGLRenderingContext : null;
  const maxTextureSize = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) as number : 4096;
  const limit = Math.min(2, maxTextureSize / baseWidth, maxTextureSize / baseHeight);
  const texture = new Texture({ source: new CanvasSource({
    resource: atlas, scaleMode:"linear", autoGenerateMipmaps:false,
  }) });
  let currentResolution = 0;
  return {
    slots, paths, texture,
    refresh(scale: number) {
      const resolution = Math.min(limit, detailResolution(scale, app.renderer.resolution));
      if (resolution === currentResolution) return;
      // Redraw one shared texture from the original instead of resizing individual pieces.
      atlas.width = Math.ceil(baseWidth * resolution);
      atlas.height = Math.ceil(baseHeight * resolution);
      context.setTransform(resolution, 0, 0, resolution, 0, 0);
      context.imageSmoothingQuality = "high";
      for (const tile of tiles) {
        const slot = slots.get(tile.id)!;
        const path = paths.get(tile.id)!;
        context.save();
        context.translate(slot.x + slot.margin - tile.x, slot.y + slot.margin - tile.y);
        context.clip(path);
        context.drawImage(artwork.image, 0, 0, BOARD_WIDTH, BOARD_HEIGHT);
        context.strokeStyle = "rgba(25,45,39,.42)";
        context.lineWidth = 1;
        context.stroke(path);
        context.restore();
      }
      texture.source.resolution = resolution;
      texture.source.update();
      currentResolution = resolution;
    },
  };
}
