import type { RemoteSignerWebhookConfig } from "../../authorize.js";
import type { WebhookAdminRoute } from "../../verifier.js";
import {
  createOidcRemoteSignerWebhookConfig,
  type OidcRemoteSignerWebhookConfigInput,
} from "../oidc/config.js";

export const AUTH0_WEBHOOK_IDENTITY_CLAIMS = {
  claimClientId: "azp",
  claimUsageSubject: "sub",
  usageSubjectType: "auth0_user_id",
} as const;

export type Auth0RemoteSignerWebhookConfigInput = Omit<
  OidcRemoteSignerWebhookConfigInput,
  "claimMapping"
> & {
  claimMapping?: OidcRemoteSignerWebhookConfigInput["claimMapping"];
  adminRoutes?: WebhookAdminRoute[];
};

function envTrim(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

export function createAuth0RemoteSignerWebhookConfig(
  input: Auth0RemoteSignerWebhookConfigInput,
): RemoteSignerWebhookConfig {
  const { adminRoutes, claimMapping, ...rest } = input;
  const config = createOidcRemoteSignerWebhookConfig({
    ...rest,
    claimMapping: {
      ...AUTH0_WEBHOOK_IDENTITY_CLAIMS,
      ...claimMapping,
    },
  });

  if (!adminRoutes?.length) {
    return config;
  }

  return {
    ...config,
    endUserAuth: {
      ...config.endUserAuth,
      adminRoutes,
    },
  };
}

export function readAuth0RemoteSignerWebhookConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<Auth0RemoteSignerWebhookConfigInput> = {},
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

  return createAuth0RemoteSignerWebhookConfig({
    webhookSecret,
    jwtIssuer,
    jwtAudience,
    claimMapping: {
      claimClientId: envTrim(env, "CLAIM_CLIENT_ID") ?? AUTH0_WEBHOOK_IDENTITY_CLAIMS.claimClientId,
      claimUsageSubject:
        envTrim(env, "CLAIM_USAGE_SUBJECT") ?? AUTH0_WEBHOOK_IDENTITY_CLAIMS.claimUsageSubject,
      usageSubjectType:
        envTrim(env, "USAGE_SUBJECT_TYPE") ?? AUTH0_WEBHOOK_IDENTITY_CLAIMS.usageSubjectType,
    },
    allowInsecureHttp: envTrim(env, "ALLOW_INSECURE_HTTP") === "1",
    ...overrides,
  });
}
