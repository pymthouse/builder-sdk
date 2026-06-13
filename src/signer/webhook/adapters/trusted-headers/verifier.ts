import { PmtHouseError } from "../../../../errors.js";
import { headerValueFromWebhookPayload } from "../../payload.js";
import type { EndUserAuthVerifier } from "../../verifier.js";
import type { UsageIdentity } from "../../types.js";

export const DEFAULT_DMZ_TRUSTED_HEADERS = {
  issuer: "X-Livepeer-Usage-Issuer",
  clientId: "X-Livepeer-Client-ID",
  usageSubject: "X-Livepeer-Usage-Subject",
  usageSubjectType: "X-Livepeer-Usage-Subject-Type",
} as const;

export type TrustedHeadersEndUserAuthConfig = {
  expectedIssuer: string;
  headerNames?: Partial<typeof DEFAULT_DMZ_TRUSTED_HEADERS>;
  /** Auth cache TTL returned to go-livepeer when headers are trusted. */
  expiryTtlSeconds?: number;
};

function normalizeIssuer(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {
    end -= 1;
  }
  return value.slice(0, end);
}

export function identityFromTrustedHeaders(
  headers: Record<string, string[]> | undefined,
  config: TrustedHeadersEndUserAuthConfig,
): UsageIdentity {
  const names = {
    ...DEFAULT_DMZ_TRUSTED_HEADERS,
    ...config.headerNames,
  };
  const issuer = headerValueFromWebhookPayload(headers, names.issuer);
  const clientId = headerValueFromWebhookPayload(headers, names.clientId);
  const usageSubject = headerValueFromWebhookPayload(headers, names.usageSubject);
  const usageSubjectType =
    headerValueFromWebhookPayload(headers, names.usageSubjectType) ||
    "external_user_id";

  if (!issuer || !clientId || !usageSubject) {
    throw new PmtHouseError("missing trusted usage identity headers", {
      status: 403,
      code: "invalid_identity",
    });
  }

  if (
    normalizeIssuer(issuer) !== normalizeIssuer(config.expectedIssuer.trim())
  ) {
    throw new PmtHouseError("trusted usage issuer mismatch", {
      status: 403,
      code: "invalid_identity",
    });
  }

  return {
    issuer: normalizeIssuer(issuer),
    client_id: clientId,
    usage_subject: usageSubject,
    usage_subject_type: usageSubjectType,
  };
}

export function createTrustedHeadersEndUserVerifier(
  config: TrustedHeadersEndUserAuthConfig,
): EndUserAuthVerifier {
  const expiryTtlSeconds = config.expiryTtlSeconds ?? 300;

  return {
    kind: "trusted_headers",
    verify: async ({ payload }) => {
      const identity = identityFromTrustedHeaders(payload.headers, config);
      return {
        identity,
        expiry: Math.trunc(Date.now() / 1000) + expiryTtlSeconds,
      };
    },
  };
}
