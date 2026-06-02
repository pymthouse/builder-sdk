/** Removes trailing `/` without regex (linear time). */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && (value.codePointAt(end - 1) ?? 0) === 47) {
    end--;
  }
  return value.slice(0, end);
}

function endsWithIgnoreCase(value: string, suffix: string): boolean {
  if (suffix.length > value.length) {
    return false;
  }
  const start = value.length - suffix.length;
  for (let i = 0; i < suffix.length; i++) {
    const a = value.codePointAt(start + i) ?? 0;
    const b = suffix.codePointAt(i) ?? 0;
    if (a !== b && (a | 32) !== (b | 32)) {
      return false;
    }
  }
  return true;
}

function stripSuffixIgnoreCase(value: string, suffix: string): string {
  return endsWithIgnoreCase(value, suffix)
    ? value.slice(0, value.length - suffix.length)
    : value;
}

/** Issuer URL (`…/oidc`) → Builder API base (`…/api/v1`). Linear-time; no regex. */
export function stripOidcPathSuffix(issuerUrl: string): string {
  let base = stripTrailingSlashes(issuerUrl.trim());
  base = stripSuffixIgnoreCase(base, "/oidc");
  return stripTrailingSlashes(base);
}

/** Issuer URL (`…/api/v1/oidc`) → host origin for signer/API-key routes. Linear-time; no regex. */
export function stripIssuerOriginFromOidcUrl(issuerUrl: string): string {
  let base = stripTrailingSlashes(issuerUrl.trim());
  base = stripSuffixIgnoreCase(base, "/api/v1/oidc");
  base = stripSuffixIgnoreCase(base, "/oidc");
  return stripTrailingSlashes(base);
}

/** Validate gateway session ids before embedding in request URLs. */
export function isSafePathSegment(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    return false;
  }
  for (let i = 0; i < value.length; i++) {
    const c = value.codePointAt(i) ?? 0;
    const ok =
      (c >= 48 && c <= 57) ||
      (c >= 65 && c <= 90) ||
      (c >= 97 && c <= 122) ||
      c === 95 ||
      c === 45;
    if (!ok) {
      return false;
    }
  }
  return true;
}

/** Parse and validate an http(s) facade origin (no path). */
export function parseHttpOrigin(raw: string | undefined, fallback: string): string {
  const trimmed = (raw ?? fallback).trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new TypeError("Origin must be a valid http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TypeError("Origin must use http or https");
  }
  return parsed.origin;
}

/** Build a validated DELETE URL for `/api/gateway/sessions/:id`. */
export function buildGatewaySessionDeleteUrl(origin: string, sessionId: string): URL {
  if (!isSafePathSegment(sessionId)) {
    throw new TypeError("Invalid gateway session id");
  }
  return new URL(`/api/gateway/sessions/${encodeURIComponent(sessionId)}`, origin);
}
