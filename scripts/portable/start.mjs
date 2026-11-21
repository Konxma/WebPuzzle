import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_ROOM_PLAYERS } from "@web-pazle/shared";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.WEBPUZZLE_PORT ?? 5174);
const managed = process.env.WEBPUZZLE_MANAGED === "1";
const address = `http://localhost:${port}/`;
const probeAddress = `http://127.0.0.1:${port}/`;

function openGame() {
  console.log(`WebPuzzle відкрито за адресою ${address}`);
  console.log("Залиште це вікно відкритим під час гри.");
  if (!managed && process.env.WEBPUZZLE_NO_BROWSER !== "1") {
    const browser = spawn("explorer.exe", [address], { detached: true, stdio: "ignore", windowsHide: true });
    browser.on("error", () => console.log(`Відкрийте ${address} у браузері.`));
    browser.unref();
  }
}

async function localGame() {
  try {
    const response = await fetch(new URL("api/health", probeAddress), { signal: AbortSignal.timeout(1200) });
    if (!response.ok) return false;
    const status = await response.json();
    if (status.service !== "web-pazle-server" || status.maxPlayers !== MAX_ROOM_PLAYERS || status.adjustableField !== true || !status.launcherArtwork) return false;
    const page = await fetch(probeAddress, { signal: AbortSignal.timeout(1200) });
    return page.ok && (await page.text()).includes("<title>WebPuzzle</title>");
  } catch { return false; }
}

try {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Некоректний порт.");
  if (await localGame()) {
    console.log("Гра вже запущена. Можна користуватися тією самою кімнатою.");
    if (managed) console.log("WEBPUZZLE_REUSED");
    else openGame();
  } else {
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once("error", () => reject(new Error(`Порт ${port} зайнятий. Закрийте попереднє вікно WebPuzzle і запустіть гру ще раз.`)));
      probe.listen(port, "0.0.0.0", () => probe.close(resolve));
    });
    process.env.PORT = String(port);
    process.env.WEBPUZZLE_CLIENT_DIR = join(root, "client");
    process.env.WEBPAZLE_DATA_DIR ??= join(process.env.LOCALAPPDATA ?? root, "WebPuzzle", "data");
    const { stopServer } = await import("../apps/server/dist/main.js");
    if (managed) {
      // The private pipe closes on Stop or if the launcher itself is closed.
      process.stdin.once("end", () => void stopServer());
      process.stdin.resume();
      console.log("WEBPUZZLE_READY");
    } else openGame();
  }
} catch (error) {
  console.error("Не вдалося запустити WebPuzzle.");
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
