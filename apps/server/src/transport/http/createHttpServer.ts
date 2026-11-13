import { createServer } from "node:http";
import type { HealthResponse } from "@web-pazle/shared";

export function createHttpServer() {
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/api/health") {
      const body: HealthResponse = { status: "ok", service: "web-pazle-server" };
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify(body));
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "Not found" }));
  });
}
