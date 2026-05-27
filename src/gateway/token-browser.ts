import { GatewayError } from "./errors.js";
import type { GatewayTokenPayload } from "./types.js";

export function encodeGatewayToken(
  billingBaseUrl: string,
  billingAccessToken: string,
  discoveryUrl?: string,
): string {
  const base = billingBaseUrl.replace(/\/+$/, "");
  const tok = billingAccessToken.trim();
  if (!tok) {
    throw new GatewayError("billing_access_token must be non-empty");
  }
  const payload: Record<string, string> = {
    billing: base,
    billing_access_token: tok,
  };
  if (discoveryUrl?.trim()) {
    payload.discovery = discoveryUrl.trim();
  }
  return btoa(JSON.stringify(payload));
}

function isStrDict(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null) return false;
  return Object.entries(value).every(
    ([k, v]) => typeof k === "string" && typeof v === "string",
  );
}

export function parseGatewayToken(token: string): GatewayTokenPayload {
  const trimmed = token.trim();
  let decoded: string;
  try {
    decoded = atob(trimmed);
  } catch {
    throw new GatewayError("Invalid token: expected base64-encoded JSON");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decoded);
  } catch {
    throw new GatewayError("Invalid token: expected UTF-8 JSON payload");
  }

  if (typeof payload !== "object" || payload === null) {
    throw new GatewayError("Invalid token: payload must be a JSON object");
  }

  const obj = payload as Record<string, unknown>;
  let orchestrators: string[] | undefined;
  if (obj.orchestrators !== undefined) {
    if (!Array.isArray(obj.orchestrators)) {
      throw new GatewayError("Invalid token: orchestrators must be an array of strings");
    }
    orchestrators = obj.orchestrators
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim());
  }

  return {
    orchestrators,
    signer: typeof obj.signer === "string" ? obj.signer : undefined,
    discovery: typeof obj.discovery === "string" ? obj.discovery : undefined,
    billing: typeof obj.billing === "string" ? obj.billing : undefined,
    billing_access_token:
      typeof obj.billing_access_token === "string" ? obj.billing_access_token.trim() : undefined,
    signer_headers: isStrDict(obj.signer_headers) ? obj.signer_headers : undefined,
    discovery_headers: isStrDict(obj.discovery_headers) ? obj.discovery_headers : undefined,
  };
}
