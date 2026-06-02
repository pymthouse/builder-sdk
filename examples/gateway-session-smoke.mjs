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
import {
  buildGatewaySessionDeleteUrl,
  parseHttpOrigin,
} from "@pymthouse/builder-sdk/config.js";

const apiKey = process.env.PMTH_API_KEY?.trim();
const facadeOrigin = parseHttpOrigin(process.env.DASHBOARD_ORIGIN, "http://localhost:3002");
const modelId = process.env.GATEWAY_MODEL_ID?.trim() ?? "streamdiffusion-sdxl";
const discoveryUrl = process.env.GATEWAY_DISCOVERY_URL?.trim();

if (!apiKey?.startsWith("pmth_")) {
  console.error("Set PMTH_API_KEY to a full dashboard API key (pmth_...).");
  process.exit(1);
}

const exchanged = await exchangeApiKeyForSigner({
  facadeUrl: facadeOrigin,
  apiKey,
  scope: "sign:job",
  clientId: process.env.PYMTHOUSE_PUBLIC_CLIENT_ID?.trim(),
});

const signerToken = exchanged.access_token;
console.log("Signer session acquired");

const body = { modelId };
if (discoveryUrl) {
  body.discoveryUrl = discoveryUrl;
}

const startResponse = await fetch(`${facadeOrigin}/api/gateway/sessions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${signerToken}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify(body),
});

console.log("Start session status:", startResponse.status);

if (!startResponse.ok) {
  process.exit(1);
}

const startBody = await startResponse.json().catch(() => ({}));
if (typeof startBody.sessionId === "string") {
  try {
    const deleteUrl = buildGatewaySessionDeleteUrl(facadeOrigin, startBody.sessionId);
    await fetch(deleteUrl, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${signerToken}` },
    }).catch(() => undefined);
  } catch {
    // Session id from server failed local validation — skip cleanup.
  }
}

console.log("Gateway session smoke test completed");
