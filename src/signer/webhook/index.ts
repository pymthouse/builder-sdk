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
  EndUserAuthVerifyContext,
  VerifiedEndUserAuth,
  VerifiedEndUserToken,
  WebhookAdminRoute,
} from "./verifier.js";
export {
  bearerTokenFromAuthorization,
  createOidcEndUserVerifier,
  handleRemoteSignerRefreshJwks,
  type OidcEndUserAuthConfig,
} from "./oidc-verifier.js";
export {
  createOAuth1EndUserVerifier,
  type OAuth1EndUserAuthConfig,
} from "./oauth1-verifier.js";
export { authorizationFromWebhookPayload } from "./payload.js";
export {
  createOidcRemoteSignerWebhookConfig,
  readOidcRemoteSignerWebhookConfigFromEnv,
  readRemoteSignerWebhookConfigFromEnv,
  type OidcRemoteSignerWebhookConfigInput,
} from "./config.js";
export {
  startRemoteSignerWebhookServer,
  type RemoteSignerWebhookServerOptions,
} from "./server.js";

import type { OidcRemoteSignerWebhookConfigInput } from "./config.js";
import { handleRemoteSignerRefreshJwks as refreshJwks } from "./oidc-verifier.js";

/** @deprecated Use handleRemoteSignerRefreshJwks with OidcEndUserAuthConfig */
export function createRemoteSignerRefreshJwksHandler(
  config: OidcRemoteSignerWebhookConfigInput,
): (request: Request) => Promise<Response> {
  return (request) => refreshJwks(request, config);
}
