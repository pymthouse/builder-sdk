/**
 * Exchange a dashboard API key for a short-lived signer JWT, then call the remote
 * signer DMZ directly (no dashboard /api/signer/* proxy).
 *
 * Prerequisites:
 * - Create an API key at Dashboard → API keys (copy the full pmth_* value once).
 * - Set env vars below (never commit the API key).
 *
 * Usage:
 *   PMTH_API_KEY=pmth_... \
 *   DASHBOARD_ORIGIN=http://localhost:3002 \
 *   PYMTHOUSE_PUBLIC_CLIENT_ID=app_... \
 *   node examples/stream-with-api-key.mjs
 */

import {
  DIRECT_SIGNER_PATHS,
  exchangeApiKeyForSigner,
  signerEndpointUrl,
} from "@pymthouse/builder-sdk/signer/server";
import { parseHttpOrigin } from "@pymthouse/builder-sdk/config.js";

const apiKey = process.env.PMTH_API_KEY?.trim();
const facadeUrl = parseHttpOrigin(process.env.DASHBOARD_ORIGIN, "http://localhost:3002");
const publicClientId = process.env.PYMTHOUSE_PUBLIC_CLIENT_ID?.trim();
const signerUrlOverride = process.env.SIGNER_URL?.trim();

if (!apiKey?.startsWith("pmth_")) {
  console.error("Set PMTH_API_KEY to the full dashboard API key (pmth_...).");
  process.exit(1);
}

if (!publicClientId) {
  console.error("Set PYMTHOUSE_PUBLIC_CLIENT_ID to your public app client id (app_...).");
  process.exit(1);
}

const session = await exchangeApiKeyForSigner({
  facadeUrl,
  apiKey,
  scope: "sign:job",
  clientId: publicClientId,
});

const signerBase = signerUrlOverride ?? session.signerUrl;
if (!signerBase) {
  console.error(
    "Exchange did not return signerUrl. Set SIGNER_URL to the remote signer DMZ base.",
  );
  process.exit(1);
}

console.log("Signer session minted");
console.log("Signer base:", signerBase);

const target = signerEndpointUrl(signerBase, DIRECT_SIGNER_PATHS.signOrchestratorInfo);
const signerResponse = await fetch(target, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${session.access_token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({}),
});

console.log("Signer status:", signerResponse.status);
if (!signerResponse.ok) {
  console.error(`Direct signer request failed with status ${signerResponse.status}`);
  process.exit(1);
}

console.log("Direct signer request completed");
