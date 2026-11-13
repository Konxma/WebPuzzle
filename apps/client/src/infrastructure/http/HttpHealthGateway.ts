import type { HealthResponse } from "@web-pazle/shared";
import type { HealthGateway } from "../../features/lobby/models/HealthGateway";

export class HttpHealthGateway implements HealthGateway {
  async check(): Promise<HealthResponse> {
    const response = await fetch("/api/health", { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Health request failed.");
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null ||
        !("status" in body) || body.status !== "ok" ||
        !("service" in body) || body.service !== "web-pazle-server") {
      throw new Error("Invalid health response.");
    }
    return { status: body.status, service: body.service };
  }
}
