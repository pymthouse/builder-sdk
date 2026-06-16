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

function requestInputHref(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function urlEncodedBodyString(body: BodyInit | null | undefined): string {
  return typeof body === "string" ? body : "";
}

const TOKEN_EXCHANGE_ISSUER = "https://pymthouse.example/api/v1/oidc";

function mockOidcTokenExchangeFetch(): ReturnType<typeof vi.fn<FetchLike>> {
  return vi.fn<FetchLike>(async (input: RequestInfo | URL) => {
    if (requestInputHref(input).includes(".well-known/openid-configuration")) {
      return Response.json({
        issuer: TOKEN_EXCHANGE_ISSUER,
        token_endpoint: `${TOKEN_EXCHANGE_ISSUER}/token`,
        jwks_uri: `${TOKEN_EXCHANGE_ISSUER}/jwks`,
      });
    }
    return Response.json({
      access_token: "signer.jwt",
      expires_in: 300,
      scope: "sign:job",
      balanceUsdMicros: "0",
      lifetimeGrantedUsdMicros: "0",
    });
  });
}

function runMintSignerTokenFromDeviceToken(
  fetchImpl: ReturnType<typeof vi.fn<FetchLike>>,
  audience?: string,
) {
  return mintSignerTokenFromDeviceToken({
    issuerUrl: TOKEN_EXCHANGE_ISSUER,
    m2mClientId: "m2m_client",
    m2mClientSecret: "secret",
    deviceToken: "user.jwt",
    audience,
    fetch: fetchImpl,
    allowInsecureHttp: true,
  });
}

function tokenExchangeRequestParams(
  fetchImpl: ReturnType<typeof vi.fn<FetchLike>>,
): URLSearchParams {
  const tokenCall = fetchImpl.mock.calls.find((call) =>
    requestInputHref(call[0]).includes("/token"),
  ) as [RequestInfo | URL, RequestInit | undefined] | undefined;
  expect(tokenCall).toBeDefined();
  return new URLSearchParams(urlEncodedBodyString(tokenCall?.[1]?.body));
}

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
    const fetchImpl = mockOidcTokenExchangeFetch();

    const result = await runMintSignerTokenFromDeviceToken(fetchImpl);

    expect(result.access_token).toBe("signer.jwt");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const params = tokenExchangeRequestParams(fetchImpl);
    expect(params.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
    expect(params.get("subject_token")).toBe("user.jwt");
    expect(params.get("audience")).toBe(TOKEN_EXCHANGE_ISSUER);
    expect(params.get("resource")).toBe(TOKEN_EXCHANGE_ISSUER);
  });

  it("uses an explicit audience override when provided", async () => {
    const fetchImpl = mockOidcTokenExchangeFetch();

    await runMintSignerTokenFromDeviceToken(fetchImpl, "https://custom.audience");

    const params = tokenExchangeRequestParams(fetchImpl);
    expect(params.get("audience")).toBe("https://custom.audience");
    expect(params.get("resource")).toBe("https://custom.audience");
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
