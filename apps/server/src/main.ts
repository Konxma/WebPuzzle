import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { MAX_ROOM_PLAYERS } from "@web-pazle/shared";
import { PuzzleRoom } from "./transport/realtime/PuzzleRoom.js";
import { deleteSave, getPhoto, getSaveStatus, uploadPhoto } from "./transport/http/puzzleLibraryRoutes.js";
const port=Number(process.env.PORT??3001);
if(!Number.isInteger(port)||port<1||port>65535)throw new Error("Invalid PORT");
const server=new Server({
  transport:new WebSocketTransport({
    // Large initial boards must not hold up heartbeat replies on slower Wi-Fi.
    perMessageDeflate:{threshold:512,serverNoContextTakeover:true,clientNoContextTakeover:true},
    pingInterval:15000,
    pingMaxRetries:4,
  }),
  greet:false,
  express:app=>{
    app.get("/api/health",(_request:IncomingMessage,response:ServerResponse)=>{response.writeHead(200,{"Content-Type":"application/json"});response.end(JSON.stringify({status:"ok",service:"web-pazle-server",boardActions:true,undoArrange:true,maxPlayers:MAX_ROOM_PLAYERS}));});
    app.post("/api/photos", uploadPhoto);
    app.get("/api/photos/:id", getPhoto);
    app.get("/api/saves/:id", getSaveStatus);
    app.delete("/api/saves/:id", deleteSave);
  },
});
server.define("puzzle",PuzzleRoom);
await server.listen(port,"127.0.0.1");
console.log(`WebPuzzle server: http://127.0.0.1:${port}`);
