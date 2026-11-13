import test from "node:test";
import assert from "node:assert/strict";
import { InviteAddress, localNetworkOrigin } from "../src/infrastructure/http/InviteAddress.ts";

test("loopback pages discover the active LAN address and share only the room parameter", async () => {
  const address = new InviteAddress("http://127.0.0.1:5173", async url => {
    assert.equal(url, "/api/lan-origin");
    return Response.json({ origin: "http://192.168.1.12:5174" });
  });
  await address.refresh();
  assert.equal(address.url("room_123"), "http://192.168.1.12:5174/?room=room_123");
});

test("a working LAN address is retained even when the host has several adapters", async () => {
  const address = new InviteAddress("http://10.0.0.66:5174", () => assert.fail("LAN lookup is unnecessary"));
  await address.refresh();
  assert.equal(address.url("room_123"), "http://10.0.0.66:5174/?room=room_123");
});

test("without a LAN launch, a loopback page can still share with another local tab", async () => {
  const address = new InviteAddress("http://localhost:5173", async () => Response.json({ origin: null }));
  await address.refresh();
  assert.equal(address.url("room_123"), "http://localhost:5173/?room=room_123");
});

test("LAN invitations reject external addresses and URL credentials", () => {
  for (const value of ["https://example.org", "http://10.evil.example", "http://172.32.1.1", "http://8.8.8.8", "http://user@192.168.1.5:5174"]) {
    assert.equal(localNetworkOrigin(value), null, value);
  }
});
