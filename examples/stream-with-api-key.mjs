/**
 * Exchange a dashboard API key for a short-lived signer session, then call discovery.
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

import { PmtHouseClient } from "@pymthouse/builder-sdk";

const apiKey = process.env.PMTH_API_KEY?.trim();
const facadeUrl = (process.env.DASHBOARD_ORIGIN ?? "http://localhost:3002").replace(/\/$/, "");
const publicClientId = process.env.PYMTHOUSE_PUBLIC_CLIENT_ID?.trim();
const discoveryUrl =
  process.env.DISCOVERY_URL?.trim() ||
  "https://discovery-service-production-8955.up.railway.app/discover-orchestrators?cap=passthrough";

if (!apiKey?.startsWith("pmth_")) {
  console.error("Set PMTH_API_KEY to the full dashboard API key (pmth_...).");
  process.exit(1);
}

if (!publicClientId) {
  console.error("Set PYMTHOUSE_PUBLIC_CLIENT_ID to your public app client id (app_...).");
  process.exit(1);
}

const issuerUrl =
  process.env.PYMTHOUSE_ISSUER_URL?.trim() ?? "http://localhost:3001/api/v1/oidc";

const client = new PmtHouseClient({
  issuerUrl,
  publicClientId,
  m2mClientId: process.env.PYMTHOUSE_M2M_CLIENT_ID?.trim() ?? "unused",
  m2mClientSecret: process.env.PYMTHOUSE_M2M_CLIENT_SECRET?.trim() ?? "unused",
  allowInsecureHttp: issuerUrl.startsWith("http:"),
});

const session = await client.exchangeApiKeyForSignerSession({
  apiKey,
  facadeUrl,
  scope: "sign:job",
});

console.log("Signer session minted (opaque bearer, truncated):");
console.log(session.access_token.slice(0, 20) + "…");
console.log("expires_in:", session.expires_in);

const discoveryResponse = await fetch(discoveryUrl, {
  headers: {
    Authorization: `Bearer ${session.access_token}`,
    Accept: "application/json",
  },
});

console.log("Discovery status:", discoveryResponse.status);
if (discoveryResponse.ok) {
  const payload = await discoveryResponse.json();
  const count = Array.isArray(payload) ? payload.length : Object.keys(payload).length;
  console.log("Discovery entries:", count);
} else {
  console.error(await discoveryResponse.text());
}
