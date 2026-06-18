import { stripTrailingSlashes } from "../../../../string-utils.js";
import type {
  RemoteSignerWebhookConfig,
  WebhookAuthorizeContext,
} from "../../authorize.js";
import type { EndUserAuthVerifier } from "../../verifier.js";
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

/**
 * Default webhook JWT `aud` derived from the OIDC issuer. Signer JWTs are minted
 * with `aud` = issuer URL stripped of trailing slashes (see `signerJwtAudience`),
 * so the webhook must default the audience the same way — otherwise a trailing
 * slash on `JWT_ISSUER` silently breaks verification when `JWT_AUDIENCE` is unset.
 */
export function defaultSignerWebhookJwtAudience(jwtIssuer: string): string {
  return stripTrailingSlashes(jwtIssuer);
}

export type OidcRemoteSignerWebhookConfigInput = OidcEndUserAuthConfig & {
  afterVerify?: (context: WebhookAuthorizeContext) => Promise<void>;
};

export type SignerDmzRemoteSignerWebhookConfigInput =
  OidcRemoteSignerWebhookConfigInput & {
    /** When true (default), accept Apache DMZ X-Livepeer-* identity headers. */
    dmzTrustedHeaders?: boolean;
    trustedHeaders?: Omit<TrustedHeadersEndUserAuthConfig, "expectedIssuer">;
    /** Optional pmth_* api-key verifier (tried before trusted-headers / OIDC). */
    apiKeyVerifier?: EndUserAuthVerifier;
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
    apiKeyVerifier,
    ...oidcConfig
  } = input;
  const oidcVerifier = createOidcEndUserVerifier(oidcConfig);

  const verifiers: EndUserAuthVerifier[] = [];
  if (apiKeyVerifier) {
    verifiers.push(apiKeyVerifier);
  }
  if (dmzTrustedHeaders !== false) {
    verifiers.push(
      createTrustedHeadersEndUserVerifier({
        expectedIssuer: oidcConfig.jwtIssuer,
        ...trustedHeaders,
      }),
    );
  }
  verifiers.push(oidcVerifier);

  const endUserAuth =
    verifiers.length === 1
      ? verifiers[0]!
      : createFirstMatchEndUserVerifier(verifiers);

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
  const jwtAudience =
    envTrim(env, "JWT_AUDIENCE") ??
    (jwtIssuer ? defaultSignerWebhookJwtAudience(jwtIssuer) : undefined);

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
