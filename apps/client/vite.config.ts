import { defineConfig } from "vite";
import { networkInterfaces } from "node:os";
export default defineConfig({
  plugins:[{
    name:"webpazle-lan-invites",
    configureServer(server){
      const seats=new Map<string,{roomId:string;seen:number;created:number}>();
      server.middlewares.use("/api/lan-invite",async (request,response)=>{
        response.setHeader("Content-Type","application/json");
        response.setHeader("Cache-Control","no-store");
        try{
          if(request.method==="POST"){
            let body="";
            for await(const chunk of request){body+=chunk;if(body.length>2048)throw new Error("Request too large");}
            const data=JSON.parse(body);
            if(typeof data.sessionId!=="string"||! /^[\w-]{1,64}$/.test(data.sessionId)||
              !(data.roomId===null||typeof data.roomId==="string"&&/^[\w-]{1,64}$/.test(data.roomId)))throw new Error("Invalid room");
            if(request.socket.localPort!==5174){
              try{await fetch("http://127.0.0.1:5174/api/lan-invite",{method:"POST",headers:{"Content-Type":"application/json"},body,signal:AbortSignal.timeout(1500)});}catch{ /* Track locally even without the LAN launcher. */ }
            }
            if(data.roomId===null)seats.delete(data.sessionId);
            else seats.set(data.sessionId,{roomId:data.roomId,seen:Date.now(),created:seats.get(data.sessionId)?.created??Date.now()});
            response.end("{}");return;
          }
          if(request.method!=="GET"){response.statusCode=405;response.end("{}");return;}
          // Only the launcher on this PC may read the current private room ID.
          if(!["127.0.0.1","::1","::ffff:127.0.0.1"].includes(request.socket.remoteAddress??"")){
            response.statusCode=403;response.end("{}");return;
          }
          for(const [id,seat] of seats)if(Date.now()-seat.seen>70000)seats.delete(id);
          const latest=[...seats.values()].sort((a,b)=>b.created-a.created)[0];
          response.end(JSON.stringify({roomId:latest?.roomId??null}));
        }catch{response.statusCode=400;response.end("{}");}
      });
      server.middlewares.use("/api/lan-origin",async (_request,response)=>{
        response.setHeader("Content-Type","application/json");
        response.setHeader("Cache-Control","no-store");
        // The development page may be on 5173. Advertise 5174 only if its game is running.
        let origin:string|null=null;
        try{
          const health=await fetch("http://127.0.0.1:5174/api/health",{signal:AbortSignal.timeout(1000)});
          if(health.ok&&(await health.json()).service==="web-pazle-server"){
            const addresses=Object.values(networkInterfaces()).flatMap(values=>values??[]);
            const address=addresses.find(value=>value.family==="IPv4"&&!value.internal&&
              /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value.address));
            if(address)origin=`http://${address.address}:5174`;
          }
        }catch{ /* LAN launcher is optional for local development. */ }
        response.end(JSON.stringify({origin}));
      });
    },
  }],
  server:{
    port:5173,strictPort:true,
    // Save keys are private capabilities. Only the room server may read the storage directory.
    fs:{deny:[".env",".env.*","*.{crt,pem,key,p12,pfx,cer,der}",".npmrc",".yarnrc.yml","**/.git/**","**/.data/**"]},
    watch:{ignored:["**/.data/**"]},
    proxy:{
      // Both matchmaking HTTP requests and room WebSockets reach the same Colyseus server.
      "/api":"http://127.0.0.1:3001",
      "/realtime":{target:"http://127.0.0.1:3001",ws:true,rewrite:path=>path.replace(/^\/realtime/,"")},
    },
  },
});
