import { stripTrailingSlashes } from "../string-utils.js";
import { PmtHouseError } from "../errors.js";
import type { DeviceExchangeResponse } from "./types.js";

/** Remote signer paths clients call directly after exchange (never via dashboard proxy). */
export const DIRECT_SIGNER_PATHS = {
  signOrchestratorInfo: "sign-orchestrator-info",
  generateLivePayment: "generate-live-payment",
  discoverOrchestrators: "discover-orchestrators",
} as const;

export type DirectSignerPath =
  (typeof DIRECT_SIGNER_PATHS)[keyof typeof DIRECT_SIGNER_PATHS];

/**
 * Build a direct remote-signer URL from a DMZ base returned by exchange handlers.
 * The base must be the signer service origin (e.g. `https://signer.example`), not a
 * dashboard `/api/signer/*` proxy route.
 */
export function signerEndpointUrl(
  signerBaseUrl: string,
  path: DirectSignerPath | string,
): string {
  const base = stripTrailingSlashes(signerBaseUrl.trim());
  if (!base) {
    throw new PmtHouseError("signerBaseUrl is required", {
      status: 400,
      code: "invalid_signer_url",
    });
  }
  const suffix = path.replace(/^\/+/, "");
  return `${base}/${suffix}`;
}

/** Read `signerUrl` from an exchange response envelope. */
export function signerUrlFromExchangeResponse(
  response: Pick<DeviceExchangeResponse, "signerUrl">,
): string | undefined {
  const url = response.signerUrl?.trim();
  return url || undefined;
}

/**
 * Reject dashboard-style signer proxy bases. Exchange facades mint JWTs only;
 * signing RPCs must target the remote signer DMZ directly.
 */
export function assertDirectSignerBaseUrl(signerBaseUrl: string): void {
  const normalized = signerBaseUrl.trim().replace(/\/+$/, "");
  if (/\/api\/signer\/(sign-orchestrator-info|generate-live-payment|discover-orchestrators)$/.test(normalized)) {
    throw new PmtHouseError(
      "signer URL must be the remote signer DMZ base, not a dashboard /api/signer/* proxy path. " +
        "Exchange at the platform facade, then call signer endpoints directly using signerUrl from the exchange response.",
      { status: 400, code: "invalid_signer_url" },
    );
  }
}
