import type {
  RemoteSignerWebhookConfig,
  WebhookAuthorizeContext,
} from "../../authorize.js";
import { createFirstMatchEndUserVerifier } from "../composite/verifier.js";
import {
  createTrustedHeadersEndUserVerifier,
  type TrustedHeadersEndUserAuthConfig,
} from "../trusted-headers/verifier.js";
import {
  createOidcEndUserVerifier,
  type OidcEndUserAuthConfig,
} from "./verifier.js";

function envTrim(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value || undefined;
}

export type OidcRemoteSignerWebhookConfigInput = OidcEndUserAuthConfig & {
  afterVerify?: (context: WebhookAuthorizeContext) => Promise<void>;
};

export type SignerDmzRemoteSignerWebhookConfigInput =
  OidcRemoteSignerWebhookConfigInput & {
    /** When true (default), accept Apache DMZ X-Livepeer-* identity headers. */
    dmzTrustedHeaders?: boolean;
    trustedHeaders?: Omit<TrustedHeadersEndUserAuthConfig, "expectedIssuer">;
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

/**
 * PymtHouse signer-dmz: Apache validates the end-user JWT (iss/aud = issuer), injects
 * X-Livepeer-* headers, and go-livepeer forwards those headers to this webhook per
 * go-livepeer remote-signer.md. Falls back to Bearer JWT verification when present.
 */
export function createSignerDmzRemoteSignerWebhookConfig(
  input: SignerDmzRemoteSignerWebhookConfigInput,
): RemoteSignerWebhookConfig {
  const {
    afterVerify,
    dmzTrustedHeaders = true,
    trustedHeaders,
    ...oidcConfig
  } = input;
  const oidcVerifier = createOidcEndUserVerifier(oidcConfig);
  const endUserAuth =
    dmzTrustedHeaders === false
      ? oidcVerifier
      : createFirstMatchEndUserVerifier([
          createTrustedHeadersEndUserVerifier({
            expectedIssuer: oidcConfig.jwtIssuer,
            ...trustedHeaders,
          }),
          oidcVerifier,
        ]);

  return {
    webhookSecret: oidcConfig.webhookSecret,
    endUserAuth,
    afterVerify,
  };
}

export function readOidcRemoteSignerWebhookConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RemoteSignerWebhookConfig {
  const webhookSecret = envTrim(env, "WEBHOOK_SECRET");
  const jwtIssuer = envTrim(env, "JWT_ISSUER");
  const jwtAudience = envTrim(env, "JWT_AUDIENCE") ?? jwtIssuer;

  if (!webhookSecret) {
    throw new Error("WEBHOOK_SECRET is required");
  }
  if (!jwtIssuer) {
    throw new Error("JWT_ISSUER is required");
  }
  if (!jwtAudience) {
    throw new Error("JWT_AUDIENCE is required");
  }

  return createSignerDmzRemoteSignerWebhookConfig({
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
export const readRemoteSignerWebhookConfigFromEnv =
  readOidcRemoteSignerWebhookConfigFromEnv;
