import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_IMAGE_ID, DEFAULT_PUZZLE_SHAPE, isPuzzleFileId, isPuzzleShape, type GameSnapshot } from "@web-pazle/shared";

const directory = process.env.WEBPAZLE_DATA_DIR ?? fileURLToPath(new URL("../../../../.data/", import.meta.url));
const activeRooms = new Map<string, string>();

function file(folder: "saves" | "photos", id: string, extension: string) {
  if (!isPuzzleFileId(id)) throw new Error("Invalid puzzle file ID");
  return join(directory, folder, `${id}.${extension}`);
}

export const puzzleLibrary = {
  activeRoom: (key: string) => activeRooms.get(key),
  claim(key: string, roomId: string) {
    if (activeRooms.has(key)) throw new Error("This saved puzzle is already open");
    activeRooms.set(key, roomId);
  },
  close(key: string, roomId: string) {
    if (activeRooms.get(key) === roomId) activeRooms.delete(key);
  },
  hasSave(key: string) {
    return existsSync(file("saves", key, "json"));
  },
  details(key: string) {
    const { definition, groups } = this.load(key);
    return {
      shape: definition.shape ?? DEFAULT_PUZZLE_SHAPE,
      placed: groups.reduce((count, group) => count + (group.placed ? group.pieces.length : 0), 0),
      savedAt: statSync(file("saves", key, "json")).mtimeMs,
    };
  },
  remove(key: string) {
    if (activeRooms.has(key)) return false;
    rmSync(file("saves", key, "json"), { force: true });
    return true;
  },
  load(key: string): GameSnapshot {
    const data = JSON.parse(readFileSync(file("saves", key, "json"), "utf8"));
    if (data?.version !== 1 || !Array.isArray(data.snapshot?.groups) || !isPuzzleFileId(data.snapshot.definition?.id) ||
      !Number.isInteger(data.snapshot.definition.seed) || !this.hasImage(data.snapshot.definition.imageId) ||
      (data.snapshot.definition.shape !== undefined && !isPuzzleShape(data.snapshot.definition.shape))) {
      throw new Error("Invalid saved puzzle");
    }
    return data.snapshot;
  },
  save(key: string, snapshot: GameSnapshot) {
    const target = file("saves", key, "json");
    const pending = `${target}.tmp`;
    mkdirSync(join(directory, "saves"), { recursive: true });
    // Replace the previous snapshot only once its successor is fully on disk.
    try {
      writeFileSync(pending, JSON.stringify({ version: 1, snapshot }), { flush: true });
      renameSync(pending, target);
    } finally {
      rmSync(pending, { force: true });
    }
  },
  hasImage(id: unknown): id is string {
    return id === DEFAULT_IMAGE_ID || isPuzzleFileId(id) && existsSync(file("photos", id, "jpg"));
  },
  addPhoto(bytes: Buffer) {
    const id = randomUUID();
    mkdirSync(join(directory, "photos"), { recursive: true });
    writeFileSync(file("photos", id, "jpg"), bytes, { flag: "wx" });
    return id;
  },
  photo(id: string) {
    return readFileSync(file("photos", id, "jpg"));
  },
};
