import {
  allowInsecureRequests,
  customFetch,
  validateJwtAccessToken,
  type JWTAccessTokenClaims,
} from "oauth4webapi";
import * as jose from "jose";
import { loadAuthorizationServer } from "./discovery.js";
import { PmtHouseError } from "./errors.js";
import { mapOAuthError } from "./oauth-map.js";
import type { FetchLike } from "./types.js";

/** RFC 9068 (`at+jwt`) vs classic OIDC provider JWT (`JWT` header, e.g. Keycloak). */
export type AccessTokenProfile = "rfc9068" | "oauth2-provider-jwt";

export interface VerifyJwtOptions {
  issuerUrl: string;
  /** Expected JWT `aud` (resource identifier). */
  audience: string;
  fetch?: FetchLike;
  allowInsecureHttp?: boolean;
  /** If set, every scope here must appear in the token's `scope` claim (space-separated). */
  requiredScopes?: string[];
  /**
   * `rfc9068` (default): oauth4webapi `validateJwtAccessToken` (`typ` must be `at+jwt`).
   * `oauth2-provider-jwt`: JWKS verify via jose (Keycloak and similar issuers).
   */
  accessTokenProfile?: AccessTokenProfile;
}

function assertRequiredScopes(
  claims: JWTAccessTokenClaims,
  requiredScopes: string[] | undefined,
): void {
  if (!requiredScopes?.length) return;

  const scopeStr = typeof claims.scope === "string" ? claims.scope : "";
  const have = new Set(scopeStr.split(/\s+/).filter(Boolean));
  for (const scope of requiredScopes) {
    if (!have.has(scope)) {
      throw new PmtHouseError(`Missing required scope: ${scope}`, {
        status: 403,
        code: "insufficient_scope",
      });
    }
  }
}

async function verifyOauth2ProviderJwtAccessToken(
  token: string,
  options: VerifyJwtOptions,
): Promise<JWTAccessTokenClaims> {
  const fetchImpl = options.fetch ?? fetch;
  const as = await loadAuthorizationServer(options.issuerUrl, fetchImpl, {
    allowInsecureHttp: options.allowInsecureHttp,
  });

  if (!as.jwks_uri) {
    throw new PmtHouseError("Issuer metadata missing jwks_uri", {
      status: 502,
      code: "oidc_discovery_invalid",
    });
  }

  const jwksResponse = await fetchImpl(as.jwks_uri);
  if (!jwksResponse.ok) {
    throw new PmtHouseError(`Failed to load JWKS: HTTP ${jwksResponse.status}`, {
      status: 502,
      code: "jwks_load_failed",
    });
  }

  const jwks = await jwksResponse.json();
  const keySet = jose.createLocalJWKSet(jwks);
  const expectedIssuer = as.issuer ?? options.issuerUrl;

  try {
    const { payload } = await jose.jwtVerify(token, keySet, {
      issuer: expectedIssuer,
      audience: options.audience,
      clockTolerance: 60,
    });
    const claims = payload as JWTAccessTokenClaims;
    assertRequiredScopes(claims, options.requiredScopes);
    return claims;
  } catch (error) {
    if (error instanceof jose.errors.JOSEError) {
      throw new PmtHouseError(error.message, {
        status: 401,
        code: "invalid_token",
      });
    }
    throw error;
  }
}

/**
 * RFC 9068 / RFC 6750: validate a JWT access token using issuer JWKS via oauth4webapi.
 */
export async function verifyJwt(
  token: string,
  options: VerifyJwtOptions,
): Promise<JWTAccessTokenClaims> {
  if (options.accessTokenProfile === "oauth2-provider-jwt") {
    return verifyOauth2ProviderJwtAccessToken(token, options);
  }

  const fetchImpl = options.fetch ?? fetch;
  const as = await loadAuthorizationServer(options.issuerUrl, fetchImpl, {
    allowInsecureHttp: options.allowInsecureHttp,
  });

  const request = new Request("https://resource.invalid/", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const httpOpts: Record<symbol, unknown> = {
    [customFetch]: fetchImpl,
  };
  if (options.allowInsecureHttp) {
    httpOpts[allowInsecureRequests] = true;
  }

  try {
    const claims = await validateJwtAccessToken(
      as,
      request,
      options.audience,
      httpOpts as import("oauth4webapi").ValidateJWTAccessTokenOptions,
    );

    assertRequiredScopes(claims, options.requiredScopes);

    return claims;
  } catch (e) {
    throw mapOAuthError(e);
  }
}
