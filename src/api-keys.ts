/**
 * Presented composite API keys: `app_<24hex>_<secret>` (underscore separator).
 * Matches PymtHouse `app-api-keys.ts` and clearinghouse-identity-webhook.
 */

/** Underscore composite: `app_<24hex>_<opaqueSecret>` (no `.` — better copy/select UX). */
export const COMPOSITE_API_KEY_RE = /^(app_[a-f0-9]{24})_(.+)$/;

/** Reject client-secret shaped secret segments. */
const CLIENT_SECRET_SEGMENT_RE = /(?:^|_)cs_/;

/**
 * Split a composite credential `app_<24hex>_<secret>` into parts.
 * Returns null for bare API keys, JWTs, or malformed forms.
 */
export function splitCompositeApiKey(
  token: string,
): { publicClientId: string; apiKey: string } | null {
  const trimmed = token.trim();
  const match = COMPOSITE_API_KEY_RE.exec(trimmed);
  if (!match) {
    return null;
  }
  const publicClientId = match[1]!;
  const apiKey = match[2]!;
  if (!apiKey || CLIENT_SECRET_SEGMENT_RE.test(apiKey)) {
    return null;
  }
  return { publicClientId, apiKey };
}

/** True when `token` is a presented composite `app_<24hex>_<secret>`. */
export function isCompositeApiKey(token: string): boolean {
  return splitCompositeApiKey(token) !== null;
}

/**
 * Format the one-time presented API key as `app_<24hex>_<bareApiKey>`.
 * The bare key is kept as-is (including any operator storage prefix).
 */
export function formatCompositeApiKey(
  publicClientId: string,
  bareApiKey: string,
): string {
  return `${publicClientId.trim()}_${bareApiKey.trim()}`;
}
