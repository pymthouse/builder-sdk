import { loadAuthorizationServer } from "../discovery.js";
import { encodeClientSecretBasic } from "../encoding.js";
import { PmtHouseError } from "../errors.js";
import { stripTrailingSlashes } from "../string-utils.js";
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

function readStringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new PmtHouseError(`Response missing ${key}`, {
      status: 502,
      code: "invalid_exchange_response",
    });
  }
  return value.trim();
}

function readExpiresIn(body: Record<string, unknown>): number {
  const expiresIn = body.expires_in;
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new PmtHouseError("Response missing expires_in", {
      status: 502,
      code: "invalid_exchange_response",
    });
  }
  return Math.floor(expiresIn);
}

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
  const deviceToken = readStringField(record, "deviceToken");
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

  const text = await response.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new PmtHouseError("Token endpoint returned invalid JSON", {
      status: 502,
      code: "invalid_token_response",
      details: { status: response.status },
    });
  }

  if (!response.ok) {
    const description =
      typeof parsed.error_description === "string"
        ? parsed.error_description
        : typeof parsed.error === "string"
          ? parsed.error
          : `Signer JWT exchange failed (${response.status})`;
    throw new PmtHouseError(description, {
      status: response.status,
      code: typeof parsed.error === "string" ? parsed.error : "token_exchange_failed",
      details: parsed,
    });
  }

  const cached = parseMintUserSignerTokenResponse(parsed);
  return {
    access_token: cached.jwt,
    expires_in: readExpiresIn(parsed),
    scope: readStringField(parsed, "scope"),
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

  const text = await response.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new PmtHouseError("Device exchange returned invalid JSON", {
      status: 502,
      code: "invalid_exchange_response",
      details: { status: response.status },
    });
  }

  if (!response.ok) {
    const description =
      typeof parsed.error_description === "string"
        ? parsed.error_description
        : typeof parsed.error === "string"
          ? parsed.error
          : `Device exchange failed (${response.status})`;
    throw new PmtHouseError(description, {
      status: response.status,
      code: typeof parsed.error === "string" ? parsed.error : "device_exchange_failed",
      details: parsed,
    });
  }

  const accessToken = extractSignerAccessTokenFromExchangeBody(parsed);
  const signerUrlRaw = parsed.signerUrl ?? parsed.signer_url;
  const signerUrl =
    typeof signerUrlRaw === "string" && signerUrlRaw.trim() ? signerUrlRaw.trim() : undefined;
  return normalizeDeviceExchangeResponse(
    {
      access_token: accessToken,
      expires_in: readExpiresIn(parsed),
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

function errorResponse(error: unknown): Response {
  if (error instanceof PmtHouseError) {
    return new Response(
      JSON.stringify({
        error: error.code,
        error_description: error.message,
        details: error.details,
      }),
      {
        status: error.status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  const message = error instanceof Error ? error.message : "Internal error";
  return new Response(JSON.stringify({ error: "internal_error", error_description: message }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
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
      return errorResponse(error);
    }
  };
}
