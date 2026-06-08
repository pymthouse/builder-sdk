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

function readClaim(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (value != null && typeof value !== "object") {
    return String(value).trim();
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

  const usageSubject = readClaim(claims, claimUsageSubject);
  let usageSubjectType = defaultUsageSubjectType;
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
