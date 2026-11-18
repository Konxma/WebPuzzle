import { spawn, spawnSync } from "node:child_process";
import { networkInterfaces } from "node:os";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { localNetworkOrigin } from "../apps/client/src/infrastructure/http/InviteAddress.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const children: ReturnType<typeof spawn>[] = [];
const port = 5174;
function printAddresses() {
  console.log("\nWebPuzzle — гра для трьох в одній локальній мережі.\nВІДКРИТИ ГРУ на цьому ПК:");
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal && !address.address.startsWith("169.254.")) {
        console.log(`  http://${address.address}:${port}/`);
      }
    }
  }
  console.log("Після створення кімнати готове посилання для друга з’явиться нижче.");
}
async function watchInvite(){
  // Vite receives room presence from the browser. Poll from loopback so room IDs stay private.
  let previous:string|null|undefined;
  while(!stopping){
    try{
      const response=await fetch(`http://127.0.0.1:${port}/api/lan-invite`,{signal:AbortSignal.timeout(1500)});
      if(response.ok){
        const data=await response.json();
        const roomId=typeof data.roomId==="string"&&/^[\w-]{1,64}$/.test(data.roomId)?data.roomId:null;
        if(roomId!==previous){
          if(roomId){
            const originResponse=await fetch(`http://127.0.0.1:${port}/api/lan-origin`,{signal:AbortSignal.timeout(2000)});
            const origin=localNetworkOrigin((await originResponse.json()).origin);
            if(!origin)throw new Error("LAN address unavailable");
            const url=new URL("/",origin);url.searchParams.set("room",roomId);
            console.log(`\n===== ЗАПРОШЕННЯ ДЛЯ ОДНІЄЇ МЕРЕЖІ =====\n${url.toString()}\n========================================`);
            const copied=spawnSync("clip.exe",{input:url.toString(),windowsHide:true});
            if(copied.status===0)console.log("Посилання вже скопійовано. Вставте його другу: Ctrl+V.\n");
          }else console.log("\nОчікую кімнату: відкрийте гру та натисніть «Створити кімнату».\n");
          previous=roomId;
        }
      }
    }catch{ /* The running client may briefly restart during development. */ }
    await new Promise(resolve=>setTimeout(resolve,1000));
  }
}
async function gameAlreadyRunning() {
  try {
    const [health, page] = await Promise.all([
      fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) }),
      fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) }),
    ]);
    if (!health.ok || !page.ok || !/<title>WebPuzzle<\/title>/i.test(await page.text())) return null;
    const status = await health.json();
    return status.service === "web-pazle-server" ? status : null;
  } catch { return null; }
}
async function portAvailable() {
  return new Promise<boolean>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    });
    probe.listen(port, "0.0.0.0", () => probe.close(() => resolve(true)));
  });
}
async function backendReady() {
  try {
    const response = await fetch("http://127.0.0.1:3001/api/health", { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return false;
    const status = await response.json();
    return status.service === "web-pazle-server" && status.undoArrange === true && status.maxPlayers === 3;
  } catch { return false; }
}
function start(args: string[], cwd = root) {
  const child = spawn(process.execPath, args, { cwd, stdio: "inherit" });
  children.push(child);
  child.on("error", error => { console.error(error.message); stop(1); });
  child.on("exit", code => stop(code ?? 1));
  return child;
}
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

async function main() {
const running = await gameAlreadyRunning();
if (running) {
  if (running.undoArrange !== true || running.maxPlayers !== 3) {
    console.log("Працює попередня версія WebPuzzle. Закрийте початкове вікно запуску гри, знову відкрийте Start.cmd та оновіть сторінку.");
    return;
  }
  console.log("WebPuzzle вже запущено. Повторний запуск не потрібен — поточні кімнати збережено.");
  printAddresses();
  console.log("\nЦе вікно показує запрошення. Залишайте попередній запуск гри увімкненим. Зупинити перегляд: Ctrl+C.");
  await watchInvite();
  return;
}
if (!await portAvailable()) {
  console.error(`Порт ${port} зайнятий, але працюючу гру не вдалося підтвердити. Закрийте іншу програму на цьому порту або перевірте попереднє вікно запуску WebPuzzle.`);
  process.exitCode = 1;
  return;
}
if (!await backendReady()) {
  for (const project of ["packages/shared", "apps/server"]) {
    const result = spawnSync(process.execPath, [resolve(root, "node_modules/typescript/bin/tsc"), "-p", `${project}/tsconfig.json`], { cwd: root, stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  start(["apps/server/dist/main.js"]);
  const deadline = Date.now() + 15000;
  while (!await backendReady()) {
    if (stopping || Date.now() > deadline) { stop(1); throw new Error("Не вдалося запустити сервер кімнат."); }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
} else {
  console.log("Використовую вже запущений сервер кімнат — поточні ігри збережено.");
}

printAddresses();
console.log("\nЗалишайте це вікно відкритим. Зупинка: Ctrl+C.\n");
start([resolve(root, "node_modules/vite/bin/vite.js"), "--host", "0.0.0.0", "--port", String(port)], resolve(root, "apps/client"));
await watchInvite();
}
await main();
