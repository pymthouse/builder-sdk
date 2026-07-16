import { encodeClientSecretBasic } from "../encoding.js";
import { stripIssuerOriginFromOidcUrl, stripTrailingSlashes } from "../string-utils.js";
import { PmtHouseError } from "../errors.js";
import { readJsonObjectFromResponse } from "./fetch-json.js";
import { signerHandlerErrorResponse } from "./handler-errors.js";
import {
  deviceExchangeResponseFromSignerSessionBody,
  normalizeDeviceExchangeResponse,
} from "./device-exchange.js";
import type {
  ApiKeyExchangeHandlerConfig,
  ApiKeyExchangeMintResult,
  ApiKeyExchangeRequestBody,
  DeviceExchangeResponse,
  ExchangeApiKeyForSignerOptions,
} from "./types.js";

const EXCHANGE_RESPONSE_ERROR = "invalid_exchange_response";
const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";

export async function parseApiKeyExchangeRequestBody(
  request: Request,
): Promise<ApiKeyExchangeRequestBody> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new PmtHouseError("Request body must be JSON", {
      status: 400,
      code: "invalid_request",
    });
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new PmtHouseError("Request body must be a JSON object", {
      status: 400,
      code: "invalid_request",
    });
  }
  const record = body as Record<string, unknown>;
  const apiKeyRaw = record.apiKey;
  if (typeof apiKeyRaw !== "string" || !apiKeyRaw.trim()) {
    throw new PmtHouseError("Request body must include apiKey", {
      status: 400,
      code: "invalid_request",
    });
  }
  const apiKey = apiKeyRaw.trim();
  if (apiKey.startsWith("pmth_cs_")) {
    throw new PmtHouseError(
      "pmth_cs_* is an M2M client secret; use HTTP Basic client auth, not the API-key exchange",
      { status: 400, code: "invalid_request" },
    );
  }
  const scope =
    typeof record.scope === "string" && record.scope.trim()
      ? record.scope.trim()
      : undefined;
  const clientId =
    typeof record.clientId === "string" && record.clientId.trim()
      ? record.clientId.trim()
      : undefined;
  return { apiKey, scope, clientId };
}

/**
 * Exchange a long-lived API key (bare `pmth_*` or composite `app_<24hex>_<secret>`)
 * for a short-lived signer JWT via app-scoped RFC 8693 token exchange.
 *
 * Canonical issuer route: `POST /api/v1/apps/{clientId}/oidc/token`.
 */
export async function mintSignerSessionFromApiKeyDirect(input: {
  issuerUrl: string;
  publicClientId: string;
  apiKey: string;
  scope?: string;
  m2mClientId?: string;
  m2mClientSecret?: string;
  fetch?: typeof fetch;
}): Promise<DeviceExchangeResponse> {
  const fetchImpl = input.fetch ?? fetch;
  const issuerOrigin = stripIssuerOriginFromOidcUrl(input.issuerUrl);
  const url = `${issuerOrigin}/api/v1/apps/${encodeURIComponent(input.publicClientId)}/oidc/token`;

  const form = new URLSearchParams({
    grant_type: TOKEN_EXCHANGE_GRANT,
    subject_token: input.apiKey,
    subject_token_type: ACCESS_TOKEN_TYPE,
  });
  if (input.scope?.trim()) {
    form.set("scope", input.scope.trim());
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  const m2mId = input.m2mClientId?.trim();
  const m2mSecret = input.m2mClientSecret?.trim();
  if (m2mId && m2mSecret) {
    headers.Authorization = encodeClientSecretBasic(m2mId, m2mSecret);
  }

  const response = await fetchImpl(url, {
    method: "POST",
    headers,
    body: form.toString(),
    cache: "no-store",
  });

  const parsed = await readJsonObjectFromResponse(response, {
    invalidJsonMessage: "Token exchange returned invalid JSON",
    invalidJsonCode: EXCHANGE_RESPONSE_ERROR,
    failureLabel: "API key token exchange failed",
    defaultErrorCode: "api_key_exchange_failed",
  });

  return deviceExchangeResponseFromSignerSessionBody(parsed, {
    defaultScope: input.scope,
  });
}

/**
 * @deprecated Prefer {@link mintSignerSessionFromApiKeyDirect}. Kept for call-site
 * compatibility; performs the same app-scoped OIDC token exchange.
 */
export async function mintUserAccessTokenFromApiKey(input: {
  issuerUrl: string;
  publicClientId: string;
  apiKey: string;
  scope?: string;
  m2mClientId?: string;
  m2mClientSecret?: string;
  fetch?: typeof fetch;
}): Promise<{ access_token: string; expires_in: number; scope: string }> {
  const session = await mintSignerSessionFromApiKeyDirect(input);
  return {
    access_token: session.access_token,
    expires_in: session.expires_in,
    scope: session.scope,
  };
}

export async function mintSignerSessionFromApiKey(input: {
  issuerUrl: string;
  publicClientId: string;
  m2mClientId: string;
  m2mClientSecret: string;
  apiKey: string;
  scope?: string;
  audience?: string;
  fetch?: typeof fetch;
  allowInsecureHttp?: boolean;
}): Promise<ApiKeyExchangeMintResult> {
  const direct = await mintSignerSessionFromApiKeyDirect({
    issuerUrl: input.issuerUrl,
    publicClientId: input.publicClientId,
    apiKey: input.apiKey,
    scope: input.scope,
    m2mClientId: input.m2mClientId,
    m2mClientSecret: input.m2mClientSecret,
    fetch: input.fetch,
  });
  return {
    access_token: direct.access_token,
    expires_in: direct.expires_in,
    scope: direct.scope,
    balanceUsdMicros: direct.balanceUsdMicros,
    lifetimeGrantedUsdMicros: direct.lifetimeGrantedUsdMicros,
  };
}

export async function exchangeApiKeyForSigner(
  options: ExchangeApiKeyForSignerOptions,
): Promise<DeviceExchangeResponse> {
  const fetchImpl = options.fetch ?? fetch;
  const url = `${stripTrailingSlashes(options.facadeUrl)}/api/pymthouse/keys/exchange`;
  const body: Record<string, string> = { apiKey: options.apiKey };
  if (options.scope?.trim()) {
    body.scope = options.scope.trim();
  }
  if (options.clientId?.trim()) {
    body.clientId = options.clientId.trim();
  }

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const parsed = await readJsonObjectFromResponse(response, {
    invalidJsonMessage: "API key exchange returned invalid JSON",
    invalidJsonCode: EXCHANGE_RESPONSE_ERROR,
    failureLabel: "API key exchange failed",
    defaultErrorCode: "api_key_exchange_failed",
  });

  return deviceExchangeResponseFromSignerSessionBody(parsed);
}

export function createApiKeyExchangeHandler(
  config: ApiKeyExchangeHandlerConfig,
): (request: Request) => Promise<Response> {
  const publicClientId = config.publicClientId.trim();

  return async function apiKeyExchangeHandler(request: Request): Promise<Response> {
    try {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "method_not_allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json" },
        });
      }

      const parsed = await parseApiKeyExchangeRequestBody(request);
      const effectiveClientId = parsed.clientId?.trim() || publicClientId;
      if (effectiveClientId !== publicClientId) {
        throw new PmtHouseError("clientId does not match configured public client", {
          status: 400,
          code: "invalid_request",
        });
      }

      const direct = await mintSignerSessionFromApiKeyDirect({
        issuerUrl: config.issuerUrl,
        publicClientId,
        apiKey: parsed.apiKey,
        scope: parsed.scope,
        m2mClientId: config.m2mClientId,
        m2mClientSecret: config.m2mClientSecret,
        fetch: config.fetch,
      });

      const signerUrlValue =
        direct.signer_url ??
        (typeof config.signerUrl === "string" && config.signerUrl.trim()
          ? config.signerUrl.trim()
          : undefined);

      const body = normalizeDeviceExchangeResponse(
        {
          access_token: direct.access_token,
          expires_in: direct.expires_in,
          scope: direct.scope,
          balanceUsdMicros: direct.balanceUsdMicros,
          lifetimeGrantedUsdMicros: direct.lifetimeGrantedUsdMicros,
        },
        { signer_url: signerUrlValue },
      );
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      });
    } catch (error) {
      return signerHandlerErrorResponse(error);
    }
  };
}
