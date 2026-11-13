import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";

// Use the Node socket to simulate a browser unable to process incoming data.
globalThis.WebSocket=WebSocket;
const {Client}=await import("@colyseus/sdk");
const endpoint=process.env.TEST_ENDPOINT??"ws://127.0.0.1:3001";
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function snapshot(room){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error("snapshot timeout")),10000);
    room.onMessage("snapshot",value=>{clearTimeout(timer);resolve(value);});
    room.send("sync");
  });
}

test("3000-piece guest negotiates compression and survives a 20-second receive stall",{timeout:40000},async()=>{
  const host=await new Client(endpoint).create("puzzle",{pieceCount:3000});
  let guest;
  try{
    host.onMessage("players",()=>{});
    await snapshot(host);
    guest=await new Client(endpoint).joinById(host.roomId);
    guest.reconnection.enabled=false;
    guest.onMessage("players",()=>{});
    assert.equal((await snapshot(guest)).groups.length,3000);
    const ws=guest.connection.transport.ws;
    assert.match(ws.extensions,/permessage-deflate/);
    let disconnected=false;
    guest.onLeave(()=>{disconnected=true;});
    ws._socket.pause();
    try{await pause(20000);}finally{ws._socket.resume();}
    assert.equal((await snapshot(guest)).groups.length,3000);
    assert.equal(disconnected,false,"guest should not need reconnection");
    assert.equal(ws.readyState,WebSocket.OPEN);
  }finally{
    if(guest)await guest.leave();
    await host.leave();
  }
});
