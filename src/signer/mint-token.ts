import { loadAuthorizationServer } from "../discovery.js";
import { encodeClientSecretBasic } from "../encoding.js";
import { PmtHouseError } from "../errors.js";
import { stripTrailingSlashes } from "../string-utils.js";
import type { FetchLike } from "../types.js";
import type { CachedSignerToken, MintUserSignerTokenOptions, MintUserSignerTokenResponse } from "./types.js";

export const SIGN_MINT_USER_TOKEN_SCOPE = "sign:mint_user_token";
export const LIVEPEER_REMOTE_SIGNER_AUDIENCE = "livepeer-remote-signer";

const DEFAULT_TTL_REFRESH_RATIO = 0.8;

function readStringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new PmtHouseError(`Token response missing ${key}`, {
      status: 502,
      code: "invalid_token_response",
    });
  }
  return value.trim();
}

function readExpiresIn(body: Record<string, unknown>): number {
  const expiresIn = body.expires_in;
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new PmtHouseError("Token response missing expires_in", {
      status: 502,
      code: "invalid_token_response",
    });
  }
  return Math.floor(expiresIn);
}

export function parseMintUserSignerTokenResponse(
  body: Record<string, unknown>,
  ttlRefreshRatio = DEFAULT_TTL_REFRESH_RATIO,
): CachedSignerToken {
  const accessToken = readStringField(body, "access_token");
  const expiresIn = readExpiresIn(body);
  const balanceUsdMicros = readStringField(body, "balanceUsdMicros");
  const lifetimeGrantedUsdMicros = readStringField(body, "lifetimeGrantedUsdMicros");
  const now = Date.now();
  const expiresAt = now + expiresIn * 1000;
  const refreshAt = now + Math.floor(expiresIn * 1000 * ttlRefreshRatio);

  return {
    jwt: accessToken,
    expiresAt,
    refreshAt,
    balanceUsdMicros,
    lifetimeGrantedUsdMicros,
  };
}

export async function mintUserSignerToken(
  options: MintUserSignerTokenOptions,
): Promise<CachedSignerToken> {
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

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: SIGN_MINT_USER_TOKEN_SCOPE,
    external_user_id: options.externalUserId,
    audience: LIVEPEER_REMOTE_SIGNER_AUDIENCE,
  });

  const response = await fetchImpl(tokenEndpoint, {
    method: "POST",
    headers: {
      Authorization: encodeClientSecretBasic(options.m2mClientId, options.m2mClientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
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
          : `Token mint failed (${response.status})`;
    throw new PmtHouseError(description, {
      status: response.status,
      code: typeof parsed.error === "string" ? parsed.error : "token_mint_failed",
      details: parsed,
    });
  }

  return parseMintUserSignerTokenResponse(parsed);
}

export function toMintUserSignerTokenResponse(token: CachedSignerToken): MintUserSignerTokenResponse {
  const expiresIn = Math.max(1, Math.floor((token.expiresAt - Date.now()) / 1000));
  return {
    access_token: token.jwt,
    expires_in: expiresIn,
    balanceUsdMicros: token.balanceUsdMicros,
    lifetimeGrantedUsdMicros: token.lifetimeGrantedUsdMicros,
  };
}
