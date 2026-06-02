/**
 * Smoke test: API key → signer session → start gateway LV2V session (no segments).
 *
 * Prerequisites:
 * - Dashboard with GATEWAY_ENABLED=1 and pymthouse signer routes configured
 * - PMTH_API_KEY, PYMTHOUSE_PUBLIC_CLIENT_ID (for exchange body clientId if needed)
 *
 * Usage:
 *   PMTH_API_KEY=pmth_... \
 *   DASHBOARD_ORIGIN=http://localhost:3002 \
 *   GATEWAY_MODEL_ID=streamdiffusion-sdxl \
 *   node examples/gateway-session-smoke.mjs
 */

import { exchangeApiKeyForSigner } from "@pymthouse/builder-sdk/signer/api-key-exchange.js";

function isSafePathSegment(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    return false;
  }
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
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

const apiKey = process.env.PMTH_API_KEY?.trim();
const facadeUrl = (process.env.DASHBOARD_ORIGIN ?? "http://localhost:3002").replace(/\/$/, "");
const modelId = process.env.GATEWAY_MODEL_ID?.trim() ?? "streamdiffusion-sdxl";
const discoveryUrl = process.env.GATEWAY_DISCOVERY_URL?.trim();

if (!apiKey?.startsWith("pmth_")) {
  console.error("Set PMTH_API_KEY to a full dashboard API key (pmth_...).");
  process.exit(1);
}

const exchanged = await exchangeApiKeyForSigner({
  facadeUrl,
  apiKey,
  scope: "sign:job",
  clientId: process.env.PYMTHOUSE_PUBLIC_CLIENT_ID?.trim(),
});

const signerToken = exchanged.access_token;
console.log("Signer token (truncated):", signerToken.slice(0, 20) + "…");

const body = { modelId };
if (discoveryUrl) {
  body.discoveryUrl = discoveryUrl;
}

const startResponse = await fetch(`${facadeUrl}/api/gateway/sessions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${signerToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify(body),
});

const startBody = await startResponse.json().catch(() => ({}));
console.log("Start session status:", startResponse.status);
console.log(JSON.stringify(startBody, null, 2));

if (!startResponse.ok) {
  process.exit(1);
}

const sessionId = startBody.sessionId;
if (isSafePathSegment(sessionId)) {
  await fetch(`${facadeUrl}/api/gateway/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${signerToken}` },
  }).catch(() => undefined);
}
