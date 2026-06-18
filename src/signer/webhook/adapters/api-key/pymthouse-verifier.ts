import { PmtHouseError } from "../../../../errors.js";
import type { ApiKeyEndUserVerifierConfig } from "./verifier.js";
import { createApiKeyEndUserVerifier } from "./verifier.js";

export type PymthouseApiKeyResolveResult = {
  externalUserId: string;
  /** The key's owning app client id. Required — pymthouse is multi-tenant. */
  publicClientId: string;
  usageSubjectType?: string;
};

export type PymthouseApiKeyEndUserVerifierConfig = {
  issuer: string;
  resolveApiKey: (apiKey: string) => Promise<PymthouseApiKeyResolveResult | null>;
  expiryTtlSeconds?: number;
};

export function createPymthouseApiKeyEndUserVerifier(
  config: PymthouseApiKeyEndUserVerifierConfig,
) {
  const verifierConfig: ApiKeyEndUserVerifierConfig = {
    issuer: config.issuer,
    apiKeyPrefix: "pmth_",
    defaultUsageSubjectType: "external_user_id",
    expiryTtlSeconds: config.expiryTtlSeconds,
    resolveApiKey: async (apiKey) => {
      const resolved = await config.resolveApiKey(apiKey);
      if (!resolved?.externalUserId) {
        return null;
      }
      if (!resolved.publicClientId) {
        throw new PmtHouseError("resolved api key has no owning client id", {
          status: 401,
          code: "invalid_api_key",
        });
      }
      return {
        userId: resolved.externalUserId,
        clientId: resolved.publicClientId,
        usageSubjectType: resolved.usageSubjectType ?? "external_user_id",
      };
    },
  };
  return createApiKeyEndUserVerifier(verifierConfig);
}
