/** Removes trailing `/` without regex (linear time). */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) {
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
    const a = value.charCodeAt(start + i);
    const b = suffix.charCodeAt(i);
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
