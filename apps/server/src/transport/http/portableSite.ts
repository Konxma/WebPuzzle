import type { IncomingMessage, ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function portableHome(clientDir: string) {
  return readFileSync(resolve(clientDir, "index.html"), "utf8").replace(
    "</head>", '<meta name="webpuzzle-realtime" content="/"/></head>',
  );
}

export function servePortableAsset(clientDir: string, req: IncomingMessage, res: ServerResponse) {
  const pathname = (req.url ?? "").split("?", 1)[0] ?? "";
  const file = /^\/(assets|art)\/([\w.-]+\.(?:js|css|svg|png|webp|woff2))$/.exec(pathname);
  if (!file) {
    res.writeHead(404).end();
    return;
  }
  const types: Record<string, string> = {
    js: "text/javascript", css: "text/css", svg: "image/svg+xml",
    png: "image/png", webp: "image/webp", woff2: "font/woff2",
  };
  try {
    const asset = readFileSync(resolve(clientDir, file[1]!, file[2]!));
    const extension = file[2]!.split(".").at(-1)!;
    res.writeHead(200, {
      "Content-Type": types[extension]!,
      "Cache-Control": file[1] === "assets" ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
    }).end(asset);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    res.writeHead(404).end();
  }
}

export function portableLanOrigin(port: number) {
  const local = Object.values(networkInterfaces()).flatMap(addresses => addresses ?? []).find(address =>
    address.family === "IPv4" && !address.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address.address),
  );
  return local ? `http://${local.address}:${port}` : null;
}
