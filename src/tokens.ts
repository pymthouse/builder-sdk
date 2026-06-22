import type { TokenExchangeResponse } from "./types.js";

/**
 * Matches PymtHouse `gateway-token-exchange.ts` opaque signer session TTL (~90 days).
 *
 * Any change here must stay in sync with the upstream PymtHouse value.
 */
export const SIGNER_SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export const SIGNER_SESSION_EXPIRES_IN_SEC = Math.floor(SIGNER_SESSION_TTL_MS / 1000);

/** Default end-user scope for Builder-minted user tokens and signer sessions. */
export const SIGN_JOB_SCOPE = "sign:job";

/** @deprecated Use {@link SIGNER_SESSION_TTL_MS}. */
export const PYMTHOUSE_SIGNER_SESSION_TTL_MS = SIGNER_SESSION_TTL_MS;

export interface SignerSessionToken {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  scope: string;
}

/**
 * Compute the implied expiry for an opaque signer session key whose creation
 * timestamp is known but whose token body carries no expiry of its own.
 */
export function computeSignerSessionExpiry(input: Date | string): Date {
  const createdAt = input instanceof Date ? input : new Date(input);
  return new Date(createdAt.getTime() + SIGNER_SESSION_TTL_MS);
}

/** @deprecated Use {@link computeSignerSessionExpiry}. */
export const computePymthouseExpiry = computeSignerSessionExpiry;

/**
 * Cheap shape check — true for inputs that look like a 3-segment JWT.
 * Does NOT validate the signature; callers must not use this for trust.
 */
export function isLikelyOidcJwt(rawToken: string): boolean {
  const t = rawToken.trim();
  return t.startsWith("eyJ") && t.split(".").length >= 3;
}

/** True when the token is an opaque signer session (not a JWT). */
export function isOpaqueSignerSessionToken(rawToken: string): boolean {
  const t = rawToken.trim();
  return t.length > 0 && !isLikelyOidcJwt(t);
}

function base64UrlPayloadToUtf8(payloadB64: string): string {
  const normalized = payloadB64.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  if (typeof Buffer !== "undefined") {
    return Buffer.from(padded, "base64").toString("utf8");
  }
  return atob(padded);
}

/**
 * Best-effort `exp` extraction from a JWT payload. Returns null on any
 * parse error, missing/invalid `exp`, or non-finite numeric value.
 *
 * Security note: the JWT is not verified. Use only for UX-level expiry
 * display or soft-cleanup of unusable keys, never for authorization.
 */
export function decodeJwtExp(rawToken: string): Date | null {
  try {
    const parts = rawToken.split(".");
    if (parts.length < 2) return null;
    const payloadJson = base64UrlPayloadToUtf8(parts[1]);
    const payload = JSON.parse(payloadJson) as { exp?: number };
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;
    const expMs = Math.floor(payload.exp * 1000);
    if (expMs <= 0) return null;
    return new Date(expMs);
  } catch {
    return null;
  }
}

/**
 * Normalize an RFC 8693 token exchange response into a signer session token.
 *
 * Validates only what the documented gateway/opaque contract guarantees: a
 * non-empty, opaque (non-JWT) access token. A missing or empty
 * `issued_token_type` is tolerated — the documented gateway exchange may omit
 * it — so this function never hard-requires that field.
 */
export function parseSignerSessionExchange(res: TokenExchangeResponse): SignerSessionToken {
  const accessToken = typeof res.access_token === "string" ? res.access_token.trim() : "";
  if (!accessToken) {
    throw new Error("PymtHouse signer session exchange returned no access_token");
  }
  if (isLikelyOidcJwt(accessToken)) {
    throw new Error(
      "PymtHouse signer session exchange returned a JWT; expected opaque signer session token",
    );
  }

  const tokenType =
    typeof res.token_type === "string" && res.token_type.trim()
      ? res.token_type.trim()
      : "Bearer";
  const expiresIn =
    typeof res.expires_in === "number" &&
    Number.isFinite(res.expires_in) &&
    res.expires_in > 0
      ? Math.floor(res.expires_in)
      : SIGNER_SESSION_EXPIRES_IN_SEC;
  const scope =
    typeof res.scope === "string" && res.scope.trim() ? res.scope.trim() : SIGN_JOB_SCOPE;

  return {
    accessToken,
    tokenType,
    expiresIn,
    scope,
  };
}
