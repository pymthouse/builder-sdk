import { timingSafeEqual } from "node:crypto";
import { PmtHouseError } from "../../errors.js";
import { optionalBearerToken } from "./bearer.js";
import { authorizationFromWebhookPayload } from "./payload.js";
import type { PaymentWebhookRequest, PaymentWebhookResponse } from "./types.js";
import type { EndUserAuthVerifier, VerifiedEndUserAuth } from "./verifier.js";

export type {
  EndUserAuthVerifier,
  EndUserAuthVerifyContext,
  VerifiedEndUserAuth,
  WebhookAdminRoute,
} from "./verifier.js";

export type WebhookAuthorizeContext = {
  authorization: string;
  payload: PaymentWebhookRequest;
  request: Request;
  verified: VerifiedEndUserAuth;
  identity: VerifiedEndUserAuth["identity"];
};

export type RemoteSignerWebhookConfig = {
  webhookSecret: string;
  endUserAuth: EndUserAuthVerifier;
  afterVerify?: (context: WebhookAuthorizeContext) => Promise<void>;
};

function authIdFromIdentity(identity: VerifiedEndUserAuth["identity"]): string {
  return `${identity.client_id}:${identity.usage_subject}`;
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return timingSafeEqual(aBuffer, bBuffer);
}

export function authenticateWebhookCaller(request: Request, secret: string): boolean {
  if (!secret.trim()) {
    return false;
  }
  const trimmed = secret.trim();
  const bearer = optionalBearerToken(request.headers.get("authorization") ?? "");
  if (bearer && timingSafeEqualStrings(bearer, trimmed)) {
    return true;
  }
  const apiKey = request.headers.get("x-api-key")?.trim() ?? "";
  if (apiKey && timingSafeEqualStrings(apiKey, trimmed)) {
    return true;
  }
  const legacySecret = request.headers.get("x-webhook-secret")?.trim() ?? "";
  if (legacySecret && timingSafeEqualStrings(legacySecret, trimmed)) {
    return true;
  }
  return false;
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

function rejectStatusFromError(
  err: unknown,
): { status: number; reason: string; code?: string } {
  if (err instanceof PmtHouseError) {
    const reject: { status: number; reason: string; code?: string } = {
      status: err.status >= 400 && err.status < 600 ? err.status : 403,
      reason: err.message,
    };
    if (err.code && err.code !== "pymthouse_error") {
      reject.code = err.code;
    }
    return reject;
  }
  const reason = err instanceof Error ? err.message : "authorization rejected";
  return { status: 403, reason };
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

  const authorization = authorizationFromWebhookPayload(payload) ?? "";

  try {
    const verified = await config.endUserAuth.verify({
      authorization,
      payload,
      request,
    });

    if (config.afterVerify) {
      await config.afterVerify({
        authorization,
        payload,
        request,
        verified,
        identity: verified.identity,
      });
    }

    return paymentWebhookJson(200, {
      status: 200,
      expiry: verified.expiry,
      auth_id: authIdFromIdentity(verified.identity),
      identity: verified.identity,
    });
  } catch (err) {
    const { status, reason, code } = rejectStatusFromError(err);
    const body: PaymentWebhookResponse = { status, reason };
    if (code) {
      body.code = code;
    }
    return paymentWebhookJson(200, body);
  }
}

export function createRemoteSignerAuthorizeHandler(
  config: RemoteSignerWebhookConfig,
): (request: Request) => Promise<Response> {
  return (request) => handleRemoteSignerAuthorize(request, config);
}

export async function routeRemoteSignerWebhookRequest(
  request: Request,
  config: RemoteSignerWebhookConfig,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === "POST" && url.pathname === "/authorize") {
    return handleRemoteSignerAuthorize(request, config);
  }

  const adminRoutes = config.endUserAuth.adminRoutes ?? [];
  for (const route of adminRoutes) {
    if (request.method === route.method && url.pathname === route.pathname) {
      return route.handler(request);
    }
  }

  return null;
}
