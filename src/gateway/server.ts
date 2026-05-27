function assertGatewayServerModuleServerOnly(): void {
  if (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { window?: unknown }).window !== "undefined"
  ) {
    throw new Error(
      "@pymthouse/builder-sdk/gateway/server is server-only: do not import attachPmtHouseGatewayProxy in client-side code.",
    );
  }
}

assertGatewayServerModuleServerOnly();

export {
  attachPmtHouseGatewayProxy,
  createGatewayHandlers,
} from "./proxy-handlers.js";
export { encodeGatewayToken, parseGatewayToken, resolveBillingSigner } from "./token.js";
export { startByocJob } from "./byoc.js";
export { getOrchInfo, clearTofuCache } from "./orch-info.js";
export { discoverOrchestrators } from "./orchestrator.js";
export type {
  GatewayProxyOptions,
  BYOCJobRequestInput,
  BYOCJobStartOptions,
  BYOCJobRecord,
  StartJobResponse,
  GatewayJobStatus,
  SignerConfig,
} from "./types.js";
export {
  GatewayError,
  NoOrchestratorAvailableError,
  PaymentError,
  PaymentRequiredError,
} from "./errors.js";
