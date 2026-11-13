import type { IncomingMessage, ServerResponse } from "node:http";
import { isPuzzleFileId, MAX_PUZZLE_PHOTO_BYTES } from "@web-pazle/shared";
import { puzzleLibrary } from "../../infrastructure/PuzzleLibrary.js";

function json(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}

// The browser sends a normalized JPEG. Check the frame dimensions before storing bytes.
function isBoundedJpeg(bytes: Buffer) {
  if (bytes.length < 12 || bytes.readUInt16BE(0) !== 0xffd8 || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) return false;
  let hasFrame = false;
  for (let offset = 2; offset + 4 <= bytes.length;) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    if (offset + 3 > bytes.length) return false;
    const marker = bytes[offset++]!;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return false;
    if (marker === 0xda) return hasFrame && offset + length < bytes.length - 2;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (hasFrame || length < 8 || bytes[offset + 2] !== 8) return false;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      if (!height || !width || height > 2000 || width > 3200) return false;
      hasFrame = true;
    }
    offset += length;
  }
  return false;
}

export async function uploadPhoto(request: IncomingMessage, response: ServerResponse) {
  if (request.headers["sec-fetch-site"] === "cross-site") return json(response, 403, { error: "Запит з іншого сайту" });
  if (request.headers["content-type"] !== "image/jpeg") return json(response, 415, { error: "Потрібне зображення JPEG" });
  if (Number(request.headers["content-length"]) > MAX_PUZZLE_PHOTO_BYTES) return json(response, 413, { error: "Фото завелике" });
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > MAX_PUZZLE_PHOTO_BYTES) {
        request.resume();
        return json(response, 413, { error: "Фото завелике" });
      }
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks, size);
    if (!isBoundedJpeg(bytes)) return json(response, 422, { error: "Не вдалося прочитати фото" });
    return json(response, 201, { imageId: puzzleLibrary.addPhoto(bytes) });
  } catch {
    return json(response, 500, { error: "Не вдалося зберегти фото на ПК господаря" });
  }
}

function requestId(request: IncomingMessage) {
  return request.url?.split("?", 1)[0]?.split("/").at(-1);
}

export function getPhoto(request: IncomingMessage, response: ServerResponse) {
  const id = requestId(request);
  if (!isPuzzleFileId(id)) return json(response, 404, { error: "Фото не знайдено" });
  try {
    const bytes = puzzleLibrary.photo(id);
    response.writeHead(200, {
      "Content-Type": "image/jpeg", "Content-Length": bytes.length,
      "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff",
    });
    response.end(bytes);
  } catch { return json(response, 404, { error: "Фото не знайдено" }); }
}

export function deleteSave(request: IncomingMessage, response: ServerResponse) {
  if (request.headers["sec-fetch-site"] === "cross-site") return json(response, 403, { error: "Запит з іншого сайту" });
  // The unguessable save key is shared only with the puzzle creator.
  const key = requestId(request);
  if (!isPuzzleFileId(key)) return json(response, 404, { error: "Збереження не знайдено" });
  try {
    if (!puzzleLibrary.remove(key)) return json(response, 409, { error: "Пазл відкритий у кімнаті" });
    response.writeHead(204, { "Cache-Control": "no-store" }).end();
  } catch {
    return json(response, 500, { error: "Не вдалося видалити збереження" });
  }
}

export function getSaveStatus(request: IncomingMessage, response: ServerResponse) {
  const key = requestId(request);
  if (!isPuzzleFileId(key) || !puzzleLibrary.hasSave(key)) return json(response, 404, { error: "Збереження не знайдено на ПК господаря" });
  try {
    return json(response, 200, { roomId: puzzleLibrary.activeRoom(key) ?? null, ...puzzleLibrary.details(key) });
  } catch {
    return json(response, 500, { error: "Не вдалося прочитати збереження" });
  }
}
