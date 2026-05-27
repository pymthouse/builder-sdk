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
  return Buffer.from(JSON.stringify(payload)).toString("base64");
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
    decoded = Buffer.from(trimmed, "base64").toString("utf8");
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
  for (const key of ["signer", "discovery", "billing"] as const) {
    const value = obj[key];
    if (value !== undefined && typeof value !== "string") {
      throw new GatewayError(`Invalid token: ${key} must be a string`);
    }
  }

  const billingAccessTokenRaw = obj.billing_access_token;
  if (
    billingAccessTokenRaw !== undefined &&
    (typeof billingAccessTokenRaw !== "string" || !billingAccessTokenRaw.trim())
  ) {
    throw new GatewayError(
      "Invalid token: billing_access_token must be a non-empty string when present",
    );
  }

  if (obj.signer_headers !== undefined && !isStrDict(obj.signer_headers)) {
    throw new GatewayError("Invalid token: signer_headers must be a {string: string} object");
  }
  if (obj.discovery_headers !== undefined && !isStrDict(obj.discovery_headers)) {
    throw new GatewayError("Invalid token: discovery_headers must be a {string: string} object");
  }

  let orchestrators: string[] | undefined;
  if (obj.orchestrators !== undefined) {
    if (!Array.isArray(obj.orchestrators)) {
      throw new GatewayError("Invalid token: orchestrators must be an array of strings");
    }
    orchestrators = [];
    for (const item of obj.orchestrators) {
      if (typeof item !== "string" || !item.trim()) {
        throw new GatewayError("Invalid token: orchestrators must contain only non-empty strings");
      }
      orchestrators.push(item.trim());
    }
  }

  return {
    orchestrators,
    signer: typeof obj.signer === "string" ? obj.signer : undefined,
    discovery: typeof obj.discovery === "string" ? obj.discovery : undefined,
    billing: typeof obj.billing === "string" ? obj.billing : undefined,
    billing_access_token:
      typeof billingAccessTokenRaw === "string" ? billingAccessTokenRaw.trim() : undefined,
    signer_headers: isStrDict(obj.signer_headers) ? obj.signer_headers : undefined,
    discovery_headers: isStrDict(obj.discovery_headers) ? obj.discovery_headers : undefined,
  };
}

export function resolveBillingSigner(
  billingBaseUrl: string,
  accessToken: string,
): { signerUrl: string; signerHeaders: Record<string, string> } {
  const base = billingBaseUrl.replace(/\/+$/, "");
  return {
    signerUrl: `${base}/api/signer`,
    signerHeaders: {
      Authorization: `Bearer ${accessToken.trim()}`,
    },
  };
}

export function resolveTokenSignerConfig(
  token: GatewayTokenPayload,
  billingBaseUrl?: string,
): {
  signerUrl?: string;
  signerHeaders?: Record<string, string>;
  discoveryUrl?: string;
  discoveryHeaders?: Record<string, string>;
  orchestrators?: string[];
} {
  let signerUrl = token.signer;
  let signerHeaders = token.signer_headers;
  let discoveryUrl = token.discovery;
  const discoveryHeaders = token.discovery_headers;

  if (token.billing && token.billing_access_token) {
    const resolved = resolveBillingSigner(token.billing, token.billing_access_token);
    signerUrl = resolved.signerUrl;
    signerHeaders = resolved.signerHeaders;
    if (!discoveryUrl) {
      discoveryUrl = `${token.billing.replace(/\/+$/, "")}/api/signer/discover-orchestrators`;
    }
  } else if (billingBaseUrl && token.billing_access_token) {
    const resolved = resolveBillingSigner(billingBaseUrl, token.billing_access_token);
    signerUrl = resolved.signerUrl;
    signerHeaders = resolved.signerHeaders;
    if (!discoveryUrl) {
      discoveryUrl = `${billingBaseUrl.replace(/\/+$/, "")}/api/signer/discover-orchestrators`;
    }
  }

  return {
    signerUrl,
    signerHeaders,
    discoveryUrl,
    discoveryHeaders,
    orchestrators: token.orchestrators,
  };
}
