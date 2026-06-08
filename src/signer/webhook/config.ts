import type { WebhookAuthorizeContext } from "./authorize.js";
import { createOidcEndUserVerifier, type OidcEndUserAuthConfig } from "./oidc-verifier.js";
import type { RemoteSignerWebhookConfig } from "./authorize.js";

function envTrim(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

export type OidcRemoteSignerWebhookConfigInput = OidcEndUserAuthConfig & {
  afterVerify?: (context: WebhookAuthorizeContext) => Promise<void>;
};

export function createOidcRemoteSignerWebhookConfig(
  input: OidcRemoteSignerWebhookConfigInput,
): RemoteSignerWebhookConfig {
  const { afterVerify, ...oidcConfig } = input;
  return {
    webhookSecret: oidcConfig.webhookSecret,
    endUserAuth: createOidcEndUserVerifier(oidcConfig),
    afterVerify,
  };
}

export function readOidcRemoteSignerWebhookConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RemoteSignerWebhookConfig {
  const webhookSecret = envTrim(env, "WEBHOOK_SECRET");
  const jwtIssuer = envTrim(env, "JWT_ISSUER");
  const jwtAudience = envTrim(env, "JWT_AUDIENCE");

  if (!webhookSecret) {
    throw new Error("WEBHOOK_SECRET is required");
  }
  if (!jwtIssuer) {
    throw new Error("JWT_ISSUER is required");
  }
  if (!jwtAudience) {
    throw new Error("JWT_AUDIENCE is required");
  }

  return createOidcRemoteSignerWebhookConfig({
    webhookSecret,
    jwtIssuer,
    jwtAudience,
    claimMapping: {
      claimClientId: envTrim(env, "CLAIM_CLIENT_ID") ?? "client_id",
      claimUsageSubject: envTrim(env, "CLAIM_USAGE_SUBJECT") ?? "sub",
      usageSubjectType: envTrim(env, "USAGE_SUBJECT_TYPE") ?? "external_user_id",
    },
    allowInsecureHttp: envTrim(env, "ALLOW_INSECURE_HTTP") === "1",
  });
}

/** @deprecated Use readOidcRemoteSignerWebhookConfigFromEnv */
export const readRemoteSignerWebhookConfigFromEnv = readOidcRemoteSignerWebhookConfigFromEnv;
