import type { HealthResponse } from "@web-pazle/shared";
export interface HealthGateway {
  check(): Promise<HealthResponse>;
}
