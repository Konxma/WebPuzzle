import test from "node:test";
import assert from "node:assert/strict";
import { Client, CloseCode } from "@colyseus/sdk";
import { ROOM_KICK_REASON } from "@web-pazle/shared";
const endpoint=process.env.TEST_ENDPOINT??"ws://127.0.0.1:3001";
const waitMs=Number(process.env.TEST_WAIT_MS??8000);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function listen(room){
  const result={snapshot:null,deltas:[],players:[]};
  room.onMessage("snapshot",value=>{result.snapshot=value;});
  room.onMessage("delta",value=>result.deltas.push(value));
  room.onMessage("players",players=>{result.players=players;});
  room.onMessage("motion",value=>result.deltas.push({groups:[value],removed:[]}));
  return result;
}
async function until(fn,message){
  const end=Date.now()+waitMs;
  while(Date.now()<end){if(fn())return;await pause(10);}
  throw new Error(message);
}
test("three clients synchronize, fourth is rejected, ownership and reconnection work",async()=>{
  const clients=Array.from({length:4},()=>new Client(endpoint));
  const rooms=[];
  try{
    const a=await clients[0].create("puzzle",{pieceCount:7});rooms.push(a);const sa=listen(a);a.send("sync");
    await until(()=>sa.snapshot,"creator snapshot");
    const b=await clients[1].joinById(a.roomId);rooms.push(b);const sb=listen(b);b.send("sync");
    await until(()=>sb.snapshot,"guest snapshot");
    assert.equal(sb.snapshot.definition.pieceCount,7);
    assert.deepEqual(sb.snapshot.groups,sa.snapshot.groups);
    const c = await clients[2].joinById(a.roomId); rooms.push(c);
    const sc = listen(c); c.send("sync");
    await until(() => sc.snapshot, "third player snapshot");
    assert.deepEqual(sc.snapshot.players.map(player => player.name), ["Гравець 1", "Гравець 2", "Гравець 3"]);
    assert.deepEqual(sc.snapshot.groups, sa.snapshot.groups);
    await assert.rejects(() => clients[3].joinById(a.roomId));
    let markerB, markerC;
    b.onMessage("board-marker", marker => { markerB = marker; });
    c.onMessage("board-marker", marker => { markerC = marker; });
    a.send("command", { type: "point-at", position: { x: 200, y: 150 }, tray: null, tileId: null });
    await until(() => markerB && markerC, "marker reached both guests");
    assert.deepEqual(markerB, markerC);
    a.send("command",{type:"grab-group",groupId:"0"});
    await until(()=>sb.deltas.some(d=>d.groups.some(g=>g.id==="0"&&g.owner===a.sessionId)),"grab propagated");
    const length=sa.deltas.length;
    b.send("command",{type:"move-group",groupId:"0",position:{x:123,y:456}});
    await pause(80);
    assert.equal(sa.deltas.length,length);
    a.send("command",{type:"move-group",groupId:"0",position:{x:500,y:400}});
    await until(()=>sb.deltas.some(d=>d.groups.some(g=>g.id==="0"&&g.dx===500)),"move propagated");
    await until(()=>sc.deltas.some(d=>d.groups.some(g=>g.id==="0"&&g.dx===500)),"move reached third player");
    assert.equal(sa.deltas.length, length, "sender does not receive its own motion");
    a.send("command",{type:"release-group",groupId:"0",position:{x:0,y:0}});
    await until(()=>sb.deltas.some(d=>d.groups.some(g=>g.id==="0"&&g.placed)),"placement propagated");
    const token=b.reconnectionToken;
    // Exercise explicit token recovery without racing the SDK's background reconnect.
    b.reconnection.enabled=false;
    await b.leave(false);
    const rejoined=await clients[1].reconnect(token);rooms.push(rejoined);
    const sr=listen(rejoined);rejoined.send("sync");
    await until(()=>sr.snapshot,"reconnected snapshot");
    assert.equal(sr.snapshot.selfId,sb.snapshot.selfId);
    assert.ok(sr.snapshot.groups.some(g=>g.pieces.includes(0)&&g.placed));
  }finally{for(const room of rooms)try{await room.leave();}catch{}}
});

test("only the host can remove a guest and revoke a reconnecting seat", async t => {
  const client = new Client(endpoint);
  const rooms = [];
  t.after(async () => {
    for (const room of rooms) if (room.connection.isOpen) await room.leave();
  });
  const host = await client.create("puzzle", { pieceCount: 7 });
  rooms.push(host);
  const hostState = listen(host);
  host.send("sync");
  await until(() => hostState.snapshot, "host snapshot");
  assert.equal(hostState.snapshot.players[0].isHost, true);

  const guest = await client.joinById(host.roomId);
  rooms.push(guest);
  listen(guest);
  guest.send("command", { type: "kick-player", playerId: host.sessionId });
  guest.send("command", { type: "grab-group", groupId: "0" });
  await until(() => hostState.deltas.some(delta => delta.groups.some(group => group.owner === guest.sessionId)), "unauthorized kick did not interrupt play");

  const guestToken = guest.reconnectionToken;
  let close;
  guest.onLeave((code, reason) => { close = { code, reason }; });
  host.send("command", { type: "kick-player", playerId: host.sessionId });
  host.send("command", { type: "kick-player", playerId: guest.sessionId });
  await until(() => close, "guest was removed");
  assert.deepEqual(close, { code: CloseCode.CONSENTED, reason: ROOM_KICK_REASON });
  await until(() => hostState.players.length === 1 && hostState.players[0].id === host.sessionId, "host stayed and guest seat was freed");
  assert.ok(hostState.deltas.some(delta => delta.groups.some(group => group.id === "0" && group.owner === null)));
  await assert.rejects(() => client.reconnect(guestToken));

  const reconnecting = await client.joinById(host.roomId);
  rooms.push(reconnecting);
  listen(reconnecting);
  const reconnectingToken = reconnecting.reconnectionToken;
  reconnecting.reconnection.enabled = false;
  await reconnecting.leave(false);
  await until(() => hostState.players.some(player => player.id === reconnecting.sessionId && !player.connected), "guest reserved a reconnecting seat");
  host.send("command", { type: "kick-player", playerId: reconnecting.sessionId });
  await until(() => hostState.players.length === 1, "reserved seat was removed");
  await assert.rejects(() => client.reconnect(reconnectingToken));

  const replacement = await client.joinById(host.roomId);
  rooms.push(replacement);
  const replacementState = listen(replacement);
  await host.leave();
  await until(() => replacementState.players.some(player => player.id === replacement.sessionId && player.isHost), "remaining player became host");
});
test("counts 1, 1000 and 3000 initialize exactly; invalid counts are rejected",async()=>{
  const client=new Client(endpoint);
  for(const count of [1,1000,3000]){
    const room=await client.create("puzzle",{pieceCount:count});
    const state=listen(room);room.send("sync");
    try{await until(()=>state.snapshot,`snapshot for ${count} pieces`);assert.equal(state.snapshot.groups.length,count);}
    finally{await room.leave();}
  }
  for(const count of [0,3001,1.5])await assert.rejects(()=>client.create("puzzle",{pieceCount:count}));
});

test("room and progress survive when both players lose their connection",async()=>{
  const clients=[new Client(endpoint),new Client(endpoint)];const rooms=[];
  try{
    const a=await clients[0].create("puzzle",{pieceCount:1000});rooms.push(a);
    const sa=listen(a);a.send("sync");await until(()=>sa.snapshot,"creator snapshot");
    const b=await clients[1].joinById(a.roomId);rooms.push(b);
    const sb=listen(b);b.send("sync");await until(()=>sb.snapshot,"guest snapshot");
    a.send("command",{type:"grab-group",groupId:"0"});
    await until(()=>sb.deltas.some(d=>d.groups.some(g=>g.id==="0"&&g.owner===a.sessionId)),"grab before outage");
    a.send("command",{type:"release-group",groupId:"0",position:{x:0,y:0}});
    await until(()=>sb.deltas.some(d=>d.groups.some(g=>g.id==="0"&&g.placed)),"progress before outage");
    const tokens=[a.reconnectionToken,b.reconnectionToken];
    a.reconnection.enabled=false;b.reconnection.enabled=false;
    await Promise.all([a.leave(false),b.leave(false)]);await pause(2000);
    for(let i=0;i<2;i++){
      const restored=await clients[i].reconnect(tokens[i]);rooms.push(restored);
      const state=listen(restored);restored.send("sync");await until(()=>state.snapshot,"snapshot after both dropped");
      assert.equal(restored.roomId,a.roomId);
      assert.equal(state.snapshot.selfId,[sa.snapshot,sb.snapshot][i].selfId);
      assert.equal(state.snapshot.definition.id,sa.snapshot.definition.id);
      assert.ok(state.snapshot.groups.some(g=>g.pieces.includes(0)&&g.placed));
    }
  }finally{for(const room of rooms)try{await room.leave();}catch{}}
});
