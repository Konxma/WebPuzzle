import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@colyseus/sdk";

// A synthetic 8 by 5 JPEG used to exercise the real upload and download routes.
const photo = Buffer.from("/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAFAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD8rZpFlcMsSQgKq7UJwSAATyTySMntknAAwKKKKBt3dz//2Q==", "base64");

function nextMessage(room, kind, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error(`No ${kind} received`)); }, 5000);
    const off = room.onMessage(kind, value => {
      if (predicate(value)) { clearTimeout(timer); off(); resolve(value); }
    });
  });
}

async function snapshot(room) {
  room.onMessage("players", () => {});
  room.onMessage("delta", () => {});
  const received = nextMessage(room, "snapshot");
  room.send("sync");
  return received;
}

test("photo and progress survive restart and old tray pieces return to the table", { timeout: 25000 }, async t => {
  const tempRoot = await realpath(tmpdir());
  const data = await mkdtemp(join(tempRoot, "webpazle-save-test-"));
  const probe = createServer().listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  const url = `http://127.0.0.1:${port}`;
  const client = new Client(url);
  const serverPath = fileURLToPath(new URL("../dist/main.js", import.meta.url));
  let server;
  async function start() {
    server = spawn(process.execPath, [serverPath], { env: { ...process.env, PORT: String(port), WEBPAZLE_DATA_DIR: data }, stdio: ["ignore", "ignore", "pipe"] });
    let errors = "";
    server.stderr.on("data", chunk => { errors += chunk; });
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error(errors || "Server exited during startup");
      const response = await fetch(`${url}/api/health`).catch(() => null);
      if (response?.ok) { await response.text(); return; }
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error(errors || "Server did not start");
  }
  async function stop() {
    if (!server || server.exitCode !== null || server.signalCode !== null) return;
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
  t.after(async () => {
    await stop();
    const resolved = await realpath(data);
    assert.ok(resolved.startsWith(tempRoot + sep + "webpazle-save-test-"));
    await rm(resolved, { force: true, recursive: true });
  });
  await start();
  const upload = bytes => fetch(`${url}/api/photos`, { method: "POST", body: bytes, headers: { "Content-Type": "image/jpeg" } });
  assert.equal((await upload(Buffer.from("<svg/>"))).status, 422);
  const response = await upload(photo);
  assert.equal(response.status, 201);
  const { imageId } = await response.json();

  await assert.rejects(() => client.create("puzzle", { pieceCount: 1000, imageId, shape: "invalid" }));
  const host = await client.create("puzzle", { pieceCount: 1000, imageId, shape: "classic-wide" });
  const initial = await snapshot(host);
  assert.ok(initial.saveKey);
  const guest = await client.joinById(host.roomId);
  const joined = await snapshot(guest);
  assert.equal(joined.saveKey, undefined);
  assert.equal(joined.definition.imageId, imageId);
  assert.equal(initial.definition.shape, "classic-wide");
  assert.equal(joined.definition.shape, "classic-wide");
  assert.equal((await (await fetch(`${url}/api/saves/${initial.saveKey}`)).json()).roomId, host.roomId);
  await assert.rejects(() => client.create("puzzle", { saveKey: initial.saveKey }));
  const saveUrl = `${url}/api/saves/${initial.saveKey}`;
  const deleteSave = () => fetch(saveUrl, { method: "DELETE" });
  assert.equal((await deleteSave()).status, 409);

  assert.equal(initial.fieldSize, 1);
  const resized = nextMessage(guest, "delta", delta => delta.fieldSize === 2);
  host.send("command", { type: "resize-field", size: 2 });
  await resized;
  guest.send("command", { type: "resize-field", size: 1 });
  assert.equal((await snapshot(guest)).fieldSize, 2);

  let hostSawMarker = false;
  const stopListening = host.onMessage("board-marker", () => { hostSawMarker = true; });
  const marker = nextMessage(guest, "board-marker");
  const markerResult = nextMessage(host, "board-action-result");
  host.send("command", { type: "point-at", position: { x: 240, y: 150 }, requestId: 1 });
  assert.deepEqual(await marker, { position: { x: 240, y: 150 } });
  assert.deepEqual(await markerResult, { requestId: 1, outcome: "done" });

  assert.equal(hostSawMarker, false);
  stopListening();

  guest.send("command", { type: "grab-group", groupId: "1" });
  const placed = nextMessage(host, "delta", value => value.groups.some(group => group.placed));
  guest.send("command", { type: "release-group", groupId: "1", position: { x: 0, y: 0 } });
  await placed;
  await guest.leave();
  await host.leave();
  await stop();
  const savePath = join(data, "saves", initial.saveKey + ".json");
  const legacy = JSON.parse(await readFile(savePath, "utf8"));
  legacy.snapshot.trays = ["tray-1"];
  legacy.snapshot.trayNames = { "tray-1": "Небо" };
  legacy.snapshot.features = { trays: true, edgeFilter: true };
  Object.assign(legacy.snapshot.groups.find(group => group.id === "0"),
    { dx: 240, dy: 150, owner: "old-player", tray: "tray-1" });
  legacy.snapshot.arrangeHistory = [
    { tray: "tray-1", positions: [{ id: "0", dx: 300, dy: 350 }] },
    { tray: null, positions: [{ id: "2", dx: 360, dy: 400 }] },
  ];
  await writeFile(savePath, JSON.stringify(legacy));
  await start();

  const details = await (await fetch(saveUrl)).json();
  assert.equal(details.roomId, null);
  assert.equal(details.shape, "classic-wide");
  assert.equal(details.placed, 1);
  assert.ok(Number.isFinite(details.savedAt) && details.savedAt > 0);
  const picture = await fetch(`${url}/api/photos/${imageId}`);
  assert.equal(picture.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await picture.arrayBuffer()), photo);
  const restored = await client.create("puzzle", { saveKey: initial.saveKey });
  try {
    const state = await snapshot(restored);
    assert.equal(state.fieldSize, 2);
    assert.deepEqual(state.definition, initial.definition);
    assert.ok(!("trays" in state) && !("trayNames" in state) && !("features" in state));
    assert.equal(state.groups.flatMap(group => group.pieces).length, 1000);
    assert.deepEqual(state.groups.find(group => group.pieces.includes(0)), { id: "0", pieces: [0], dx: 240, dy: 150, owner: null, placed: false });
    assert.ok(state.groups.some(group => group.pieces.includes(1) && group.placed));
    assert.ok(state.groups.every(group => group.owner === null));
    const undo = nextMessage(restored, "delta");
    const undoResult = nextMessage(restored, "board-action-result");
    restored.send("command", { type: "undo-arrange", requestId: 2 });
    assert.deepEqual((await undo).groups.map(({ id, dx, dy }) => ({ id, dx, dy })), [{ id: "2", dx: 360, dy: 400 }]);
    assert.deepEqual(await undoResult, { requestId: 2, outcome: "done" });
    const cleaned = JSON.parse(await readFile(savePath, "utf8")).snapshot;
    assert.ok(!("trays" in cleaned) && cleaned.groups.every(group => !("tray" in group)));
  } finally { await restored.leave(); }

  assert.equal((await deleteSave()).status, 204);
  assert.equal((await deleteSave()).status, 204);
  assert.equal((await fetch(saveUrl)).status, 404);
  await assert.rejects(() => client.create("puzzle", { saveKey: initial.saveKey }));
});
