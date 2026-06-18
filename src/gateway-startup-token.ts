/**
 * Base64 JSON startup tokens for livepeer-python-gateway `--token`.
 * Wire format matches python-gateway `parse_token` / `token.py`.
 */

export type GatewayStartupTokenPayload = {
  signer?: string;
  discovery?: string;
  billing?: string;
  api_key?: string;
  signer_headers?: Record<string, string>;
  discovery_headers?: Record<string, string>;
  orchestrators?: string[];
};

function encodeUtf8JsonToBase64(payload: GatewayStartupTokenPayload): string {
  const json = JSON.stringify(payload);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(json, "utf8").toString("base64");
  }
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function encodeGatewayStartupToken(
  payload: GatewayStartupTokenPayload,
): string {
  return encodeUtf8JsonToBase64(payload);
}

export type BuildApiKeyGatewayStartupTokenInput = {
  apiKey: string;
  signerUrl: string;
  discoveryUrl: string;
  /** When set, selects Pattern B (BFF exchange). Omit for direct pmth_* webhook auth. */
  billingUrl?: string;
  discoveryHeaders?: Record<string, string>;
};

export function buildApiKeyGatewayStartupToken(
  input: BuildApiKeyGatewayStartupTokenInput,
): string {
  const apiKey = input.apiKey.trim();
  if (!apiKey) {
    throw new Error("apiKey is required");
  }
  const signerUrl = input.signerUrl.trim();
  const discoveryUrl = input.discoveryUrl.trim();
  if (!signerUrl || !discoveryUrl) {
    throw new Error("signerUrl and discoveryUrl are required");
  }

  const payload: GatewayStartupTokenPayload = {
    signer: signerUrl,
    discovery: discoveryUrl,
    signer_headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  };

  const billingUrl = input.billingUrl?.trim();
  if (billingUrl) {
    payload.billing = billingUrl;
  }

  if (input.discoveryHeaders && Object.keys(input.discoveryHeaders).length > 0) {
    payload.discovery_headers = { ...input.discoveryHeaders };
  }

  return encodeGatewayStartupToken(payload);
}
