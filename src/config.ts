import { stripTrailingSlashes } from "./string-utils.js";

/** Operator hint when Builder / Usage cannot run. */
export const PYMTHOUSE_NOT_CONFIGURED_MESSAGE =
  "PymtHouse is not configured. Set PYMTHOUSE_ISSUER_URL, PYMTHOUSE_PUBLIC_CLIENT_ID, PYMTHOUSE_M2M_CLIENT_ID, and PYMTHOUSE_M2M_CLIENT_SECRET, then restart.";

export interface PymthouseEnvConfig {
  issuerUrl: string;
  publicClientId: string;
  m2mClientId: string;
  m2mClientSecret: string;
}

function trimEnv(name: string): string | null {
  const value = process.env[name];
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** Read `PYMTHOUSE_*` env vars without throwing. Returns null when incomplete. */
export function readPymthouseEnv(): PymthouseEnvConfig | null {
  const issuerUrl = trimEnv("PYMTHOUSE_ISSUER_URL");
  const publicClientId = trimEnv("PYMTHOUSE_PUBLIC_CLIENT_ID");
  const m2mClientId = trimEnv("PYMTHOUSE_M2M_CLIENT_ID");
  const m2mClientSecret = trimEnv("PYMTHOUSE_M2M_CLIENT_SECRET");
  if (!issuerUrl || !publicClientId || !m2mClientId || !m2mClientSecret) {
    return null;
  }
  return {
    issuerUrl: stripTrailingSlashes(issuerUrl),
    publicClientId,
    m2mClientId,
    m2mClientSecret,
  };
}

/** Read `PYMTHOUSE_ISSUER_URL` without requiring full M2M configuration. */
export function getPymthouseIssuerUrlFromEnv(): string | null {
  const raw = trimEnv("PYMTHOUSE_ISSUER_URL");
  if (!raw) return null;
  try {
    return stripTrailingSlashes(new URL(raw).href);
  } catch {
    return null;
  }
}

/** Read `PYMTHOUSE_PUBLIC_CLIENT_ID` without requiring full M2M configuration. */
export function getPymthousePublicClientIdFromEnv(): string | null {
  return trimEnv("PYMTHOUSE_PUBLIC_CLIENT_ID");
}

/** True when all vars required by `createPmtHouseClientFromEnv` are present. */
export function isPymthouseConfigured(): boolean {
  return readPymthouseEnv() !== null;
}

/** Resolve Builder API base (`…/api/v1`) from issuer URL (`…/api/v1/oidc`). */
export function getBuilderApiV1BaseFromIssuerUrl(issuerUrl: string): string {
  const noTrail = stripTrailingSlashes(issuerUrl.trim());
  return noTrail.replace(/\/oidc\/?$/i, "");
}

/** Origin of the OIDC issuer host (e.g. `https://pymthouse.com`). */
export function getPymthouseIssuerOrigin(issuerUrl: string): string {
  return new URL(stripTrailingSlashes(issuerUrl.trim())).origin;
}
