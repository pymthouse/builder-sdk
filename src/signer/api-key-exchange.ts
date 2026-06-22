import { stripIssuerOriginFromOidcUrl, stripTrailingSlashes } from "../string-utils.js";
import { PmtHouseError } from "../errors.js";
import { readJsonObjectFromResponse } from "./fetch-json.js";
import { signerHandlerErrorResponse } from "./handler-errors.js";
import {
  extractSignerAccessTokenFromExchangeBody,
  mintSignerTokenFromDeviceToken,
  normalizeDeviceExchangeResponse,
} from "./device-exchange.js";
import { assertDirectSignerBaseUrl } from "./direct-signer.js";
import type {
  ApiKeyExchangeHandlerConfig,
  ApiKeyExchangeMintResult,
  ApiKeyExchangeRequestBody,
  DeviceExchangeResponse,
  ExchangeApiKeyForSignerOptions,
} from "./types.js";

const EXCHANGE_RESPONSE_ERROR = "invalid_exchange_response";

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
  const scope =
    typeof record.scope === "string" && record.scope.trim()
      ? record.scope.trim()
      : undefined;
  const clientId =
    typeof record.clientId === "string" && record.clientId.trim()
      ? record.clientId.trim()
      : undefined;
  return { apiKey: apiKeyRaw.trim(), scope, clientId };
}

export async function mintUserAccessTokenFromApiKey(input: {
  issuerUrl: string;
  publicClientId: string;
  apiKey: string;
  scope?: string;
  fetch?: typeof fetch;
}): Promise<{ access_token: string; expires_in: number; scope: string }> {
  const fetchImpl = input.fetch ?? fetch;
  const issuerOrigin = stripIssuerOriginFromOidcUrl(input.issuerUrl);
  const url = `${issuerOrigin}/api/v1/apps/${encodeURIComponent(input.publicClientId)}/auth/api-key/token`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(input.scope ? { scope: input.scope } : {}),
    cache: "no-store",
  });

  const parsed = await readJsonObjectFromResponse(response, {
    invalidJsonMessage: "API key token exchange returned invalid JSON",
    invalidJsonCode: "invalid_token_response",
    failureLabel: "API key token exchange failed",
    defaultErrorCode: "api_key_token_exchange_failed",
  });

  const accessToken = parsed.access_token;
  if (typeof accessToken !== "string" || !accessToken.trim()) {
    throw new PmtHouseError("API key token exchange missing access_token", {
      status: 502,
      code: EXCHANGE_RESPONSE_ERROR,
    });
  }

  const expiresIn =
    typeof parsed.expires_in === "number" && Number.isFinite(parsed.expires_in)
      ? parsed.expires_in
      : 900;
  const scope =
    typeof parsed.scope === "string" && parsed.scope.trim()
      ? parsed.scope.trim()
      : input.scope?.trim() || "sign:job";

  return {
    access_token: accessToken.trim(),
    expires_in: expiresIn,
    scope,
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
  const userToken = await mintUserAccessTokenFromApiKey({
    issuerUrl: input.issuerUrl,
    publicClientId: input.publicClientId,
    apiKey: input.apiKey,
    scope: input.scope,
    fetch: input.fetch,
  });

  return mintSignerTokenFromDeviceToken({
    issuerUrl: input.issuerUrl,
    m2mClientId: input.m2mClientId,
    m2mClientSecret: input.m2mClientSecret,
    deviceToken: userToken.access_token,
    scope: userToken.scope,
    audience: input.audience,
    fetch: input.fetch,
    allowInsecureHttp: input.allowInsecureHttp,
  });
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

  const accessToken = extractSignerAccessTokenFromExchangeBody(parsed);
  const signerUrlRaw = parsed.signerUrl ?? parsed.signer_url;
  const signerUrl =
    typeof signerUrlRaw === "string" && signerUrlRaw.trim() ? signerUrlRaw.trim() : undefined;
  if (signerUrl) {
    assertDirectSignerBaseUrl(signerUrl);
  }

  return normalizeDeviceExchangeResponse(
    {
      access_token: accessToken,
      expires_in:
        typeof parsed.expires_in === "number" && Number.isFinite(parsed.expires_in)
          ? parsed.expires_in
          : 3600,
      scope:
        typeof parsed.scope === "string" && parsed.scope.trim()
          ? parsed.scope.trim()
          : "sign:job",
      balanceUsdMicros:
        typeof parsed.balanceUsdMicros === "string" ? parsed.balanceUsdMicros : "0",
      lifetimeGrantedUsdMicros:
        typeof parsed.lifetimeGrantedUsdMicros === "string"
          ? parsed.lifetimeGrantedUsdMicros
          : "0",
    },
    { signerUrl },
  );
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

      const minted = await mintSignerSessionFromApiKey({
        issuerUrl: config.issuerUrl,
        publicClientId,
        m2mClientId: config.m2mClientId,
        m2mClientSecret: config.m2mClientSecret,
        apiKey: parsed.apiKey,
        scope: parsed.scope,
        audience: config.audience,
        fetch: config.fetch,
        allowInsecureHttp: config.allowInsecureHttp,
      });

      const signerUrlValue =
        typeof config.signerUrl === "string" && config.signerUrl.trim()
          ? config.signerUrl.trim()
          : undefined;

      const body = normalizeDeviceExchangeResponse(minted, { signerUrl: signerUrlValue });
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
