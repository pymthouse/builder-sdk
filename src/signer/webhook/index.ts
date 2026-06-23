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
  routeIdentityServiceRequest,
  routeRemoteSignerWebhookRequest,
  type IdentityServiceConfig,
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
export {
  assertClientIdMatch,
  assertNoCrossUserQueryParams,
  assertUsageReadScope,
  matchUsageMeRoute,
  verifyEndUserBearer,
  type UsageMeRouteMatch,
} from "../../usage/end-user-auth.js";
export {
  routeEndUserUsageRequest,
  type EndUserUsageConfig,
} from "../../usage/end-user-routes.js";
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
export { authorizationFromWebhookPayload, headerValueFromWebhookPayload } from "./payload.js";
export {
  REMOTE_SIGNER_ERROR_CODE,
  REMOTE_SIGNER_HTTP_STATUS,
  billingUnavailableError,
  insufficientBalanceError,
} from "../remote-signer-status.js";
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

import type { OidcRemoteSignerWebhookConfigInput } from "./adapters/oidc/config.js";
import { handleRemoteSignerRefreshJwks as refreshJwks } from "./adapters/oidc/verifier.js";

/** @deprecated Use handleRemoteSignerRefreshJwks with OidcEndUserAuthConfig */
export function createRemoteSignerRefreshJwksHandler(
  config: OidcRemoteSignerWebhookConfigInput,
): (request: Request) => Promise<Response> {
  return (request) => refreshJwks(request, config);
}
