/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";

import {
  buildGatewayToken,
  decodeGatewayToken,
  mintGatewayToken,
} from "../../src/signer/gateway-token.js";
import { PmtHouseError } from "../../src/errors.js";

const SIGNER_URL = "https://signer.example/generate-live-payment";

describe("buildGatewayToken", () => {
  it("builds a signerJwt bundle and sets the Authorization header", () => {
    const token = buildGatewayToken({
      signer: SIGNER_URL,
      auth: { kind: "signerJwt", accessToken: "jwt-abc" },
    });
    const bundle = decodeGatewayToken(token);
    expect(bundle.signer).toBe(SIGNER_URL);
    expect(bundle.signer_headers).toEqual({ Authorization: "Bearer jwt-abc" });
    expect(bundle.api_key).toBeUndefined();
    expect(bundle.billing).toBeUndefined();
  });

  it("builds a pmthApiKey bundle with top-level api_key + billing", () => {
    const token = buildGatewayToken({
      signer: SIGNER_URL,
      discovery: "https://discovery.example",
      orchestrators: [" https://orch.example ", ""],
      auth: {
        kind: "pmthApiKey",
        apiKey: "pmth_live_123",
        billing: "https://billing.example",
      },
    });
    const bundle = decodeGatewayToken(token);
    expect(bundle.api_key).toBe("pmth_live_123");
    expect(bundle.billing).toBe("https://billing.example");
    expect(bundle.discovery).toBe("https://discovery.example");
    expect(bundle.orchestrators).toEqual(["https://orch.example"]);
    expect(bundle.signer_headers).toBeUndefined();
  });

  it("omits empty optional fields", () => {
    const token = buildGatewayToken({ signer: SIGNER_URL });
    const bundle = decodeGatewayToken(token);
    expect(Object.keys(bundle)).toEqual(["signer"]);
  });

  it("merges caller-provided signer headers with the JWT Authorization", () => {
    const token = buildGatewayToken({
      signer: SIGNER_URL,
      signerHeaders: { "X-Tenant": "acme" },
      auth: { kind: "signerJwt", accessToken: "jwt-xyz" },
    });
    const bundle = decodeGatewayToken(token);
    expect(bundle.signer_headers).toEqual({
      "X-Tenant": "acme",
      Authorization: "Bearer jwt-xyz",
    });
  });

  it("produces standard (non-url-safe) base64 of UTF-8 JSON", () => {
    const token = buildGatewayToken({ signer: SIGNER_URL });
    expect(token).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    const json = Buffer.from(token, "base64").toString("utf8");
    expect(JSON.parse(json)).toEqual({ signer: SIGNER_URL });
  });

  it("rejects an empty signer", () => {
    expect(() => buildGatewayToken({ signer: "   " })).toThrow(PmtHouseError);
  });
});

describe("decodeGatewayToken", () => {
  it("round-trips a built token", () => {
    const input = {
      signer: SIGNER_URL,
      auth: { kind: "signerJwt" as const, accessToken: "jwt-roundtrip" },
    };
    expect(decodeGatewayToken(buildGatewayToken(input))).toEqual({
      signer: SIGNER_URL,
      signer_headers: { Authorization: "Bearer jwt-roundtrip" },
    });
  });

  it("throws on non-base64 input", () => {
    expect(() => decodeGatewayToken("!!!not base64!!!")).toThrow(PmtHouseError);
  });

  it("throws when the payload is not a JSON object", () => {
    const token = Buffer.from("[1,2,3]", "utf8").toString("base64");
    expect(() => decodeGatewayToken(token)).toThrow(PmtHouseError);
  });
});

describe("mintGatewayToken", () => {
  it("mints via M2M client_credentials and embeds the JWT", async () => {
    const issuer = "https://pymthouse.example/api/v1/oidc";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (href.includes(".well-known/openid-configuration")) {
        return Response.json({
          issuer,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        });
      }
      return Response.json({
        access_token: "minted-jwt",
        expires_in: 900,
        balanceUsdMicros: "0",
        lifetimeGrantedUsdMicros: "0",
      });
    });

    const token = await mintGatewayToken({
      source: "m2m",
      signer: SIGNER_URL,
      issuerUrl: issuer,
      m2mClientId: "m2m-client",
      m2mClientSecret: "m2m-secret",
      externalUserId: "user-1",
      fetch: fetchImpl,
      allowInsecureHttp: true,
    });

    const bundle = decodeGatewayToken(token);
    expect(bundle.signer_headers).toEqual({ Authorization: "Bearer minted-jwt" });
  });

  it("mints via apiKey exchange and embeds the signer JWT", async () => {
    const issuer = "https://pymthouse.example/api/v1/oidc";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const href =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (href.includes(".well-known/openid-configuration")) {
        return Response.json({
          issuer,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        });
      }
      if (href.includes("/auth/api-key/token")) {
        return Response.json({
          access_token: "user-access-token",
          expires_in: 900,
          scope: "sign:job",
        });
      }
      return Response.json({
        access_token: "minted-signer-jwt",
        expires_in: 900,
        scope: "sign:job",
        balanceUsdMicros: "0",
        lifetimeGrantedUsdMicros: "0",
      });
    });

    const token = await mintGatewayToken({
      source: "apiKey",
      signer: SIGNER_URL,
      issuerUrl: issuer,
      publicClientId: "public-client",
      apiKey: "pmth_live_123",
      m2mClientId: "m2m-client",
      m2mClientSecret: "m2m-secret",
      fetch: fetchImpl,
      allowInsecureHttp: true,
    });

    const bundle = decodeGatewayToken(token);
    expect(bundle.signer_headers).toEqual({ Authorization: "Bearer minted-signer-jwt" });
    expect(
      fetchImpl.mock.calls.some(([req]) => {
        const href =
          typeof req === "string" ? req : req instanceof URL ? req.href : req.url;
        return href.includes("/api/v1/apps/public-client/auth/api-key/token");
      }),
    ).toBe(true);
  });
});
