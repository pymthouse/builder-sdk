/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { PmtHouseClient } from "../src/client.js";
import type { FetchLike } from "../src/types.js";
import { resolveFetchInputUrl } from "./fetch-url.js";

type FetchInput = string | URL | Request;

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
    const fetchMock = vi.fn(async (input: FetchInput) => {
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

  it("getUsageBalance prefers end-user usage/balance after mint", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: FetchInput) => {
      const url = resolveFetchInputUrl(input);
      urls.push(url);
      if (url.includes("/token")) {
        return Response.json({
          access_token: "user-jwt",
          refresh_token: "",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "sign:job",
          subject_type: "app_user",
        });
      }
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
    expect(urls.some((url) => url.includes("/users") && !url.includes("/token"))).toBe(false);
    expect(urls.some((url) => url.includes("/api/v1/user/usage/balance"))).toBe(true);
    expect(balance.balanceUsdMicros).toBe("5000000");
    expect(balance.hasAccess).toBe(true);
  });

  it("grantUserAllowance POSTs to allowances endpoint", async () => {
    const captured: { url?: string; body?: string } = {};
    const fetchMock = vi.fn(async (input: FetchInput, init?: RequestInit) => {
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

  it("listBillingProducts GETs /plans?apiVersion=2", async () => {
    const captured: { url?: string } = {};
    const fetchMock = vi.fn(async (input: FetchInput) => {
      captured.url = resolveFetchInputUrl(input);
      return Response.json({
        apiVersion: 2,
        products: [
          {
            id: "plan_pro",
            clientId: "app_x",
            name: "Pro",
            type: "subscription",
            status: "active",
            priceAmount: "10",
            priceCurrency: "USD",
            isNetworkDefault: false,
            isStarterDefault: false,
            allowance: { includedUsdMicros: null, billingCycle: "monthly" },
            defaultRetailRateUsd: null,
            capabilities: [],
            sync: {
              status: "synced",
              syncedAt: null,
              errorCode: null,
              errorMessage: null,
            },
          },
        ],
      });
    }) as unknown as FetchLike;

    const result = await makeClient(fetchMock).listBillingProducts();
    expect(captured.url).toContain("/plans?apiVersion=2");
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.id).toBe("plan_pro");
  });

  it("createBillingCheckout POSTs plan + externalUserId", async () => {
    const captured: { url?: string; body?: string; method?: string } = {};
    const fetchMock = vi.fn(async (input: FetchInput, init?: RequestInit) => {
      captured.url = resolveFetchInputUrl(input);
      captured.method = init?.method;
      captured.body = typeof init?.body === "string" ? init.body : undefined;
      return Response.json({
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test",
        subscriptionId: "sub_om_1",
      });
    }) as unknown as FetchLike;

    const result = await makeClient(fetchMock).createBillingCheckout({
      planId: " plan_pro ",
      externalUserId: "user-abc",
      successUrl: "https://app.example/ok",
      cancelUrl: "https://app.example/cancel",
    });
    expect(captured.method).toBe("POST");
    expect(captured.url).toBe(
      "https://issuer.example/api/v1/apps/app_x/billing/checkout",
    );
    expect(JSON.parse(captured.body!)).toEqual({
      planId: "plan_pro",
      externalUserId: "user-abc",
      successUrl: "https://app.example/ok",
      cancelUrl: "https://app.example/cancel",
    });
    expect(result).toEqual({
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test",
      subscriptionId: "sub_om_1",
    });
  });

  it("createBillingCheckout rejects blank planId", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ checkoutUrl: "https://checkout.stripe.com/c/pay/x" }),
    ) as unknown as FetchLike;
    await expect(
      makeClient(fetchMock).createBillingCheckout({
        planId: "  ",
        externalUserId: "user-1",
      }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("createBillingCheckout rejects missing checkoutUrl", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ subscriptionId: "sub_only" }),
    ) as unknown as FetchLike;
    await expect(
      makeClient(fetchMock).createBillingCheckout({
        planId: "plan_pro",
        externalUserId: "user-1",
      }),
    ).rejects.toMatchObject({ status: 502, code: "invalid_response" });
  });

  it("grantUserAllowance maps legacy credit fields", async () => {
    const captured: { url?: string; body?: string } = {};
    const fetchMock = vi.fn(async (input: FetchInput, init?: RequestInit) => {
      captured.url = resolveFetchInputUrl(input);
      captured.body = typeof init?.body === "string" ? init.body : undefined;
      return Response.json({
        externalUserId: "user-1",
        balanceUsdMicros: "2000000",
        hasAccess: true,
      });
    }) as unknown as FetchLike;

    await makeClient(fetchMock).grantUserAllowance("user-1", {
      amountUsdMicros: "500000",
      source: "manual",
    });
    expect(captured.url).toContain("/allowances");
  });
});
