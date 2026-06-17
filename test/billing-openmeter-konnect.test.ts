import { describe, expect, it, vi } from "vitest";
import { shouldUseKonnectRoutes } from "../src/billing/openmeter/konnect/constants.js";
import { createKonnectFetch } from "../src/billing/openmeter/konnect/fetch.js";
import {
  normalizeKonnectListResponse,
  normalizeKonnectSubscriptionRecord,
  rewriteKonnectPathname,
  rewriteKonnectRequestBody,
  rewriteKonnectRequestUrl,
} from "../src/billing/openmeter/konnect/routes.js";

const KONNECT_BASE = "https://us.api.konghq.com/v3/openmeter";

describe("shouldUseKonnectRoutes", () => {
  it("detects konghq URLs and kpat keys", () => {
    expect(shouldUseKonnectRoutes("https://us.api.konghq.com/v3/openmeter")).toBe(true);
    expect(shouldUseKonnectRoutes("http://127.0.0.1:48888", "kpat_abc")).toBe(true);
    expect(shouldUseKonnectRoutes("https://openmeter.cloud", "om_abc")).toBe(false);
  });
});

describe("rewriteKonnectPathname", () => {
  it("strips api version prefix", () => {
    expect(rewriteKonnectPathname("/v3/openmeter/api/v1/customers", "POST")).toBe(
      "/v3/openmeter/customers",
    );
  });
});

describe("rewriteKonnectRequestUrl", () => {
  it("maps customer subscriptions to filtered list", () => {
    const url = new URL(
      `${KONNECT_BASE}/api/v1/customers/cust_1/subscriptions?pageSize=100`,
    );
    const rewritten = rewriteKonnectRequestUrl(url, "GET");
    expect(rewritten.pathname).toBe("/v3/openmeter/subscriptions");
    expect(rewritten.searchParams.get("filter[customer_id][eq]")).toBe("cust_1");
    expect(rewritten.searchParams.get("page[size]")).toBe("100");
  });

  it("maps customer key filter", () => {
    const url = new URL(`${KONNECT_BASE}/api/v1/customers?key=app:auth0|u&page=1&pageSize=100`);
    const rewritten = rewriteKonnectRequestUrl(url, "GET");
    expect(rewritten.searchParams.get("filter[key][eq]")).toBe("app:auth0|u");
    expect(rewritten.searchParams.get("page[number]")).toBe("1");
    expect(rewritten.searchParams.get("page[size]")).toBe("100");
  });
});

describe("rewriteKonnectRequestBody", () => {
  it("maps customerId to nested customer for subscription create", () => {
    const rewritten = rewriteKonnectRequestBody(
      "/v3/openmeter/api/v1/subscriptions",
      "POST",
      {
        customerId: "cust_1",
        plan: { key: "starter" },
      },
    ) as { customer: { id: string }; plan: { key: string }; customerId?: string };

    expect(rewritten.customer).toEqual({ id: "cust_1" });
    expect(rewritten.plan.key).toBe("starter");
    expect(rewritten.customerId).toBeUndefined();
  });
});

describe("normalizeKonnectListResponse", () => {
  it("maps data to items", () => {
    const normalized = normalizeKonnectListResponse({
      data: [{ id: "1" }],
    }) as { items: Array<{ id: string }> };
    expect(normalized.items[0]?.id).toBe("1");
  });
});

describe("normalizeKonnectSubscriptionRecord", () => {
  it("maps plan_id to plan.id", () => {
    const normalized = normalizeKonnectSubscriptionRecord({
      id: "sub_1",
      status: "active",
      plan_id: "plan_1",
    }) as { plan?: { id?: string }; plan_id?: string };
    expect(normalized.plan?.id).toBe("plan_1");
    expect(normalized.plan_id).toBeUndefined();
  });
});

describe("createKonnectFetch", () => {
  it("blocks requests to non-metering origins", async () => {
    const konnectFetch = createKonnectFetch(KONNECT_BASE);
    await expect(
      konnectFetch("https://evil.example.com/v3/openmeter/customers", { method: "GET" }),
    ).rejects.toThrow(/unexpected origin/);
  });

  it("rewrites SDK customer list paths on the configured origin", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const konnectFetch = createKonnectFetch(KONNECT_BASE);
    await konnectFetch(`${KONNECT_BASE}/api/v1/customers?key=app:u`, { method: "GET" });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const calledUrl = new URL(fetchSpy.mock.calls[0][0] as string);
    expect(calledUrl.origin).toBe("https://us.api.konghq.com");
    expect(calledUrl.pathname).toBe("/v3/openmeter/customers");
    expect(calledUrl.searchParams.get("filter[key][eq]")).toBe("app:u");

    vi.unstubAllGlobals();
  });
});
