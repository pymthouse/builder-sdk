import { PmtHouseError } from "../errors.js";
import { SIGN_JOB_SCOPE, USAGE_READ_SCOPE } from "../tokens.js";
import { bearerTokenFromAuthorization } from "../signer/webhook/bearer.js";
import type { UsageIdentity } from "../signer/webhook/types.js";
import type { EndUserAuthVerifier, VerifiedEndUserAuth } from "../signer/webhook/verifier.js";

const USAGE_ME_ROUTE =
  /^\/api\/v1\/apps\/([^/]+)\/usage\/me(?:\/balance)?\/?$/;

export type UsageMeRouteMatch =
  | { kind: "balance"; clientId: string }
  | { kind: "usage"; clientId: string };

export function matchUsageMeRoute(pathname: string): UsageMeRouteMatch | null {
  const match = USAGE_ME_ROUTE.exec(pathname);
  if (!match) {
    return null;
  }
  const clientId = match[1];
  if (pathname.endsWith("/balance") || pathname.endsWith("/balance/")) {
    return { kind: "balance", clientId };
  }
  return { kind: "usage", clientId };
}

const CROSS_USER_QUERY_PARAMS = ["externalUserId", "userId"] as const;

export function assertNoCrossUserQueryParams(searchParams: URLSearchParams): void {
  for (const name of CROSS_USER_QUERY_PARAMS) {
    if (searchParams.has(name)) {
      throw new PmtHouseError(`query parameter ${name} is not allowed on self-scoped usage routes`, {
        status: 400,
        code: "invalid_request",
      });
    }
  }
  const groupBy = searchParams.get("groupBy")?.trim();
  if (groupBy === "user") {
    throw new PmtHouseError("groupBy=user is not allowed on self-scoped usage routes", {
      status: 400,
      code: "invalid_request",
    });
  }
}

function isApiKeyResolveResult(raw: unknown): boolean {
  return (
    raw != null &&
    typeof raw === "object" &&
    "userId" in raw &&
    typeof (raw as { userId?: unknown }).userId === "string"
  );
}

function scopesFromClaims(raw: Record<string, unknown>): Set<string> {
  const scopes = new Set<string>();
  if (typeof raw.scope === "string") {
    for (const part of raw.scope.split(/\s+/)) {
      if (part) scopes.add(part);
    }
  }
  if (typeof raw.scp === "string") {
    for (const part of raw.scp.split(/\s+/)) {
      if (part) scopes.add(part);
    }
  } else if (Array.isArray(raw.scp)) {
    for (const part of raw.scp) {
      if (typeof part === "string" && part.trim()) {
        scopes.add(part.trim());
      }
    }
  }
  return scopes;
}

export function assertUsageReadScope(verified: VerifiedEndUserAuth): void {
  const raw = verified.raw;
  if (raw == null || isApiKeyResolveResult(raw)) {
    return;
  }
  if (typeof raw !== "object") {
    throw new PmtHouseError("insufficient scope for usage read", {
      status: 403,
      code: "insufficient_scope",
    });
  }
  const scopes = scopesFromClaims(raw as Record<string, unknown>);
  if (scopes.has(SIGN_JOB_SCOPE) || scopes.has(USAGE_READ_SCOPE)) {
    return;
  }
  throw new PmtHouseError("insufficient scope for usage read", {
    status: 403,
    code: "insufficient_scope",
  });
}

export function assertClientIdMatch(identity: UsageIdentity, pathClientId: string): void {
  if (identity.client_id !== pathClientId) {
    throw new PmtHouseError("app not found", {
      status: 404,
      code: "not_found",
    });
  }
}

export async function verifyEndUserBearer(
  request: Request,
  endUserAuth: EndUserAuthVerifier,
): Promise<VerifiedEndUserAuth> {
  const authorization = request.headers.get("authorization") ?? "";
  try {
    bearerTokenFromAuthorization(authorization);
  } catch {
    throw new PmtHouseError("missing or invalid authorization", {
      status: 401,
      code: "invalid_token",
    });
  }
  return endUserAuth.verify({
    authorization,
    payload: { headers: {} },
    request,
  });
}
