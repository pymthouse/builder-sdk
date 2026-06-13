/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import { clearDiscoveryCache } from "../../src/discovery.js";
import { createDirectSignerProxyHandler } from "../../src/signer/server.js";

const ISSUER = "https://pymthouse.example/api/v1/oidc";
const TOKEN_ENDPOINT = `${ISSUER}/token`;
const REMOTE_SIGNER_URL = "https://signer.example";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeSignerJwt(clientId: string, externalUserId: string): string {
  const enc = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj), "utf8").toString("base64url").replaceAll("=", "");
  return `${enc({ alg: "none", typ: "JWT" })}.${enc({
    iss: ISSUER,
    client_id: clientId,
    external_user_id: externalUserId,
  })}.sig`;
}

function decodeBasic(authorization: string | null): { id: string; secret: string } {
  const raw = (authorization ?? "").replace(/^Basic\s+/i, "");
  const [id, secret] = Buffer.from(raw, "base64").toString("utf8").split(":");
  return { id, secret };
}

/**
 * Mirrors the PymtHouse issuer: the minted JWT `client_id` is bound to the
 * developer app linked to the authenticating M2M credentials, so the mock maps
 * each M2M client id to the public client id it is allowed to mint for.
 */
function createIssuerMock(m2mToClientId: Record<string, string>) {
  const tokenAuthHeaders: string[] = [];
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

    if (request.url === TOKEN_ENDPOINT) {
      const authorization = request.headers.get("Authorization");
      tokenAuthHeaders.push(authorization ?? "");
      const { id } = decodeBasic(authorization);
      const clientId = m2mToClientId[id];
      if (!clientId) {
        return json({ error: "invalid_client" }, 401);
      }
      const body = await request.text();
      const externalUserId =
        new URLSearchParams(body).get("external_user_id") ?? "unknown";
      return json({
        access_token: makeSignerJwt(clientId, externalUserId),
        token_type: "Bearer",
        expires_in: 300,
        balanceUsdMicros: "100",
        lifetimeGrantedUsdMicros: "1000",
      });
    }

    if (request.url.startsWith(REMOTE_SIGNER_URL)) {
      return json({ ok: true });
    }

    throw new Error(`Unexpected request: ${request.url}`);
  };

  return { fetchImpl, tokenAuthHeaders };
}

function signRequest(tenant: string): Request {
  return new Request("http://localhost/api/signer/proxy", {
    method: "POST",
    headers: { "x-tenant": tenant, "content-type": "application/json" },
    body: JSON.stringify({ hello: "world" }),
  });
}

describe("createDirectSignerProxyHandler multi-tenant minting", () => {
  it("selects M2M credentials per publicClientId via resolveM2MCredentials", async () => {
    clearDiscoveryCache(ISSUER);
    const { fetchImpl, tokenAuthHeaders } = createIssuerMock({
      m2m_a: "app_a",
      m2m_b: "app_b",
    });

    const handler = createDirectSignerProxyHandler({
      pymthouseIssuerUrl: ISSUER,
      pymthouseClientId: "app_default",
      pymthouseM2MClientId: "m2m_default",
      pymthouseM2MClientSecret: "secret_default",
      remoteSignerUrl: REMOTE_SIGNER_URL,
      fetch: fetchImpl,
      authenticate: async (request) => ({ tenant: request.headers.get("x-tenant") }),
      resolveExternalUserId: async () => "user-1",
      resolvePublicClientId: async (session) =>
        (session as { tenant: string }).tenant === "a" ? "app_a" : "app_b",
      resolveM2MCredentials: (publicClientId) =>
        publicClientId === "app_a"
          ? { m2mClientId: "m2m_a", m2mClientSecret: "secret_a" }
          : { m2mClientId: "m2m_b", m2mClientSecret: "secret_b" },
    });

    const responseA = await handler(signRequest("a"));
    const responseB = await handler(signRequest("b"));

    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);
    expect(tokenAuthHeaders.map(decodeBasic)).toEqual([
      { id: "m2m_a", secret: "secret_a" },
      { id: "m2m_b", secret: "secret_b" },
    ]);
  });

  it("falls back to configured M2M credentials when resolveM2MCredentials is omitted", async () => {
    clearDiscoveryCache(ISSUER);
    const { fetchImpl, tokenAuthHeaders } = createIssuerMock({
      m2m_default: "app_default",
    });

    const handler = createDirectSignerProxyHandler({
      pymthouseIssuerUrl: ISSUER,
      pymthouseClientId: "app_default",
      pymthouseM2MClientId: "m2m_default",
      pymthouseM2MClientSecret: "secret_default",
      remoteSignerUrl: REMOTE_SIGNER_URL,
      fetch: fetchImpl,
      authenticate: async () => ({}),
      resolveExternalUserId: async () => "user-1",
    });

    const response = await handler(signRequest("default"));

    expect(response.status).toBe(200);
    expect(tokenAuthHeaders.map(decodeBasic)).toEqual([
      { id: "m2m_default", secret: "secret_default" },
    ]);
  });
});
