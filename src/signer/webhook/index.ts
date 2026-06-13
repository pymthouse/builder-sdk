export type {
  PaymentWebhookRequest,
  PaymentWebhookResponse,
  UsageIdentity,
} from "./types.js";
export { isValidUsageIdentity } from "./types.js";
export {
  DEFAULT_WEBHOOK_IDENTITY_CLAIMS,
  claimExpirySeconds,
  identityFromWebhookClaims,
  type WebhookIdentityClaimMapping,
} from "./identity.js";
export {
  authenticateWebhookCaller,
  createRemoteSignerAuthorizeHandler,
  handleRemoteSignerAuthorize,
  routeRemoteSignerWebhookRequest,
  type RemoteSignerWebhookConfig,
  type WebhookAuthorizeContext,
} from "./authorize.js";
export type {
  EndUserAuthVerifier,
  EndUserAuthVerifierKind,
  EndUserAuthVerifyContext,
  VerifiedEndUserAuth,
  WebhookAdminRoute,
} from "./verifier.js";
export { bearerTokenFromAuthorization, optionalBearerToken } from "./bearer.js";
export {
  createApiKeyEndUserVerifier,
  type ApiKeyEndUserVerifierConfig,
  type ApiKeyResolveResult,
} from "./adapters/api-key/index.js";
export { createFirstMatchEndUserVerifier } from "./adapters/composite/index.js";
export {
  createOidcEndUserVerifier,
  handleRemoteSignerRefreshJwks,
  type OidcEndUserAuthConfig,
} from "./adapters/oidc/verifier.js";
export {
  createOAuth1EndUserVerifier,
  type OAuth1EndUserAuthConfig,
} from "./adapters/oauth1/index.js";
export { authorizationFromWebhookPayload, headerValueFromWebhookPayload } from "./payload.js";
export {
  createOidcRemoteSignerWebhookConfig,
  createSignerDmzRemoteSignerWebhookConfig,
  readOidcRemoteSignerWebhookConfigFromEnv,
  readRemoteSignerWebhookConfigFromEnv,
  type OidcRemoteSignerWebhookConfigInput,
  type SignerDmzRemoteSignerWebhookConfigInput,
} from "./adapters/oidc/config.js";
export {
  createTrustedHeadersEndUserVerifier,
  DEFAULT_DMZ_TRUSTED_HEADERS,
  identityFromTrustedHeaders,
  type TrustedHeadersEndUserAuthConfig,
} from "./adapters/trusted-headers/index.js";
export {
  startRemoteSignerWebhookServer,
  type RemoteSignerWebhookServerOptions,
} from "./server.js";

import type { OidcRemoteSignerWebhookConfigInput } from "./adapters/oidc/config.js";
import { handleRemoteSignerRefreshJwks as refreshJwks } from "./adapters/oidc/verifier.js";

/** @deprecated Use handleRemoteSignerRefreshJwks with OidcEndUserAuthConfig */
export function createRemoteSignerRefreshJwksHandler(
  config: OidcRemoteSignerWebhookConfigInput,
): (request: Request) => Promise<Response> {
  return (request) => refreshJwks(request, config);
}
