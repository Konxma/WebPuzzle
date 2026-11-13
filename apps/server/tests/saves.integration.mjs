import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
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

test("a guest shares a photo and tray, then the host restores the board after a server restart", { timeout: 25000 }, async t => {
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
  const host = await client.create("puzzle", { pieceCount: 1000, imageId, shape: "classic-wide", features: { trays: true, edgeFilter: true } });
  const initial = await snapshot(host);
  assert.ok(initial.saveKey);
  assert.deepEqual(initial.trays, []);
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

  const hostTray = nextMessage(host, "delta", value => value.trays?.length === 1);
  const guestTray = nextMessage(guest, "delta", value => value.trays?.length === 1);
  guest.send("command", { type: "create-tray" });
  assert.deepEqual((await hostTray).trays, ["tray-1"]);
  assert.deepEqual((await guestTray).trays, ["tray-1"]);
  const renamed = nextMessage(host, "delta", value => value.trayNames?.["tray-1"] === "Небо");
  guest.send("command", { type: "rename-tray", tray: "tray-1", name: "  Небо  " });
  await renamed;

  let hostSawMarker = false;
  const stopListening = host.onMessage("board-marker", () => { hostSawMarker = true; });
  const marker = nextMessage(guest, "board-marker");
  const markerResult = nextMessage(host, "board-action-result");
  host.send("command", { type: "point-at", tray: "tray-1", position: { x: 240, y: 150 }, requestId: 1 });
  assert.deepEqual(await marker, { tray: "tray-1", position: { x: 240, y: 150 } });
  assert.deepEqual(await markerResult, { requestId: 1, outcome: "done" });

  const emptyTray = nextMessage(host, "board-action-result");
  host.send("command", { type: "arrange-pieces", tray: "tray-1", requestId: 2 });
  assert.deepEqual(await emptyTray, { requestId: 2, outcome: "unavailable" });
  assert.equal(hostSawMarker, false);
  stopListening();

  host.send("command", { type: "grab-group", groupId: "0" });
  const stashed = nextMessage(guest, "delta", value => value.groups.some(group => group.tray === "tray-1"));
  host.send("command", { type: "stash-group", groupId: "0", tray: "tray-1", position: { x: 240, y: 150 } });
  assert.equal((await stashed).groups[0].owner, null);
  guest.send("command", { type: "grab-group", groupId: "1" });
  const placed = nextMessage(host, "delta", value => value.groups.some(group => group.placed));
  guest.send("command", { type: "release-group", groupId: "1", position: { x: 0, y: 0 } });
  await placed;
  await guest.leave();
  await host.leave();
  await stop();
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
    assert.deepEqual(state.definition, initial.definition);
    assert.deepEqual(state.trays, ["tray-1"]);
    assert.deepEqual(state.trayNames, { "tray-1": "Небо" });
    assert.deepEqual(state.features, { trays: true, edgeFilter: true });
    assert.equal(state.groups.flatMap(group => group.pieces).length, 1000);
    assert.deepEqual(state.groups.find(group => group.pieces.includes(0)), { id: "0", pieces: [0], dx: 240, dy: 150, owner: null, placed: false, tray: "tray-1" });
    assert.ok(state.groups.some(group => group.pieces.includes(1) && group.placed));
    assert.ok(state.groups.every(group => group.owner === null));
    const guest = await client.joinById(restored.roomId);
    await snapshot(guest);
    try {
      const grabbed = nextMessage(restored, "delta", value => value.groups.some(group => group.id === "0" && group.owner));
      guest.send("command", { type: "grab-group", groupId: "0" });
      await grabbed;
      const hostUpdate = nextMessage(restored, "delta", value => value.trays?.length === 0);
      const guestUpdate = nextMessage(guest, "delta", value => value.trays?.length === 0);
      restored.send("command", { type: "delete-tray", tray: "tray-1" });
      const expected = { groups: [{ id: "0", pieces: [0], dx: 240, dy: 150, owner: null, placed: false }], removed: [], trays: [], trayNames: {} };
      assert.deepEqual(await hostUpdate, expected);
      assert.deepEqual(await guestUpdate, expected);
    } finally { await guest.leave(); }
  } finally { await restored.leave(); }
  await stop();
  await start();

  const afterDelete = await client.create("puzzle", { saveKey: initial.saveKey });
  try {
    const state = await snapshot(afterDelete);
    assert.deepEqual(state.trays, []);
    assert.equal(state.groups.find(group => group.id === "0").tray, undefined);
    assert.equal(state.groups.flatMap(group => group.pieces).length, 1000);
  } finally { await afterDelete.leave(); }
  await stop();
  await start();

  assert.equal((await deleteSave()).status, 204);
  assert.equal((await deleteSave()).status, 204);
  assert.equal((await fetch(saveUrl)).status, 404);
  await assert.rejects(() => client.create("puzzle", { saveKey: initial.saveKey }));
});
