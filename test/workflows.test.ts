/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";

import { clearDiscoveryCache, PmtHouseClient } from "../src/index.js";
import { PmtHouseError } from "../src/errors.js";

const ISSUER = "https://pymthouse.example/api/v1/oidc";
const TOKEN_ENDPOINT = `${ISSUER}/token`;
const APP_USERS_ENDPOINT = "https://pymthouse.example/api/v1/apps/app_pub/users";
const USER_TOKEN_ENDPOINT = `${APP_USERS_ENDPOINT}/user-1/token`;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createClient(fetchImpl: typeof fetch): PmtHouseClient {
  return new PmtHouseClient({
    issuerUrl: ISSUER,
    publicClientId: "app_pub",
    m2mClientId: "m2m_1",
    m2mClientSecret: "secret",
    fetch: fetchImpl,
  });
}

describe("PmtHouseClient workflows", () => {
  it("mintSignerSessionForExternalUser upserts and exchanges", async () => {
    clearDiscoveryCache(ISSUER);
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);

      if (request.url.endsWith("/.well-known/openid-configuration")) {
        return json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/authorize`,
          token_endpoint: TOKEN_ENDPOINT,
          jwks_uri: `${ISSUER}/jwks`,
        });
      }

      if (request.url === APP_USERS_ENDPOINT && request.method === "POST") {
        return json({ id: "u1", externalUserId: "user-1", status: "active" });
      }

      if (request.url === USER_TOKEN_ENDPOINT) {
        return json({
          access_token: "eyJ.short.jwt",
          refresh_token: "refresh",
          token_type: "Bearer",
          expires_in: 900,
          scope: "sign:job",
          subject_type: "app_user",
        });
      }

      if (request.url === TOKEN_ENDPOINT) {
        return json({
          access_token: "pmth_opaque",
          token_type: "Bearer",
          expires_in: 7776000,
          scope: "sign:job",
          issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
        });
      }

      throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    };

    const out = await createClient(fetchImpl).mintSignerSessionForExternalUser({
      externalUserId: "user-1",
    });
    expect(out.accessToken).toBe("pmth_opaque");
    expect(out.expiresIn).toBe(7776000);
  });

  it("mintSignerSessionForExternalUser performs the documented opaque exchange (omits resource, sends scope)", async () => {
    clearDiscoveryCache(ISSUER);
    const bodies = new Map<string, string>();
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);

      if (request.url.endsWith("/.well-known/openid-configuration")) {
        return json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/authorize`,
          token_endpoint: TOKEN_ENDPOINT,
          jwks_uri: `${ISSUER}/jwks`,
        });
      }

      if (request.url === APP_USERS_ENDPOINT && request.method === "POST") {
        return json({ id: "u1", externalUserId: "user-1", status: "active" });
      }

      if (request.url === USER_TOKEN_ENDPOINT) {
        bodies.set("user_token", await request.clone().text());
        return json({
          access_token: "eyJ.short.jwt",
          refresh_token: "refresh",
          token_type: "Bearer",
          expires_in: 900,
          scope: "sign:job",
          subject_type: "app_user",
        });
      }

      if (request.url === TOKEN_ENDPOINT) {
        bodies.set("exchange", await request.clone().text());
        return json({
          access_token: "pmth_opaque",
          token_type: "Bearer",
          expires_in: 7776000,
          scope: "sign:job",
          issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
        });
      }

      throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    };

    const out = await createClient(fetchImpl).mintSignerSessionForExternalUser({
      externalUserId: "user-1",
    });
    expect(out.accessToken).toBe("pmth_opaque");

    const exchange = new URLSearchParams(bodies.get("exchange"));
    // Documented gateway/opaque exchange: NO `resource` indicator.
    expect(exchange.has("resource")).toBe(false);
    expect(exchange.get("scope")).toBe("sign:job");
    expect(exchange.get("subject_token_type")).toBe(
      "urn:ietf:params:oauth:token-type:access_token",
    );
    expect(exchange.get("subject_token")).toBe("eyJ.short.jwt");
  });

  it("mintSignerSessionForExternalUser tolerates an exchange response missing issued_token_type", async () => {
    clearDiscoveryCache(ISSUER);
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);

      if (request.url.endsWith("/.well-known/openid-configuration")) {
        return json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/authorize`,
          token_endpoint: TOKEN_ENDPOINT,
          jwks_uri: `${ISSUER}/jwks`,
        });
      }

      if (request.url === APP_USERS_ENDPOINT && request.method === "POST") {
        return json({ id: "u1", externalUserId: "user-1", status: "active" });
      }

      if (request.url === USER_TOKEN_ENDPOINT) {
        return json({
          access_token: "eyJ.short.jwt",
          refresh_token: "refresh",
          token_type: "Bearer",
          expires_in: 900,
          scope: "sign:job",
          subject_type: "app_user",
        });
      }

      if (request.url === TOKEN_ENDPOINT) {
        // Deployed gateway path that omits `issued_token_type` entirely.
        return json({
          access_token: "pmth_opaque_no_issued",
          token_type: "Bearer",
          expires_in: 7776000,
          scope: "sign:job",
        });
      }

      throw new Error(`Unexpected request: ${request.method} ${request.url}`);
    };

    const out = await createClient(fetchImpl).mintSignerSessionForExternalUser({
      externalUserId: "user-1",
    });
    expect(out.accessToken).toBe("pmth_opaque_no_issued");
    expect(out.expiresIn).toBe(7776000);
    expect(out.scope).toBe("sign:job");
  });

  it("approveDeviceLogin rejects mismatched publicClientId", async () => {
    const client = createClient(vi.fn() as typeof fetch);
    await expect(
      client.approveDeviceLogin({
        externalUserId: "user-1",
        userCode: "ABCD-EFGH",
        publicClientId: "app_other",
      }),
    ).rejects.toBeInstanceOf(PmtHouseError);
  });
});
