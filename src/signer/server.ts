import {
  allowInsecureRequests,
  ClientSecretBasic,
  clientCredentialsGrantRequest,
  customFetch,
  genericTokenEndpointRequest,
  None,
  processClientCredentialsResponse,
  processGenericTokenEndpointResponse,
} from "oauth4webapi";
import { loadAuthorizationServer } from "../discovery.js";
import { PmtHouseError } from "../errors.js";
import { SIGN_JOB_SCOPE } from "../tokens.js";
import {
  parseCreateSignedTicketEvent,
  createSignedTicketIdempotencyKey,
} from "./kafka-events.js";
import type {
  CreateOAuthSignerTokenIssuerOptions,
  CreateSignerBootstrapServiceOptions,
  CreateSignerProxyHandlerOptions,
  DeviceSignerExchangeRequest,
  SignerBootstrapRequest,
  SignerBootstrapResponse,
  SignerToken,
  SignerTokenIssuer,
  SignerTokenMintInput,
} from "./types.js";

const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const SUBJECT_ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const REQUESTED_ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

function errorResponse(error: unknown, status = 400): Response {
  if (error instanceof PmtHouseError) {
    return jsonResponse(
      { error: error.message, code: error.code },
      { status: error.status ?? 400 },
    );
  }
  const message = error instanceof Error ? error.message : "Unexpected signer error";
  return jsonResponse({ error: message }, { status });
}

function bearerFromRequest(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match?.[1]?.trim()) {
    throw new PmtHouseError("Missing Bearer token", {
      status: 401,
      code: "invalid_token",
    });
  }
  return match[1].trim();
}

function tokenResponseToSignerToken(response: {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}): SignerToken {
  const expiresIn =
    typeof response.expires_in === "number" && Number.isFinite(response.expires_in)
      ? Math.floor(response.expires_in)
      : 300;
  return {
    accessToken: response.access_token,
    tokenType: "Bearer",
    expiresIn,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    scope: typeof response.scope === "string" && response.scope ? response.scope : SIGN_JOB_SCOPE,
  };
}

function oauthRequestOptions(
  options: Pick<CreateOAuthSignerTokenIssuerOptions, "fetch" | "allowInsecureHttp">,
): Record<symbol, unknown> {
  const requestOptions: Record<symbol, unknown> = {};
  if (options.fetch) requestOptions[customFetch] = options.fetch;
  if (options.allowInsecureHttp) requestOptions[allowInsecureRequests] = true;
  return requestOptions;
}

function appendIdentityParams(
  params: URLSearchParams,
  options: CreateOAuthSignerTokenIssuerOptions,
  input: SignerTokenMintInput,
): void {
  if (options.sendIdentityParams === false) return;

  params.set("client_id", input.identity.clientId);
  params.set("usage_subject", input.identity.usageSubject);
  params.set("usage_subject_type", input.identity.usageSubjectType);
}

export function createOAuthSignerTokenIssuer(
  options: CreateOAuthSignerTokenIssuerOptions,
): SignerTokenIssuer {
  const fetchImpl = options.fetch ?? fetch;

  return {
    async mintSignerToken(input: SignerTokenMintInput): Promise<SignerToken> {
      const as = await loadAuthorizationServer(options.issuerUrl, fetchImpl, {
        allowInsecureHttp: options.allowInsecureHttp,
      });
      const client = { client_id: options.clientId };
      const scope = input.scope ?? options.scope ?? SIGN_JOB_SCOPE;
      const requestOptions = oauthRequestOptions(options);

      if (input.subjectToken) {
        const params = new URLSearchParams(options.extraParams);
        params.set("subject_token", input.subjectToken);
        params.set("subject_token_type", SUBJECT_ACCESS_TOKEN_TYPE);
        params.set("requested_token_type", REQUESTED_ACCESS_TOKEN_TYPE);
        params.set("scope", scope);
        params.set("audience", input.audience ?? options.audience ?? "livepeer-remote-signer");
        appendIdentityParams(params, options, input);

        const response = await genericTokenEndpointRequest(
          as,
          client,
          options.clientSecret ? ClientSecretBasic(options.clientSecret) : None(),
          TOKEN_EXCHANGE_GRANT,
          params,
          requestOptions as import("oauth4webapi").TokenEndpointRequestOptions,
        );
        const token = await processGenericTokenEndpointResponse(as, client, response);
        return tokenResponseToSignerToken(token);
      }

      const params = new URLSearchParams(options.extraParams);
      params.set("scope", scope);
      params.set("audience", input.audience ?? options.audience ?? "livepeer-remote-signer");
      appendIdentityParams(params, options, input);

      const response = await clientCredentialsGrantRequest(
        as,
        client,
        options.clientSecret ? ClientSecretBasic(options.clientSecret) : None(),
        params,
        requestOptions as import("oauth4webapi").ClientCredentialsGrantRequestOptions,
      );
      const token = await processClientCredentialsResponse(as, client, response);
      return tokenResponseToSignerToken(token);
    },
  };
}

export function createSignerBootstrapService(options: CreateSignerBootstrapServiceOptions) {
  async function bootstrap(input: SignerBootstrapRequest): Promise<SignerBootstrapResponse> {
    if (!input.subjectToken?.trim()) {
      throw new PmtHouseError("subjectToken is required", {
        status: 400,
        code: "invalid_request",
      });
    }

    const identity = await options.identityResolver.resolveFromSubjectToken(
      input.subjectToken.trim(),
      { clientId: input.clientId },
    );
    const balance = (await options.accountingStore?.getBalance(identity)) ?? null;
    await options.beforeMint?.({ identity, balance, input });
    const token = await options.tokenIssuer.mintSignerToken({
      identity,
      subjectToken: input.subjectToken.trim(),
      scope: input.scope ?? options.defaultScope,
    });
    return { token, identity, balance };
  }

  async function exchangeDeviceToken(
    input: DeviceSignerExchangeRequest,
  ): Promise<SignerBootstrapResponse> {
    if (!input.deviceToken?.trim()) {
      throw new PmtHouseError("deviceToken is required", {
        status: 400,
        code: "invalid_request",
      });
    }

    return bootstrap({
      subjectToken: input.deviceToken.trim(),
      clientId: input.clientId,
      scope: input.scope,
    });
  }

  async function balanceFromBearer(bearerToken: string) {
    const identity = await options.identityResolver.resolveFromBearerToken(bearerToken);
    return (await options.accountingStore?.getBalance(identity)) ?? null;
  }

  return { bootstrap, exchangeDeviceToken, balanceFromBearer };
}

export function createSignerRouteHandlers(options: CreateSignerBootstrapServiceOptions) {
  const service = createSignerBootstrapService(options);

  return {
    async bootstrap(request: Request): Promise<Response> {
      try {
        const body = (await request.json()) as SignerBootstrapRequest;
        return jsonResponse(await service.bootstrap(body));
      } catch (error) {
        return errorResponse(error);
      }
    },
    async deviceExchange(request: Request): Promise<Response> {
      try {
        const body = (await request.json()) as DeviceSignerExchangeRequest;
        return jsonResponse(await service.exchangeDeviceToken(body));
      } catch (error) {
        return errorResponse(error);
      }
    },
    async balance(request: Request): Promise<Response> {
      try {
        const bearer = bearerFromRequest(request);
        return jsonResponse({ balance: await service.balanceFromBearer(bearer) });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

export function createSignerProxyHandler(options: CreateSignerProxyHandlerOptions) {
  const fetchImpl = options.fetch ?? fetch;
  const remoteSignerBase = new URL(options.remoteSignerUrl);

  return async function signerProxyHandler(request: Request): Promise<Response> {
    const earlyResponse = await options.beforeProxy?.(request);
    if (earlyResponse) return earlyResponse;

    const accessToken = await options.resolveAccessToken(request);
    const upstreamUrl = new URL(request.url);
    const remotePath = upstreamUrl.pathname.replace(/^\/api\/signer\/proxy/, "");
    const target = new URL(remoteSignerBase);
    target.pathname = remotePath || "/generate-live-payment";
    target.search = upstreamUrl.search;

    const headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    headers.delete("host");
    headers.delete("content-length");

    return fetchImpl(target, {
      method: request.method,
      headers,
      body: request.body,
      duplex: "half",
      cache: "no-store",
    } as RequestInit & { duplex: "half" });
  };
}

export {
  normalizeSignerIdentity,
  signerIdentityEquals,
  signerIdentityToClaims,
} from "./identity.js";
export {
  createJwtClaimsIdentityResolver,
  identityFromAccessTokenClaims,
  assertIdentityMatches,
} from "./identity-policy.js";
export type {
  CreateJwtClaimsIdentityResolverOptions,
  SignerIdentityHints,
  SignerIdentityResolver,
} from "./identity-policy.js";
export { parseCreateSignedTicketEvent, createSignedTicketIdempotencyKey };
export type {
  CreateOAuthSignerTokenIssuerOptions,
  CreateSignedTicketEvent,
  CreateSignerBootstrapServiceOptions,
  CreateSignerProxyHandlerOptions,
  DeviceSignerExchangeRequest,
  SignerAccountingStore,
  SignerBalance,
  SignerBootstrapMintContext,
  SignerBootstrapRequest,
  SignerBootstrapResponse,
  SignerIdentity,
  SignerToken,
  SignerTokenIssuer,
  SignerTokenMintInput,
  SignerUsageSubjectType,
} from "./types.js";
