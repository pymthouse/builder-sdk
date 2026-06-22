/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";

import {
  exchangeApiKeyForSigner,
  mintSignerSessionFromApiKey,
} from "../../src/signer/api-key-exchange.js";
import { PmtHouseError } from "../../src/errors.js";
import type { FetchLike } from "../../src/types.js";
import { PmtHouseClient } from "../../src/client.js";

function requestInputHref(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

describe("exchangeApiKeyForSigner architecture", () => {
  it("calls only the facade exchange route, not dashboard signer proxy paths", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      Response.json({
        access_token: "signer.jwt",
        expires_in: 300,
        scope: "sign:job",
        balanceUsdMicros: "0",
        lifetimeGrantedUsdMicros: "0",
        signerUrl: "https://signer.example",
      }),
    );

    const result = await exchangeApiKeyForSigner({
      facadeUrl: "https://dashboard.example.com",
      apiKey: "pmth_test_key",
      fetch: fetchImpl,
    });

    expect(result.access_token).toBe("signer.jwt");
    expect(result.signerUrl).toBe("https://signer.example");
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      "https://dashboard.example.com/api/pymthouse/keys/exchange",
    );
    for (const call of fetchImpl.mock.calls) {
      const href = requestInputHref(call[0]);
      expect(href).not.toMatch(/\/api\/signer\/(sign-orchestrator-info|generate-live-payment)/);
    }
  });

  it("passes through discoveryUrl from the exchange response", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      Response.json({
        access_token: "signer.jwt",
        expires_in: 300,
        scope: "sign:job",
        signerUrl: "https://signer.example",
        discoveryUrl:
          "https://discovery-service-production-8955.up.railway.app/v1/discovery/raw?serviceType=legacy",
      }),
    );

    const result = await exchangeApiKeyForSigner({
      facadeUrl: "https://dashboard.example.com",
      apiKey: "pmth_test_key",
      fetch: fetchImpl,
    });

    expect(result.discoveryUrl).toBe(
      "https://discovery-service-production-8955.up.railway.app/v1/discovery/raw?serviceType=legacy",
    );
  });

  it("omits discoveryUrl when the exchange response has none", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      Response.json({
        access_token: "signer.jwt",
        expires_in: 300,
        scope: "sign:job",
        signerUrl: "https://signer.example",
      }),
    );

    const result = await exchangeApiKeyForSigner({
      facadeUrl: "https://dashboard.example.com",
      apiKey: "pmth_test_key",
      fetch: fetchImpl,
    });

    expect(result.discoveryUrl).toBeUndefined();
  });

  it("rejects dashboard proxy signerUrl values in exchange responses", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () =>
      Response.json({
        access_token: "signer.jwt",
        expires_in: 300,
        scope: "sign:job",
        signerUrl: "https://dashboard.example.com/api/signer/sign-orchestrator-info",
      }),
    );

    await expect(
      exchangeApiKeyForSigner({
        facadeUrl: "https://dashboard.example.com",
        apiKey: "pmth_test_key",
        fetch: fetchImpl,
      }),
    ).rejects.toBeInstanceOf(PmtHouseError);
  });
});

describe("PmtHouseClient.exchangeApiKeyForSignerSession facade path", () => {
  it("returns signerUrl from facade exchange for direct signer calls", async () => {
    const fetchImpl = vi.fn<FetchLike>(async (input) => {
      const href = requestInputHref(input);
      if (href.endsWith("/api/pymthouse/keys/exchange")) {
        return Response.json({
          access_token: "signer.jwt",
          token_type: "Bearer",
          expires_in: 300,
          scope: "sign:job",
          signerUrl: "https://signer.example",
        });
      }
      throw new Error(`Unexpected request: ${href}`);
    });

    const client = new PmtHouseClient({
      issuerUrl: "https://pymthouse.example/api/v1/oidc",
      publicClientId: "app_pub",
      m2mClientId: "unused",
      m2mClientSecret: "unused",
      fetch: fetchImpl,
    });

    const session = await client.exchangeApiKeyForSignerSession({
      apiKey: "pmth_test_key",
      facadeUrl: "https://dashboard.example.com",
      scope: "sign:job",
    });

    expect(session.access_token).toBe("signer.jwt");
    expect(session.signerUrl).toBe("https://signer.example");
  });
});

describe("mintSignerSessionFromApiKey", () => {
  it("exchanges directly against issuer endpoints without facade proxy routes", async () => {
    const issuer = "https://pymthouse.example/api/v1/oidc";
    const fetchImpl = vi.fn<FetchLike>(async (input) => {
      const href = requestInputHref(input);
      if (href.includes(".well-known/openid-configuration")) {
        return Response.json({
          issuer,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
        });
      }
      if (href.endsWith("/auth/api-key/token")) {
        return Response.json({
          access_token: "user.jwt",
          expires_in: 900,
          scope: "sign:job",
        });
      }
      if (href.endsWith("/token")) {
        return Response.json({
          access_token: "signer.jwt",
          expires_in: 300,
          scope: "sign:job",
          balanceUsdMicros: "0",
          lifetimeGrantedUsdMicros: "0",
        });
      }
      throw new Error(`Unexpected request: ${href}`);
    });

    const minted = await mintSignerSessionFromApiKey({
      issuerUrl: issuer,
      publicClientId: "app_pub",
      m2mClientId: "m2m_client",
      m2mClientSecret: "secret",
      apiKey: "pmth_test_key",
      allowInsecureHttp: true,
      fetch: fetchImpl,
    });

    expect(minted.access_token).toBe("signer.jwt");
    for (const call of fetchImpl.mock.calls) {
      const href = requestInputHref(call[0]);
      expect(href).not.toMatch(/\/api\/signer\//);
    }
  });
});
