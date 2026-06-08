export function bearerTokenFromAuthorization(authorization: string): string {
  const trimmed = authorization.trim();
  if (!trimmed) {
    throw new Error("missing authorization");
  }
  const prefix = "Bearer ";
  if (!trimmed.startsWith(prefix)) {
    throw new Error("authorization must be Bearer token");
  }
  const token = trimmed.slice(prefix.length).trim();
  if (!token) {
    throw new Error("empty bearer token");
  }
  return token;
}
