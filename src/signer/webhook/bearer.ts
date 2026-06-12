const BEARER_PREFIX = "Bearer ";

/** Returns the token after `Bearer `, or null when the header is missing or not Bearer. */
export function optionalBearerToken(authorization: string): string | null {
  const trimmed = authorization.trim();
  if (!trimmed.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = trimmed.slice(BEARER_PREFIX.length).trim();
  return token || null;
}

export function bearerTokenFromAuthorization(authorization: string): string {
  const token = optionalBearerToken(authorization);
  if (token) {
    return token;
  }
  if (!authorization.trim()) {
    throw new Error("missing authorization");
  }
  throw new Error("authorization must be Bearer token");
}
