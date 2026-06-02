/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { PmtHouseClient } from "../src/client.js";
import type { FetchLike } from "../src/types.js";
import { resolveFetchInputUrl } from "./fetch-url.js";

function makeClient(fetchImpl: FetchLike) {
  return new PmtHouseClient({
    issuerUrl: "https://issuer.example/api/v1/oidc",
    publicClientId: "app_x",
    m2mClientId: "m2m_x",
    m2mClientSecret: "secret",
    fetch: fetchImpl,
  });
}

describe("PmtHouseClient billing extensions", () => {
  it("getUsage passes include=retail", async () => {
    const captured: { url?: string } = {};
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      captured.url = resolveFetchInputUrl(input);
      return Response.json({
        clientId: "app_x",
        source: "openmeter",
        period: { start: null, end: null },
        totals: { requestCount: 0 },
      });
    }) as unknown as FetchLike;

    await makeClient(fetchMock).getUsage({ includeRetail: true, groupBy: "pipeline_model" });
    expect(new URL(captured.url!).searchParams.get("include")).toBe("retail");
  });

  it("getSignerRouting calls routing endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        clientId: "app_x",
        routing: {
          signerApiUrl: "https://issuer.example/api/signer",
          remoteDmzUrl: "http://127.0.0.1:8080",
          jwksUri: "https://issuer.example/api/v1/oidc/jwks",
          identityMode: "trusted_headers",
          meteringMode: "platform_ingest",
        },
        patterns: {},
      }),
    ) as unknown as FetchLike;

    const routing = await makeClient(fetchMock).getSignerRouting();
    expect(routing.routing.meteringMode).toBe("platform_ingest");
  });

  it("getUsageBalance calls usage/balance endpoint", async () => {
    const captured: { url?: string } = {};
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      captured.url = resolveFetchInputUrl(input);
      return Response.json({
        externalUserId: "user-1",
        balanceUsdMicros: "5000000",
        consumedUsdMicros: "1000000",
        lifetimeGrantedUsdMicros: "6000000",
        hasAccess: true,
        remainingUsdMicros: "5000000",
      });
    }) as unknown as FetchLike;

    const balance = await makeClient(fetchMock).getUsageBalance("user-1");
    expect(captured.url).toContain("/usage/balance");
    expect(captured.url).toContain("externalUserId=user-1");
    expect(balance.balanceUsdMicros).toBe("5000000");
    expect(balance.hasAccess).toBe(true);
  });

  it("grantUserAllowance POSTs to allowances endpoint", async () => {
    const captured: { url?: string; body?: string } = {};
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      captured.url = resolveFetchInputUrl(input);
      captured.body = typeof init?.body === "string" ? init.body : undefined;
      return Response.json({
        externalUserId: "user-1",
        grantedUsdMicros: "1000000",
        balanceUsdMicros: "6000000",
        hasAccess: true,
      });
    }) as unknown as FetchLike;

    await makeClient(fetchMock).grantUserAllowance("user-1", {
      amountUsdMicros: "1000000",
      source: "manual",
    });
    expect(captured.url).toContain("/allowances");
    expect(JSON.parse(captured.body!)).toEqual({
      amountUsdMicros: "1000000",
      source: "manual",
    });
  });

  it("grantUserCredits delegates to allowances (deprecated alias)", async () => {
    const captured: { url?: string } = {};
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      captured.url = resolveFetchInputUrl(input);
      return Response.json({
        externalUserId: "user-1",
        balanceUsdMicros: "2000000",
        hasAccess: true,
      });
    }) as unknown as FetchLike;

    await makeClient(fetchMock).grantUserCredits("user-1", {
      amountUsdMicros: "500000",
    });
    expect(captured.url).toContain("/allowances");
  });
});
