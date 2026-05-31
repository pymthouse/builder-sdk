import { loadAuthorizationServer } from "../discovery.js";
import { encodeClientSecretBasic } from "../encoding.js";
import { PmtHouseError } from "../errors.js";
import { stripTrailingSlashes } from "../string-utils.js";
import { readJsonObjectFromResponse } from "./fetch-json.js";
import { readExpiresIn, readStringField } from "./json-fields.js";
import { signerHandlerErrorResponse } from "./handler-errors.js";
import {
  LIVEPEER_REMOTE_SIGNER_AUDIENCE,
  parseMintUserSignerTokenResponse,
} from "./mint-token.js";
import type {
  DeviceExchangeHandlerConfig,
  DeviceExchangeHandlerConfigRemote,
  DeviceExchangeMintContext,
  DeviceExchangeMintResult,
  DeviceExchangeRequestBody,
  DeviceExchangeResponse,
  ExchangeDeviceTokenForSignerOptions,
  MintSignerTokenFromDeviceTokenOptions,
} from "./types.js";

const TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange";
const SUBJECT_ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";
const EXCHANGE_RESPONSE_ERROR = "invalid_exchange_response";

export function extractSignerAccessTokenFromExchangeBody(
  body: Record<string, unknown>,
): string {
  const tokenObj = body.token;
  if (tokenObj !== null && typeof tokenObj === "object" && !Array.isArray(tokenObj)) {
    const nested = tokenObj as Record<string, unknown>;
    for (const key of ["accessToken", "access_token"] as const) {
      const value = nested[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  }
  for (const key of ["accessToken", "access_token"] as const) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  throw new PmtHouseError("Device exchange response missing signer access token", {
    status: 502,
    code: "invalid_exchange_response",
  });
}

export function normalizeDeviceExchangeResponse(
  minted: DeviceExchangeMintResult,
  options?: { signerUrl?: string },
): DeviceExchangeResponse {
  const scope = minted.scope.trim() || "sign:job";
  const body: DeviceExchangeResponse = {
    access_token: minted.access_token,
    token_type: "Bearer",
    expires_in: minted.expires_in,
    scope,
    balanceUsdMicros: minted.balanceUsdMicros,
    lifetimeGrantedUsdMicros: minted.lifetimeGrantedUsdMicros,
    token: {
      accessToken: minted.access_token,
      access_token: minted.access_token,
      expiresIn: minted.expires_in,
      expires_in: minted.expires_in,
      scope,
      balanceUsdMicros: minted.balanceUsdMicros,
      lifetimeGrantedUsdMicros: minted.lifetimeGrantedUsdMicros,
    },
  };
  const signerUrl = options?.signerUrl?.trim();
  if (signerUrl) {
    body.signerUrl = signerUrl;
  }
  return body;
}

export async function parseDeviceExchangeRequestBody(
  request: Request,
): Promise<DeviceExchangeRequestBody> {
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
  const deviceTokenRaw = record.deviceToken;
  if (typeof deviceTokenRaw !== "string" || !deviceTokenRaw.trim()) {
    throw new PmtHouseError("Request body must include deviceToken", {
      status: 400,
      code: "invalid_request",
    });
  }
  const deviceToken = deviceTokenRaw.trim();
  const scope =
    typeof record.scope === "string" && record.scope.trim()
      ? record.scope.trim()
      : undefined;
  const clientId =
    typeof record.clientId === "string" && record.clientId.trim()
      ? record.clientId.trim()
      : undefined;
  return { deviceToken, scope, clientId };
}

export async function mintSignerTokenFromDeviceToken(
  options: MintSignerTokenFromDeviceTokenOptions,
): Promise<DeviceExchangeMintResult> {
  const fetchImpl = options.fetch ?? fetch;
  const issuerUrl = stripTrailingSlashes(options.issuerUrl);
  const as = await loadAuthorizationServer(issuerUrl, fetchImpl, {
    allowInsecureHttp: options.allowInsecureHttp,
  });
  const tokenEndpoint = as.token_endpoint;
  if (!tokenEndpoint) {
    throw new PmtHouseError("OIDC discovery document is missing token_endpoint", {
      status: 500,
      code: "oidc_discovery_invalid",
    });
  }

  const audience = options.audience?.trim() || LIVEPEER_REMOTE_SIGNER_AUDIENCE;
  const params = new URLSearchParams({
    grant_type: TOKEN_EXCHANGE_GRANT,
    subject_token: options.deviceToken,
    subject_token_type: SUBJECT_ACCESS_TOKEN_TYPE,
    audience,
    resource: audience,
  });
  if (options.scope?.trim()) {
    params.set("scope", options.scope.trim());
  }

  const response = await fetchImpl(tokenEndpoint, {
    method: "POST",
    headers: {
      Authorization: encodeClientSecretBasic(options.m2mClientId, options.m2mClientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: params.toString(),
    cache: "no-store",
  });

  const parsed = await readJsonObjectFromResponse(response, {
    invalidJsonMessage: "Token endpoint returned invalid JSON",
    invalidJsonCode: "invalid_token_response",
    failureLabel: "Signer JWT exchange failed",
    defaultErrorCode: "token_exchange_failed",
  });

  const cached = parseMintUserSignerTokenResponse(parsed);
  return {
    access_token: cached.jwt,
    expires_in: readExpiresIn(parsed, EXCHANGE_RESPONSE_ERROR),
    scope: readStringField(parsed, "scope", EXCHANGE_RESPONSE_ERROR),
    balanceUsdMicros: cached.balanceUsdMicros,
    lifetimeGrantedUsdMicros: cached.lifetimeGrantedUsdMicros,
  };
}

export async function exchangeDeviceTokenForSigner(
  options: ExchangeDeviceTokenForSignerOptions,
): Promise<DeviceExchangeResponse> {
  const fetchImpl = options.fetch ?? fetch;
  const url = `${stripTrailingSlashes(options.facadeUrl)}/api/signer/device/exchange`;
  const body: Record<string, string> = { deviceToken: options.deviceToken };
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
    invalidJsonMessage: "Device exchange returned invalid JSON",
    invalidJsonCode: EXCHANGE_RESPONSE_ERROR,
    failureLabel: "Device exchange failed",
    defaultErrorCode: "device_exchange_failed",
  });

  const accessToken = extractSignerAccessTokenFromExchangeBody(parsed);
  const signerUrlRaw = parsed.signerUrl ?? parsed.signer_url;
  const signerUrl =
    typeof signerUrlRaw === "string" && signerUrlRaw.trim() ? signerUrlRaw.trim() : undefined;
  return normalizeDeviceExchangeResponse(
    {
      access_token: accessToken,
      expires_in: readExpiresIn(parsed, EXCHANGE_RESPONSE_ERROR),
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

type CreateDeviceExchangeHandlerInput =
  | DeviceExchangeHandlerConfig
  | DeviceExchangeHandlerConfigRemote;

function resolveMint(
  config: CreateDeviceExchangeHandlerInput,
): (deviceToken: string, context: DeviceExchangeMintContext) => Promise<DeviceExchangeMintResult> {
  if ("mint" in config && typeof config.mint === "function") {
    return config.mint;
  }
  const remote = config as DeviceExchangeHandlerConfigRemote;
  return (deviceToken, context) =>
    mintSignerTokenFromDeviceToken({
      issuerUrl: remote.issuerUrl,
      m2mClientId: remote.m2mClientId,
      m2mClientSecret: remote.m2mClientSecret,
      deviceToken,
      scope: context.scope,
      audience: remote.audience,
      fetch: remote.fetch,
      allowInsecureHttp: remote.allowInsecureHttp,
    });
}

function resolveSignerUrlFromConfig(
  config: CreateDeviceExchangeHandlerInput,
): string | Promise<string | undefined> | undefined {
  if ("signerUrl" in config && typeof config.signerUrl === "string" && config.signerUrl.trim()) {
    return config.signerUrl.trim();
  }
  if ("getSignerUrl" in config && typeof config.getSignerUrl === "function") {
    return config.getSignerUrl();
  }
  return undefined;
}

export function createDeviceExchangeHandler(
  config: CreateDeviceExchangeHandlerInput,
): (request: Request) => Promise<Response> {
  const mint = resolveMint(config);

  return async function deviceExchangeHandler(request: Request): Promise<Response> {
    try {
      if (request.method !== "POST") {
        return new Response(JSON.stringify({ error: "method_not_allowed" }), {
          status: 405,
          headers: { "Content-Type": "application/json" },
        });
      }

      const parsed = await parseDeviceExchangeRequestBody(request);
      const minted = await mint(parsed.deviceToken, {
        scope: parsed.scope,
        clientId: parsed.clientId,
      });
      const signerUrlValue = await resolveSignerUrlFromConfig(config);
      const body = normalizeDeviceExchangeResponse(minted, {
        signerUrl: typeof signerUrlValue === "string" ? signerUrlValue : undefined,
      });
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
