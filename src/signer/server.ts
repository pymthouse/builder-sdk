import { PmtHouseError } from "../errors.js";
import { signerHandlerErrorResponse } from "./handler-errors.js";
import { createSignerTokenManager } from "./token-manager.js";
import { forwardDirectSignerRequest } from "./forward.js";
import { forwardWithOptionalMetering } from "./metering.js";
import { mintUserSignerToken } from "./mint-token.js";
import type {
  CachedSignerToken,
  DirectSignerBeforeSignResult,
  DirectSignerProxyConfig,
} from "./types.js";

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function toResponse(result: DirectSignerBeforeSignResult): Response {
  if (result instanceof Response) {
    return result;
  }
  return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
    status: result.status,
    headers: { "Content-Type": "application/json" },
  });
}

export interface DirectSignerProxyHandler {
  (request: Request): Promise<Response>;
  getCachedUsage(externalUserId: string): CachedSignerToken | undefined;
  invalidateToken(externalUserId: string): void;
}

export function createDirectSignerProxyHandler(
  config: DirectSignerProxyConfig,
): DirectSignerProxyHandler {
  const tokenManager = createSignerTokenManager({
    mint: (externalUserId) =>
      mintUserSignerToken({
        issuerUrl: config.pymthouseIssuerUrl,
        m2mClientId: config.pymthouseM2MClientId,
        m2mClientSecret: config.pymthouseM2MClientSecret,
        externalUserId,
        fetch: config.fetch,
        allowInsecureHttp: config.allowInsecureHttp,
      }),
  });

  async function runBeforeSign(
    token: CachedSignerToken,
    externalUserId: string,
    request: Request,
  ): Promise<Response | null> {
    if (!config.beforeSign) {
      return null;
    }
    const result = await config.beforeSign({ token, externalUserId, request });
    if (!result) {
      return null;
    }
    return toResponse(result);
  }

  async function forwardOnce(token: CachedSignerToken, request: Request): Promise<Response> {
    return forwardDirectSignerRequest({
      request,
      remoteSignerUrl: config.remoteSignerUrl,
      jwt: token.jwt,
      proxyPathPrefix: config.proxyPathPrefix,
      defaultRemotePath: config.defaultRemotePath,
      fetch: config.fetch,
    });
  }

  const handler = async function directSignerProxyHandler(request: Request): Promise<Response> {
    try {
      const session = await config.authenticate(request);
      if (session == null) {
        return unauthorizedResponse();
      }

      const externalUserId = (await config.resolveExternalUserId(session)).trim();
      if (!externalUserId) {
        throw new PmtHouseError("resolveExternalUserId returned an empty id", {
          status: 500,
          code: "invalid_external_user_id",
        });
      }

      const publicClientId = config.resolvePublicClientId
        ? (await config.resolvePublicClientId(session)).trim()
        : config.pymthouseClientId.trim();
      if (!publicClientId) {
        throw new PmtHouseError("resolvePublicClientId returned an empty id", {
          status: 500,
          code: "invalid_client_id",
        });
      }

      let token = await tokenManager.getToken(publicClientId, externalUserId);
      const blocked = await runBeforeSign(token, externalUserId, request);
      if (blocked) {
        return blocked;
      }

      let upstream = await forwardWithOptionalMetering({
        config,
        publicClientId,
        externalUserId,
        forward: () => forwardOnce(token, request),
      });
      if (upstream.status === 401) {
        tokenManager.invalidate(publicClientId, externalUserId);
        token = await tokenManager.getToken(publicClientId, externalUserId, {
          forceRefresh: true,
        });
        const retryBlocked = await runBeforeSign(token, externalUserId, request);
        if (retryBlocked) {
          return retryBlocked;
        }
        upstream = await forwardWithOptionalMetering({
          config,
          publicClientId,
          externalUserId,
          forward: () => forwardOnce(token, request),
        });
      }

      return upstream;
    } catch (error) {
      return signerHandlerErrorResponse(error);
    }
  } as DirectSignerProxyHandler;

  handler.getCachedUsage = (externalUserId: string) =>
    tokenManager.peek(config.pymthouseClientId, externalUserId);
  handler.invalidateToken = (externalUserId: string) =>
    tokenManager.invalidate(config.pymthouseClientId, externalUserId);

  return handler;
}

export { createSignerTokenManager, type SignerTokenManager } from "./token-manager.js";
export { forwardDirectSignerRequest, decodeJwtPayload, identityFromJwtPayload, livepeerIdentityHeaders } from "./forward.js";
export {
  mintUserSignerToken,
  parseMintUserSignerTokenResponse,
  SIGN_MINT_USER_TOKEN_SCOPE,
  LIVEPEER_REMOTE_SIGNER_AUDIENCE,
} from "./mint-token.js";
export {
  createDeviceExchangeHandler,
  exchangeDeviceTokenForSigner,
  extractSignerAccessTokenFromExchangeBody,
  mintSignerTokenFromDeviceToken,
  normalizeDeviceExchangeResponse,
  parseDeviceExchangeRequestBody,
} from "./device-exchange.js";
export {
  createApiKeyExchangeHandler,
  exchangeApiKeyForSigner,
  mintSignerSessionFromApiKey,
  mintUserAccessTokenFromApiKey,
  parseApiKeyExchangeRequestBody,
} from "./api-key-exchange.js";
export {
  forwardToSigner,
  getCachedDmzBearerToken,
  normalizeSignerBaseUrl,
  parseSignerUsageSnapshot,
  pickConflictingNumberAliases,
  pickConflictingStringAliases,
  probeSignerHttpReachability,
  readSignerUpstreamBody,
  resolveSignerBaseUrl,
  stripSignerUsageFromResponse,
} from "./proxy.js";
export {
  forwardWithOptionalMetering,
} from "./metering.js";
export {
  ingestSignedTicket,
  signerSnapshotToIngestPayload,
} from "../ingest.js";
export type {
  CachedSignerToken,
  DirectSignerBeforeSignContext,
  DirectSignerBeforeSignResult,
  DirectSignerProxyConfig,
  ApiKeyExchangeHandlerConfig,
  ApiKeyExchangeMintResult,
  ApiKeyExchangeRequestBody,
  DeviceExchangeHandlerConfig,
  DeviceExchangeHandlerConfigRemote,
  DeviceExchangeMintContext,
  DeviceExchangeMintResult,
  DeviceExchangeRequestBody,
  DeviceExchangeResponse,
  ExchangeApiKeyForSignerOptions,
  ExchangeDeviceTokenForSignerOptions,
  ForwardDirectSignerRequestOptions,
  ForwardToSignerOptions,
  ForwardToSignerResult,
  MintSignerTokenFromDeviceTokenOptions,
  MintUserSignerTokenOptions,
  MintUserSignerTokenResponse,
  ProbeSignerHttpReachabilityOptions,
  SignerDmzGate,
  SignerJwtIdentity,
  SignerMeteringConfig,
  SignerMeteringMode,
  SignerTokenManagerOptions,
  resolvesToHostedMetering,
  resolvesToPlatformMetering,
} from "./types.js";
export type { SignerUsageSnapshot } from "./proxy.js";
