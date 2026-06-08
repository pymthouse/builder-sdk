import { PmtHouseError } from "../../errors.js";
import { loadAuthorizationServer } from "../../discovery.js";
import { verifyJwt } from "../../verify.js";
import type { FetchLike } from "../../types.js";
import {
  claimExpirySeconds,
  DEFAULT_WEBHOOK_IDENTITY_CLAIMS,
  identityFromWebhookClaims,
  type WebhookIdentityClaimMapping,
} from "./identity.js";
import { authorizationFromWebhookPayload } from "./payload.js";
import type { PaymentWebhookRequest, PaymentWebhookResponse, UsageIdentity } from "./types.js";

export type VerifiedEndUserToken = {
  claims: Record<string, unknown>;
  expiry: number;
};

export type WebhookAuthorizeContext = {
  authorization: string;
  payload: PaymentWebhookRequest;
  verified: VerifiedEndUserToken;
  identity: UsageIdentity;
};

export type RemoteSignerWebhookConfig = {
  webhookSecret: string;
  jwtIssuer: string;
  jwtAudience?: string;
  claimMapping?: Partial<WebhookIdentityClaimMapping>;
  allowInsecureHttp?: boolean;
  fetch?: FetchLike;
  requiredScopes?: string[];
  /** Override JWT verification (tests or custom policy). */
  verifyEndUserToken?: (authorization: string) => Promise<VerifiedEndUserToken>;
  /** Platform policy after JWT verification (balance, app status, etc.). */
  afterVerify?: (context: WebhookAuthorizeContext) => Promise<void>;
};

export function bearerTokenFromAuthorization(authorization: string): string {
  const trimmed = authorization.trim();
  if (!trimmed) {
    throw new Error("missing authorization");
  }
  const prefix = "Bearer ";
  if (!trimmed.startsWith(prefix)) {
    throw new Error("authorization must be Bearer token");
  }
  const token = trimmed.slice(prefix.length).trim();
  if (!token) {
    throw new Error("empty bearer token");
  }
  return token;
}

export function authenticateWebhookCaller(request: Request, secret: string): boolean {
  if (!secret.trim()) {
    return false;
  }
  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (auth === `Bearer ${secret}`) {
    return true;
  }
  const apiKey = request.headers.get("x-api-key")?.trim() ?? "";
  return apiKey === secret;
}

function paymentWebhookJson(
  httpStatus: number,
  body: PaymentWebhookResponse,
): Response {
  return new Response(JSON.stringify(body), {
    status: httpStatus,
    headers: { "Content-Type": "application/json" },
  });
}

function rejectStatusFromError(err: unknown): { status: number; reason: string } {
  if (err instanceof PmtHouseError) {
    return {
      status: err.status >= 400 && err.status < 600 ? err.status : 403,
      reason: err.message,
    };
  }
  const reason = err instanceof Error ? err.message : "authorization rejected";
  return { status: 403, reason };
}

async function defaultVerifyEndUserToken(
  authorization: string,
  config: RemoteSignerWebhookConfig,
): Promise<VerifiedEndUserToken> {
  const token = bearerTokenFromAuthorization(authorization);
  const audience = config.jwtAudience?.trim();
  if (!audience) {
    throw new Error("jwt audience is required for webhook verification");
  }

  const claims = await verifyJwt(token, {
    issuerUrl: config.jwtIssuer,
    audience,
    fetch: config.fetch,
    allowInsecureHttp: config.allowInsecureHttp,
    requiredScopes: config.requiredScopes,
  });

  return {
    claims: claims as unknown as Record<string, unknown>,
    expiry: claimExpirySeconds(claims as unknown as Record<string, unknown>),
  };
}

export async function handleRemoteSignerAuthorize(
  request: Request,
  config: RemoteSignerWebhookConfig,
): Promise<Response> {
  if (!authenticateWebhookCaller(request, config.webhookSecret)) {
    return paymentWebhookJson(401, {
      status: 401,
      reason: "unauthorized webhook caller",
    });
  }

  let payload: PaymentWebhookRequest;
  try {
    payload = (await request.json()) as PaymentWebhookRequest;
  } catch {
    return paymentWebhookJson(400, {
      status: 400,
      reason: "invalid request json",
    });
  }

  const authorization = authorizationFromWebhookPayload(payload);
  if (!authorization) {
    return paymentWebhookJson(400, {
      status: 400,
      reason: "missing authorization in webhook payload headers",
    });
  }

  const verify =
    config.verifyEndUserToken ??
    ((auth: string) => defaultVerifyEndUserToken(auth, config));

  try {
    const verified = await verify(authorization);
    const identity = identityFromWebhookClaims(verified.claims, {
      ...DEFAULT_WEBHOOK_IDENTITY_CLAIMS,
      ...config.claimMapping,
    });

    if (config.afterVerify) {
      await config.afterVerify({
        authorization,
        payload,
        verified,
        identity,
      });
    }

    return paymentWebhookJson(200, {
      status: 200,
      expiry: verified.expiry,
      identity,
    });
  } catch (err) {
    const { status, reason } = rejectStatusFromError(err);
    return paymentWebhookJson(200, {
      status,
      reason,
    });
  }
}

export async function handleRemoteSignerRefreshJwks(
  request: Request,
  config: Pick<RemoteSignerWebhookConfig, "webhookSecret" | "jwtIssuer" | "fetch" | "allowInsecureHttp">,
): Promise<Response> {
  if (!authenticateWebhookCaller(request, config.webhookSecret)) {
    return new Response("unauthorized", { status: 401 });
  }

  try {
    await loadAuthorizationServer(config.jwtIssuer, config.fetch ?? fetch, {
      force: true,
      allowInsecureHttp: config.allowInsecureHttp,
    });
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "jwks refresh failed";
    return new Response(message, { status: 500 });
  }
}

export function createRemoteSignerAuthorizeHandler(
  config: RemoteSignerWebhookConfig,
): (request: Request) => Promise<Response> {
  return (request) => handleRemoteSignerAuthorize(request, config);
}

export function createRemoteSignerRefreshJwksHandler(
  config: RemoteSignerWebhookConfig,
): (request: Request) => Promise<Response> {
  return (request) => handleRemoteSignerRefreshJwks(request, config);
}

export async function routeRemoteSignerWebhookRequest(
  request: Request,
  config: RemoteSignerWebhookConfig,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/authorize") {
    return handleRemoteSignerAuthorize(request, config);
  }
  if (request.method === "POST" && url.pathname === "/admin/refresh-jwks") {
    return handleRemoteSignerRefreshJwks(request, config);
  }
  return null;
}
