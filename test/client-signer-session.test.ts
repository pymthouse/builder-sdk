import { describe, expect, it } from "vitest";
import { clearDiscoveryCache, PmtHouseClient } from "../src/index.js";

const ISSUER = "https://pymthouse.example/api/v1/oidc";
const TOKEN_ENDPOINT = `${ISSUER}/token`;
const APP_USERS_ENDPOINT = "https://pymthouse.example/api/v1/apps/app_pub/users";
const USER_TOKEN_ENDPOINT = `${APP_USERS_ENDPOINT}/user-1/token`;
const BASIC_AUTH = `Basic ${Buffer.from("m2m_1:secret", "utf8").toString("base64")}`;

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

describe("PmtHouseClient signer session exchange", () => {
  it("keeps short-lived user JWT minting available", async () => {
    const requests: Request[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);

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

      throw new Error(`Unexpected request: ${request.url}`);
    };

    const token = await createClient(fetchImpl).mintUserAccessToken({
      externalUserId: "user-1",
      scope: "sign:job",
    });

    expect(token.access_token).toBe("eyJ.short.jwt");
    expect(token.expires_in).toBe(900);
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.get("Authorization")).toBe(BASIC_AUTH);
  });

  it("mints a user JWT first, then exchanges it for a long-lived signer session", async () => {
    clearDiscoveryCache(ISSUER);
    const requests: Request[] = [];
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      bodies.push(await request.clone().text());

      if (request.url.endsWith("/.well-known/openid-configuration")) {
        return json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/authorize`,
          token_endpoint: TOKEN_ENDPOINT,
          jwks_uri: `${ISSUER}/jwks`,
        });
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
          access_token: "pmth_long_lived",
          token_type: "Bearer",
          expires_in: 90 * 24 * 60 * 60,
          issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
          scope: "sign:job",
        });
      }

      throw new Error(`Unexpected request: ${request.url}`);
    };

    const token = await createClient(fetchImpl).mintUserSignerSessionToken({
      externalUserId: "user-1",
      scope: "sign:job",
    });

    expect(token.access_token).toBe("pmth_long_lived");
    expect(token.expires_in).toBe(90 * 24 * 60 * 60);

    const tokenRequestIndex = requests.findIndex((request) => request.url === TOKEN_ENDPOINT);
    expect(tokenRequestIndex).toBeGreaterThanOrEqual(0);
    const tokenRequest = requests[tokenRequestIndex];
    const params = new URLSearchParams(bodies[tokenRequestIndex]);

    expect(tokenRequest.headers.get("Authorization")).toBe(BASIC_AUTH);
    expect(params.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:token-exchange",
    );
    expect(params.get("subject_token")).toBe("eyJ.short.jwt");
    expect(params.get("subject_token_type")).toBe(
      "urn:ietf:params:oauth:token-type:access_token",
    );
    expect(params.get("requested_token_type")).toBe(
      "urn:ietf:params:oauth:token-type:access_token",
    );
    expect(params.get("resource")).toBe(ISSUER);
    expect(params.has("scope")).toBe(false);
    expect(params.has("client_secret")).toBe(false);
  });

  it("forwards an explicit resource unchanged on signer session exchange", async () => {
    clearDiscoveryCache(ISSUER);
    const explicitResource = "https://explicit.resource";
    const requests: Request[] = [];
    const bodies: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      bodies.push(await request.clone().text());

      if (request.url.endsWith("/.well-known/openid-configuration")) {
        return json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/authorize`,
          token_endpoint: TOKEN_ENDPOINT,
          jwks_uri: `${ISSUER}/jwks`,
        });
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
          access_token: "pmth_long_lived",
          token_type: "Bearer",
          expires_in: 90 * 24 * 60 * 60,
          issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
          scope: "sign:job",
        });
      }

      throw new Error(`Unexpected request: ${request.url}`);
    };

    const token = await createClient(fetchImpl).mintUserSignerSessionToken({
      externalUserId: "user-1",
      scope: "sign:job",
      resource: explicitResource,
    });

    expect(token.access_token).toBe("pmth_long_lived");
    expect(token.expires_in).toBe(90 * 24 * 60 * 60);

    const tokenRequestIndex = requests.findIndex((request) => request.url === TOKEN_ENDPOINT);
    expect(tokenRequestIndex).toBeGreaterThanOrEqual(0);
    const tokenRequest = requests[tokenRequestIndex];
    const params = new URLSearchParams(bodies[tokenRequestIndex]);

    expect(tokenRequest.headers.get("Authorization")).toBe(BASIC_AUTH);
    expect(params.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:token-exchange",
    );
    expect(params.get("subject_token")).toBe("eyJ.short.jwt");
    expect(params.get("subject_token_type")).toBe(
      "urn:ietf:params:oauth:token-type:access_token",
    );
    expect(params.get("requested_token_type")).toBe(
      "urn:ietf:params:oauth:token-type:access_token",
    );
    expect(params.get("resource")).toBe(explicitResource);
    expect(params.has("scope")).toBe(false);
    expect(params.has("client_secret")).toBe(false);
  });
});
