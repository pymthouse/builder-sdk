import { PmtHouseError } from "../../errors.js";
import type { UsageIdentity } from "./types.js";

export type WebhookIdentityClaimMapping = {
  claimClientId: string;
  claimUsageSubject: string;
  usageSubjectType: string;
};

export const DEFAULT_WEBHOOK_IDENTITY_CLAIMS: WebhookIdentityClaimMapping = {
  claimClientId: "client_id",
  claimUsageSubject: "sub",
  usageSubjectType: "external_user_id",
};

/**
 * Standard OIDC subject claim used to attribute usage when a deployment's
 * configured `claimUsageSubject` (e.g. `external_user_id`) is absent from the
 * token. Builder user-tokens minted at
 * `POST /api/v1/apps/{clientId}/users/{externalUserId}/token` (scope `sign:job`)
 * carry the app_user id in `sub` and do not emit `external_user_id`, so this
 * lets the billed `/generate-live-payment` path attribute them without a re-mint.
 */
const FALLBACK_USAGE_SUBJECT_CLAIM = "sub";

/** usage_subject_type applied when the subject is derived from the `sub` fallback and the token carries no explicit `user_type`/`usage_subject_type`. */
const FALLBACK_USAGE_SUBJECT_TYPE = "app_user";

function readClaim(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value.toString().trim();
  }
  return "";
}

export function identityFromWebhookClaims(
  claims: Record<string, unknown>,
  mapping: Partial<WebhookIdentityClaimMapping> = {},
): UsageIdentity {
  const claimClientId =
    mapping.claimClientId ?? DEFAULT_WEBHOOK_IDENTITY_CLAIMS.claimClientId;
  const claimUsageSubject =
    mapping.claimUsageSubject ?? DEFAULT_WEBHOOK_IDENTITY_CLAIMS.claimUsageSubject;
  const defaultUsageSubjectType =
    mapping.usageSubjectType ?? DEFAULT_WEBHOOK_IDENTITY_CLAIMS.usageSubjectType;

  let clientId = readClaim(claims, claimClientId);
  if (!clientId) {
    clientId = readClaim(claims, "azp");
  }

  let usageSubject = readClaim(claims, claimUsageSubject);
  let usageSubjectType = defaultUsageSubjectType;

  // Fall back to the standard OIDC `sub` claim when the configured usage-subject
  // claim is absent. This mirrors the client_id -> azp fallback above and only
  // triggers when the primary claim is empty, so tokens that already carry the
  // configured claim (e.g. external_user_id) keep their existing attribution.
  // Identity is still derived solely from claims validated by verifyJwt
  // (signature / aud / scope), so this does not weaken verification.
  if (!usageSubject && claimUsageSubject !== FALLBACK_USAGE_SUBJECT_CLAIM) {
    const fallbackSubject = readClaim(claims, FALLBACK_USAGE_SUBJECT_CLAIM);
    if (fallbackSubject) {
      usageSubject = fallbackSubject;
      // Attribute honestly to the subject's real type rather than the configured
      // default (which describes the primary claim that was not present).
      usageSubjectType = readClaim(claims, "user_type") || FALLBACK_USAGE_SUBJECT_TYPE;
    }
  }

  // An explicit usage_subject_type claim always wins (unchanged behavior).
  const claimUsageSubjectType = readClaim(claims, "usage_subject_type");
  if (claimUsageSubjectType) {
    usageSubjectType = claimUsageSubjectType;
  }

  const identity: UsageIdentity = {
    issuer: readClaim(claims, "iss"),
    client_id: clientId,
    usage_subject: usageSubject,
    usage_subject_type: usageSubjectType,
  };

  if (!identity.issuer || !identity.client_id || !identity.usage_subject) {
    throw new PmtHouseError("JWT missing required identity claims", {
      status: 403,
      code: "invalid_identity",
    });
  }

  return identity;
}

export function claimExpirySeconds(
  claims: Record<string, unknown>,
  fallbackTtlSeconds = 300,
): number {
  const exp = claims.exp;
  if (typeof exp === "number" && Number.isFinite(exp)) {
    return Math.trunc(exp);
  }
  if (typeof exp === "string" && exp.trim()) {
    const parsed = Number(exp);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return Math.trunc(Date.now() / 1000) + fallbackTtlSeconds;
}
