import { loadAuthorizationServer } from "../discovery.js";
import { encodeClientSecretBasic } from "../encoding.js";
import { PmtHouseError } from "../errors.js";
import { stripTrailingSlashes } from "../string-utils.js";
import { readJsonObjectFromResponse } from "./fetch-json.js";
import { readExpiresIn, readStringField } from "./json-fields.js";
import type { CachedSignerToken, MintUserSignerTokenOptions, MintUserSignerTokenResponse } from "./types.js";

export const SIGN_MINT_USER_TOKEN_SCOPE = "sign:mint_user_token";
export const LIVEPEER_REMOTE_SIGNER_AUDIENCE = "livepeer-remote-signer";

const DEFAULT_TTL_REFRESH_RATIO = 0.8;
const TOKEN_RESPONSE_ERROR = "invalid_token_response";

export function parseMintUserSignerTokenResponse(
  body: Record<string, unknown>,
  ttlRefreshRatio = DEFAULT_TTL_REFRESH_RATIO,
): CachedSignerToken {
  const accessToken = readStringField(body, "access_token", TOKEN_RESPONSE_ERROR, "Token response");
  const expiresIn = readExpiresIn(body, TOKEN_RESPONSE_ERROR);
  const balanceUsdMicros = readStringField(
    body,
    "balanceUsdMicros",
    TOKEN_RESPONSE_ERROR,
    "Token response",
  );
  const lifetimeGrantedUsdMicros = readStringField(
    body,
    "lifetimeGrantedUsdMicros",
    TOKEN_RESPONSE_ERROR,
    "Token response",
  );
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

  const parsed = await readJsonObjectFromResponse(response, {
    invalidJsonMessage: "Token endpoint returned invalid JSON",
    invalidJsonCode: TOKEN_RESPONSE_ERROR,
    failureLabel: "Token mint failed",
    defaultErrorCode: "token_mint_failed",
  });

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
