import { PmtHouseError } from "../errors.js";
import type { EndUserUsageSummary, UsageBalanceResponse } from "../types.js";
import {
  assertClientIdMatch,
  assertNoCrossUserQueryParams,
  assertUsageReadScope,
  matchUsageMeRoute,
  verifyEndUserBearer,
} from "./end-user-auth.js";
import type { EndUserAuthVerifier, VerifiedEndUserAuth } from "../signer/webhook/verifier.js";

export type EndUserUsageConfig = {
  endUserAuth: EndUserAuthVerifier;
  resolveExternalUserId?: (verified: VerifiedEndUserAuth) => Promise<string>;
  readBalance: (input: {
    clientId: string;
    externalUserId: string;
  }) => Promise<UsageBalanceResponse>;
  readUsage?: (input: {
    clientId: string;
    externalUserId: string;
    startDate?: string;
    endDate?: string;
    includeRetail?: boolean;
  }) => Promise<EndUserUsageSummary>;
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(err: unknown): Response {
  if (err instanceof PmtHouseError) {
    const body: Record<string, unknown> = {
      error: err.code,
      error_description: err.message,
    };
    return jsonResponse(err.status, body);
  }
  const message = err instanceof Error ? err.message : "usage read failed";
  return jsonResponse(500, {
    error: "server_error",
    error_description: message,
  });
}

async function resolveExternalUserId(
  verified: VerifiedEndUserAuth,
  config: EndUserUsageConfig,
): Promise<string> {
  if (config.resolveExternalUserId) {
    return config.resolveExternalUserId(verified);
  }
  return verified.identity.usage_subject;
}

export async function routeEndUserUsageRequest(
  request: Request,
  config: EndUserUsageConfig,
): Promise<Response | null> {
  const url = new URL(request.url);
  const match = matchUsageMeRoute(url.pathname);
  if (!match || request.method !== "GET") {
    return null;
  }

  try {
    assertNoCrossUserQueryParams(url.searchParams);
    const verified = await verifyEndUserBearer(request, config.endUserAuth);
    assertUsageReadScope(verified);
    assertClientIdMatch(verified.identity, match.clientId);
    const externalUserId = await resolveExternalUserId(verified, config);

    if (match.kind === "balance") {
      const balance = await config.readBalance({
        clientId: match.clientId,
        externalUserId,
      });
      return jsonResponse(200, {
        clientId: match.clientId,
        ...balance,
      });
    }

    if (!config.readUsage) {
      throw new PmtHouseError("usage read is not configured", {
        status: 501,
        code: "not_implemented",
      });
    }

    const startDate = url.searchParams.get("startDate")?.trim() || undefined;
    const endDate = url.searchParams.get("endDate")?.trim() || undefined;
    const includeRetail = url.searchParams.get("include") === "retail";
    const usage = await config.readUsage({
      clientId: match.clientId,
      externalUserId,
      startDate,
      endDate,
      includeRetail,
    });
    return jsonResponse(200, usage);
  } catch (err) {
    return errorResponse(err);
  }
}
