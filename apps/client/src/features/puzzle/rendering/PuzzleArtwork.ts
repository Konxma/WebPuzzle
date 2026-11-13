import { BOARD_HEIGHT, BOARD_WIDTH, DEFAULT_IMAGE_ID, puzzleImageUrl } from "@web-pazle/shared";
import { ImageSource, Texture } from "pixi.js";
import type { DetailBounds } from "./detailPolicy";

export interface PuzzleArtwork {
  image: HTMLImageElement;
  vectors?: string;
}

export async function loadPuzzleArtwork(imageId: string): Promise<PuzzleArtwork> {
  const url = puzzleImageUrl(imageId);
  const image = new Image();
  image.src = url;
  await image.decode();
  if (imageId !== DEFAULT_IMAGE_ID) return { image };
  const response = await fetch(url);
  if (!response.ok) throw new Error("Artwork unavailable");
  const svg = new DOMParser().parseFromString(await response.text(), "image/svg+xml");
  return { image, vectors: svg.documentElement.innerHTML };
}

async function rasterizeArtwork(artwork: PuzzleArtwork, outline: string, bounds: DetailBounds,
  resolution: number, width: number, height: number, stroke?: { color: string; width: number }) {
  // Raster photographs are decoded once. Clip the source to each visible crop directly.
  if (artwork.vectors === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    const path = new Path2D(outline);
    context.setTransform(resolution, 0, 0, resolution, -bounds.x * resolution, -bounds.y * resolution);
    context.clip(path);
    context.imageSmoothingQuality = "high";
    context.drawImage(artwork.image, 0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    if (stroke) {
      context.strokeStyle = stroke.color;
      context.lineWidth = stroke.width;
      context.lineJoin = "round";
      context.stroke(path);
    }
    // Yield between crops so a large photo puzzle stays interactive while textures refine.
    return createImageBitmap(canvas);
  }

  const edge = stroke ? `<path d="${outline}" fill="none" stroke="${stroke.color}" stroke-width="${stroke.width}" stroke-linejoin="round"/>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${bounds.x} ${bounds.y} ${width / resolution} ${height / resolution}"><defs><clipPath id="shape"><path d="${outline}" clip-rule="nonzero"/></clipPath></defs><g clip-path="url(#shape)">${artwork.vectors}${edge}</g></svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    return image;
  } finally { URL.revokeObjectURL(url); }
}

export async function artworkTexture(artwork: PuzzleArtwork, outline: string, bounds: DetailBounds,
  resolution: number, width: number, height: number, stroke: { color: string; width: number } | undefined) {
  const resource = await rasterizeArtwork(artwork, outline, bounds, resolution, width, height, stroke);
  const source = new ImageSource({
    // These are already viewport-sized crops, not the fallback atlas. One linear
    // sample of the oversampled original keeps curves smooth without blurry mip blends.
    resource, resolution, scaleMode: "linear", autoGenerateMipmaps: false,
  });
  if (resource instanceof ImageBitmap) source.once("destroy", () => resource.close());
  return new Texture({ source });
}
