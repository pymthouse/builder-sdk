import { PmtHouseError } from "../../errors.js";
import { bearerTokenFromAuthorization } from "./oidc-verifier.js";
import type { UsageIdentity } from "./types.js";
import type { EndUserAuthVerifier } from "./verifier.js";

export type ApiKeyResolveResult = {
  userId: string;
  clientId?: string;
  usageSubjectType?: string;
};

export type ApiKeyEndUserVerifierConfig = {
  issuer: string;
  resolveApiKey: (apiKey: string) => Promise<ApiKeyResolveResult | null>;
  expiryTtlSeconds?: number;
  apiKeyPrefix?: string;
  defaultClientId?: string;
  defaultUsageSubjectType?: string;
};

export function createApiKeyEndUserVerifier(
  config: ApiKeyEndUserVerifierConfig,
): EndUserAuthVerifier {
  const prefix = config.apiKeyPrefix ?? "sk_";
  const defaultClientId = config.defaultClientId ?? "daydream-scope";
  const defaultUsageSubjectType =
    config.defaultUsageSubjectType ?? "clerk_user_id";
  const ttl = config.expiryTtlSeconds ?? 60;

  return {
    kind: "custom",
    verify: async ({ authorization }) => {
      const token = bearerTokenFromAuthorization(authorization);
      if (prefix && !token.startsWith(prefix)) {
        throw new PmtHouseError("invalid api key", {
          status: 401,
          code: "invalid_api_key",
        });
      }

      const resolved = await config.resolveApiKey(token);
      if (!resolved?.userId) {
        throw new PmtHouseError("invalid api key", {
          status: 401,
          code: "invalid_api_key",
        });
      }

      const identity: UsageIdentity = {
        issuer: config.issuer,
        client_id: resolved.clientId ?? defaultClientId,
        usage_subject: resolved.userId,
        usage_subject_type:
          resolved.usageSubjectType ?? defaultUsageSubjectType,
      };

      return {
        identity,
        expiry: Math.trunc(Date.now() / 1000) + ttl,
        raw: resolved,
      };
    },
  };
}
