import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";
import { loadConfigFromFile } from "vite";

test("Vite advertises the LAN address only while the LAN game is active", async t => {
  let active = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(url, "http://127.0.0.1:5174/api/health");
    return active ? Response.json({ service: "web-pazle-server" }) : new Response(null, { status: 503 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const configPath = fileURLToPath(new URL("../../apps/client/vite.config.ts", import.meta.url));
  const loaded = await loadConfigFromFile({ command: "serve", mode: "development" }, configPath);
  let handler;
  const plugin = loaded.config.plugins.find(value => value.name === "webpazle-lan-invites");
  plugin.configureServer({ middlewares: { use(path, callback) { if (path === "/api/lan-origin") handler = callback; } } });
  assert.equal(typeof handler, "function");
  const server = createServer(handler);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(done => server.close(done));
  });
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });

  const url = `http://127.0.0.1:${server.address().port}/api/lan-origin`;
  const hosts = Object.values(networkInterfaces()).flatMap(values => values ?? [])
    .filter(value => value.family === "IPv4" && !value.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value.address))
    .map(value => `http://${value.address}:5174`);
  const response = await originalFetch(url);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.ok((hosts.length ? hosts : [null]).includes((await response.json()).origin));

  active = false;
  assert.deepEqual(await (await originalFetch(url)).json(), { origin: null });
});
