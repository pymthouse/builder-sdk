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
  path: DirectSignerPath | (string & {}),
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

/** Read `signer_url` from an exchange response envelope. */
export function signerUrlFromExchangeResponse(
  response: Pick<DeviceExchangeResponse, "signer_url">,
): string | undefined {
  const url = response.signer_url?.trim();
  return url || undefined;
}

/**
 * Reject dashboard-style signer proxy bases. Exchange facades mint JWTs only;
 * signing RPCs must target the remote signer DMZ directly.
 *
 * Parses the URL and inspects its pathname rather than running a regex over the
 * raw string, which both avoids super-linear backtracking on adversarial input
 * and rejects every `/api/signer` and `/api/signer/*` route (not just the three
 * known endpoint suffixes).
 *
 * @param signerBaseUrl - Absolute signer base URL to validate.
 * @throws {PmtHouseError} When the URL is not absolute or points at a dashboard
 * `/api/signer` proxy path.
 */
export function assertDirectSignerBaseUrl(signerBaseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(signerBaseUrl.trim());
  } catch {
    throw new PmtHouseError("signer URL must be an absolute http(s) URL", {
      status: 400,
      code: "invalid_signer_url",
    });
  }

  const pathname = stripTrailingSlashes(parsed.pathname);
  if (pathname === "/api/signer" || pathname.startsWith("/api/signer/")) {
    throw new PmtHouseError(
      "signer URL must be the remote signer DMZ base, not a dashboard /api/signer/* proxy path. " +
        "Exchange at the platform facade, then call signer endpoints directly using signerUrl from the exchange response.",
      { status: 400, code: "invalid_signer_url" },
    );
  }
}
