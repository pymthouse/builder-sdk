/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";

import {
  createDeviceExchangeHandler,
  exchangeDeviceTokenForSigner,
  extractSignerAccessTokenFromExchangeBody,
  mintSignerTokenFromDeviceToken,
  normalizeDeviceExchangeResponse,
  parseDeviceExchangeRequestBody,
} from "../../src/signer/device-exchange.js";
import { PmtHouseError } from "../../src/errors.js";
import type { FetchLike } from "../../src/types.js";

describe("device exchange helpers", () => {
  it("extracts nested and top-level access tokens", () => {
    expect(
      extractSignerAccessTokenFromExchangeBody({
        token: { accessToken: "nested.jwt" },
      }),
    ).toBe("nested.jwt");
    expect(
      extractSignerAccessTokenFromExchangeBody({
        access_token: "top.jwt",
      }),
    ).toBe("top.jwt");
  });

  it("normalizes exchange response for python-gateway compatibility", () => {
    const body = normalizeDeviceExchangeResponse(
      {
        access_token: "jwt",
        expires_in: 300,
        scope: "sign:job",
        balanceUsdMicros: "5000000",
        lifetimeGrantedUsdMicros: "5000000",
      },
      { signerUrl: "http://127.0.0.1:8080" },
    );
    expect(body.token?.accessToken).toBe("jwt");
    expect(body.access_token).toBe("jwt");
    expect(body.signerUrl).toBe("http://127.0.0.1:8080");
  });

  it("parses device exchange request body", async () => {
    const request = new Request("http://localhost/api/signer/device/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceToken: "user.jwt",
        scope: "sign:job openid profile",
        clientId: "app_123",
      }),
    });
    await expect(parseDeviceExchangeRequestBody(request)).resolves.toEqual({
      deviceToken: "user.jwt",
      scope: "sign:job openid profile",
      clientId: "app_123",
    });
  });
});

describe("createDeviceExchangeHandler", () => {
  it("returns normalized signer JWT payload from injectable mint", async () => {
    const mint = vi.fn(async () => ({
      access_token: "signer.jwt",
      expires_in: 300,
      scope: "sign:job",
      balanceUsdMicros: "4995190",
      lifetimeGrantedUsdMicros: "5000000",
    }));
    const handler = createDeviceExchangeHandler({
      mint,
      signerUrl: "http://127.0.0.1:8080",
    });
    const response = await handler(
      new Request("http://localhost/api/signer/device/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceToken: "user.jwt", clientId: "app_123" }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.access_token).toBe("signer.jwt");
    expect(body.signerUrl).toBe("http://127.0.0.1:8080");
    expect(mint).toHaveBeenCalledWith("user.jwt", {
      scope: undefined,
      clientId: "app_123",
    });
  });
});

describe("mintSignerTokenFromDeviceToken", () => {
  it("calls token endpoint with signer audience exchange grant", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(".well-known/openid-configuration")) {
        return Response.json({
          issuer: "https://pymthouse.example/api/v1/oidc",
          token_endpoint: "https://pymthouse.example/api/v1/oidc/token",
          jwks_uri: "https://pymthouse.example/api/v1/oidc/jwks",
        });
      }
      return Response.json({
        access_token: "signer.jwt",
        expires_in: 300,
        scope: "sign:job",
        balanceUsdMicros: "4995190",
        lifetimeGrantedUsdMicros: "5000000",
      });
    });

    const result = await mintSignerTokenFromDeviceToken({
      issuerUrl: "https://pymthouse.example/api/v1/oidc",
      m2mClientId: "m2m_client",
      m2mClientSecret: "secret",
      deviceToken: "user.jwt",
      fetch: fetchImpl,
      allowInsecureHttp: true,
    });

    expect(result.access_token).toBe("signer.jwt");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const tokenCall = fetchImpl.mock.calls.find((call) =>
      String(call[0]).includes("/token"),
    ) as [RequestInfo | URL, RequestInit | undefined] | undefined;
    expect(tokenCall).toBeDefined();
    const init = tokenCall?.[1];
    expect(init).toBeDefined();
    const params = new URLSearchParams(String(init?.body));
    expect(params.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
    expect(params.get("subject_token")).toBe("user.jwt");
    expect(params.get("audience")).toBe("livepeer-remote-signer");
  });
});

describe("exchangeDeviceTokenForSigner", () => {
  it("posts to facade route and returns access token", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      Response.json({
        access_token: "signer.jwt",
        expires_in: 300,
        scope: "sign:job",
        balanceUsdMicros: "1",
        lifetimeGrantedUsdMicros: "2",
        signerUrl: "http://127.0.0.1:8080",
      }),
    );

    const result = await exchangeDeviceTokenForSigner({
      facadeUrl: "http://localhost:3001",
      deviceToken: "user.jwt",
      fetch: fetchImpl,
    });

    expect(result.access_token).toBe("signer.jwt");
    expect(result.signerUrl).toBe("http://127.0.0.1:8080");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "http://localhost:3001/api/signer/device/exchange",
    );
    expect(
      (fetchImpl.mock.calls[0]?.[1] as RequestInit | undefined)?.method,
    ).toBe("POST");
  });

  it("maps facade errors to PmtHouseError", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      Response.json(
        { error: "invalid_grant", error_description: "bad token" },
        { status: 400 },
      ),
    );

    await expect(
      exchangeDeviceTokenForSigner({
        facadeUrl: "http://localhost:3001",
        deviceToken: "bad",
        fetch: fetchImpl,
      }),
    ).rejects.toBeInstanceOf(PmtHouseError);
  });
});
