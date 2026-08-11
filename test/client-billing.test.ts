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

  it("getBillingState GETs billing/state scoped to the external user", async () => {
    const captured: { url?: string } = {};
    const fetchMock = vi.fn(async (input: FetchInput) => {
      captured.url = resolveFetchInputUrl(input);
      return Response.json({
        status: "overage",
        canSpend: true,
        reason: null,
      });
    }) as unknown as FetchLike;

    const state = await makeClient(fetchMock).getBillingState("user-1");
    const url = new URL(captured.url!);
    expect(url.pathname).toContain("/billing/state");
    expect(url.searchParams.get("externalUserId")).toBe("user-1");
    expect(state.status).toBe("overage");
  });

  it("getBillingState omits externalUserId for owner rollup apps", async () => {
    const captured: { url?: string } = {};
    const fetchMock = vi.fn(async (input: FetchInput) => {
      captured.url = resolveFetchInputUrl(input);
      return Response.json({ status: "active", canSpend: true, reason: null });
    }) as unknown as FetchLike;

    await makeClient(fetchMock).getBillingState();
    expect(new URL(captured.url!).searchParams.has("externalUserId")).toBe(false);
  });

  it("collectBilling POSTs billing/collect and returns the refreshed state", async () => {
    const captured: { url?: string; body?: string; method?: string } = {};
    const fetchMock = vi.fn(async (input: FetchInput, init?: RequestInit) => {
      captured.url = resolveFetchInputUrl(input);
      captured.method = init?.method;
      captured.body = typeof init?.body === "string" ? init.body : undefined;
      return Response.json({
        outcome: "invoiced",
        invoiceIds: ["inv_1"],
        billingState: { status: "at_risk", canSpend: true, reason: null },
      });
    }) as unknown as FetchLike;

    const result = await makeClient(fetchMock).collectBilling("user-1");
    expect(captured.method).toBe("POST");
    expect(captured.url).toContain("/billing/collect");
    expect(JSON.parse(captured.body!)).toEqual({ externalUserId: "user-1" });
    expect(result.outcome).toBe("invoiced");
    expect(result.invoiceIds).toEqual(["inv_1"]);
    expect(result.billingState.status).toBe("at_risk");
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

  it("listUserSubscriptions hits users subscriptions path", async () => {
    const captured: { url?: string } = {};
    const fetchMock = vi.fn(async (input: FetchInput) => {
      captured.url = resolveFetchInputUrl(input);
      return Response.json({
        items: [
          {
            id: "sub_1",
            status: "active",
            current: true,
            planId: "plan_1",
            planName: "Starter",
            planKey: "starter",
            openmeterPlanId: "om_1",
            activeFrom: "2026-08-11T00:00:00.000Z",
            activeTo: null,
          },
        ],
        externalUserId: "user-1",
      });
    }) as unknown as FetchLike;

    const result = await makeClient(fetchMock).listUserSubscriptions("user-1");
    expect(captured.url).toContain("/apps/app_x/users/user-1/subscriptions");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.current).toBe(true);
  });

  it("listUserInvoices hits users invoices path", async () => {
    const captured: { url?: string } = {};
    const fetchMock = vi.fn(async (input: FetchInput) => {
      captured.url = resolveFetchInputUrl(input);
      return Response.json({
        items: [{ id: "inv_1", status: "paid", currency: "USD", totalAmount: "0" }],
        page: 1,
        pageSize: 20,
        totalCount: 1,
      });
    }) as unknown as FetchLike;

    const result = await makeClient(fetchMock).listUserInvoices("user-1", {
      page: 2,
      pageSize: 10,
    });
    expect(captured.url).toContain(
      "/apps/app_x/users/user-1/invoices?page=2&pageSize=10",
    );
    expect(result.totalCount).toBe(1);
  });

  it("getUserInvoiceHostedUrl encodes invoice id", async () => {
    const captured: { url?: string } = {};
    const fetchMock = vi.fn(async (input: FetchInput) => {
      captured.url = resolveFetchInputUrl(input);
      return Response.json({
        hostedInvoiceUrl: "https://invoice.stripe.com/i/x",
        invoicePdf: null,
      });
    }) as unknown as FetchLike;

    await makeClient(fetchMock).getUserInvoiceHostedUrl("user-1", "inv/1");
    expect(captured.url).toContain(
      "/apps/app_x/users/user-1/invoices/inv%2F1/hosted-url",
    );
  });

  it("listUserPaymentMethods and createUserPaymentMethodCheckout", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: FetchInput, init?: RequestInit) => {
      const url = resolveFetchInputUrl(input);
      urls.push(`${init?.method ?? "GET"} ${url}`);
      if ((init?.method ?? "GET") === "GET") {
        return Response.json({
          paymentMethods: [
            {
              id: "pm_1",
              type: "card",
              brand: "visa",
              last4: "4242",
              expMonth: 12,
              expYear: 2030,
              isDefault: true,
            },
          ],
        });
      }
      return Response.json({
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_pm",
        sessionId: "cs_pm",
        customerId: "cus_1",
        hasDefaultPaymentMethod: false,
      });
    }) as unknown as FetchLike;

    const client = makeClient(fetchMock);
    const listed = await client.listUserPaymentMethods("user-1");
    expect(listed.paymentMethods[0]?.last4).toBe("4242");

    const checkout = await client.createUserPaymentMethodCheckout({
      externalUserId: "user-1",
      successUrl: "https://app.example/settings?tab=billing&checkout=success",
    });
    expect(checkout.checkoutUrl).toContain("checkout.stripe.com");
    expect(
      urls.some((u) => u.includes("/users/user-1/payment-methods")),
    ).toBe(true);
  });

  it("cancelUserSubscription DELETE subscription with confirm", async () => {
    const captured: { url?: string; method?: string; body?: string } = {};
    const fetchMock = vi.fn(async (input: FetchInput, init?: RequestInit) => {
      captured.url = resolveFetchInputUrl(input);
      captured.method = init?.method;
      captured.body = typeof init?.body === "string" ? init.body : undefined;
      return Response.json({
        subscriptionId: "sub_1",
        planId: "plan_1",
        planKey: "plan_key",
        scheduledPlanKey: "starter_key",
        effectiveAt: "2026-09-01T00:00:00.000Z",
      });
    }) as unknown as FetchLike;

    const result = await makeClient(fetchMock).cancelUserSubscription("user-1");
    expect(captured.method).toBe("DELETE");
    expect(captured.url).toContain("/users/user-1/subscription");
    expect(captured.url).not.toContain("pending-change");
    expect(JSON.parse(captured.body!)).toEqual({ confirm: true });
    expect(result.subscriptionId).toBe("sub_1");
  });

  it("resumeUserSubscription DELETE pending-change with confirm", async () => {
    const captured: { url?: string; method?: string; body?: string } = {};
    const fetchMock = vi.fn(async (input: FetchInput, init?: RequestInit) => {
      captured.url = resolveFetchInputUrl(input);
      captured.method = init?.method;
      captured.body = typeof init?.body === "string" ? init.body : undefined;
      return Response.json({
        resumed: true,
        subscriptionId: "sub_1",
        planId: "plan_1",
        planKey: "plan_key",
      });
    }) as unknown as FetchLike;

    const result = await makeClient(fetchMock).resumeUserSubscription("user-1");
    expect(captured.method).toBe("DELETE");
    expect(captured.url).toContain("/users/user-1/subscription/pending-change");
    expect(JSON.parse(captured.body!)).toEqual({ confirm: true });
    expect(result.resumed).toBe(true);
  });

  it("resumeUserSubscription surfaces the upstream machine-readable code", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: "No scheduled cancellation to undo", code: "nothing_to_resume" },
        { status: 404 },
      ),
    ) as unknown as FetchLike;

    await expect(
      makeClient(fetchMock).resumeUserSubscription("user-1"),
    ).rejects.toMatchObject({
      status: 404,
      code: "nothing_to_resume",
      message: "No scheduled cancellation to undo",
    });
  });

  it("marks responses without an upstream code as pymthouse_http_error", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ error: "No scheduled cancellation to undo" }, { status: 404 }),
    ) as unknown as FetchLike;

    await expect(
      makeClient(fetchMock).resumeUserSubscription("user-1"),
    ).rejects.toMatchObject({
      status: 404,
      code: "pymthouse_http_error",
      message: "No scheduled cancellation to undo",
      details: { error: "No scheduled cancellation to undo" },
    });
  });

  it("getUsageBalance still provisions on an OAuth-shaped not_found mint failure", async () => {
    const urls: string[] = [];
    let minted = false;
    const fetchMock = vi.fn(async (input: FetchInput, init?: RequestInit) => {
      const url = resolveFetchInputUrl(input);
      urls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/token")) {
        if (!minted) {
          minted = true;
          return Response.json({ error: "not_found" }, { status: 404 });
        }
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
        consumedUsdMicros: "0",
        lifetimeGrantedUsdMicros: "5000000",
        hasAccess: true,
        remainingUsdMicros: "5000000",
      });
    }) as unknown as FetchLike;

    const balance = await makeClient(fetchMock).getUsageBalance("user-1");
    expect(urls).toContain("POST https://issuer.example/api/v1/apps/app_x/users");
    expect(balance.balanceUsdMicros).toBe("5000000");
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
