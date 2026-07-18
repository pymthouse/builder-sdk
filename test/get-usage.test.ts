/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { PmtHouseClient } from "../src/client.js";
import type { FetchLike } from "../src/types.js";

function makeClient(fetchImpl: FetchLike) {
  return new PmtHouseClient({
    issuerUrl: "https://issuer.example/api/v1/oidc",
    publicClientId: "app_x",
    m2mClientId: "m2m_x",
    m2mClientSecret: "secret",
    fetch: fetchImpl,
  });
}

const emptyUsageBody = {
  clientId: "app_x",
  period: { start: "2026-01-01", end: "2026-01-31" },
  totals: { requestCount: 0 },
  byUser: [
    {
      endUserId: "u1",
      externalUserId: "u1",
      requestCount: 2,
      networkFeeUsdMicros: "100",
      ownerChargeUsdMicros: "100",
      endUserBillableUsdMicros: "100",
      currency: "USD",
    },
  ],
  byPipelineModel: [],
  byDailyPipeline: [],
};

describe("PmtHouseClient.getUsage", () => {
  it("includes gatewayRequestId as a query param on the outgoing request", async () => {
    const captured: { url?: string } = {};
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      captured.url = typeof input === "string" ? input : (input as URL | Request).toString();
      return new Response(JSON.stringify(emptyUsageBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as FetchLike;

    const client = makeClient(fetchMock);
    await client.getUsage({
      groupBy: "pipeline_model",
      startDate: "2026-01-01",
      endDate: "2026-01-02",
      userId: "u1",
      gatewayRequestId: "abc123",
    });

    expect(captured.url).toBeDefined();
    const parsed = new URL(captured.url!);
    expect(parsed.pathname).toBe("/api/v1/apps/app_x/usage");
    expect(parsed.searchParams.get("gatewayRequestId")).toBe("abc123");
    expect(parsed.searchParams.get("groupBy")).toBe("pipeline_model");
    expect(parsed.searchParams.get("userId")).toBe("u1");
  });

  it("rejects email-shaped userId before calling the API", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("should not fetch");
    }) as unknown as FetchLike;
    const client = makeClient(fetchMock);
    await expect(
      client.getUsage({ userId: "a@b.co", groupBy: "user" }),
    ).rejects.toMatchObject({ code: "invalid_external_user_id" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("PmtHouseClient.fetchUsageForExternalUser", () => {
  it("prefers end-user usage routes after minting a user access token", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      urls.push(url);
      if (url.includes("/users") && !url.includes("/token") && (init?.method ?? "GET") === "POST") {
        return new Response(JSON.stringify({ id: "1", externalUserId: "u1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/token")) {
        return new Response(
          JSON.stringify({
            access_token: "user-jwt",
            refresh_token: "",
            token_type: "Bearer",
            expires_in: 3600,
            scope: "sign:job",
            subject_type: "app_user",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify(emptyUsageBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as FetchLike;

    const client = makeClient(fetchMock);
    await client.fetchUsageForExternalUser({
      externalUserId: "u1",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      includeRetail: true,
    });

    const usageUrls = urls.filter((url) => url.includes("/api/v1/user/usage"));
    expect(usageUrls).toHaveLength(3);
    for (const url of usageUrls) {
      const parsed = new URL(url);
      expect(parsed.pathname).toBe("/api/v1/user/usage");
      expect(parsed.searchParams.get("userId")).toBeNull();
    }
    expect(new URL(usageUrls[0]!).searchParams.get("groupBy")).toBe("user");
    expect(new URL(usageUrls[1]!).searchParams.get("groupBy")).toBe("pipeline_model");
    expect(new URL(usageUrls[2]!).searchParams.get("groupBy")).toBe("daily_pipeline");
  });

  it("falls back to Builder M2M userId scoping when end-user mint fails", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as URL | Request).toString();
      urls.push(url);
      if (url.includes("/users") && (init?.method ?? "GET") === "POST") {
        return new Response(JSON.stringify({ error: "boom" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify(emptyUsageBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as FetchLike;

    const client = makeClient(fetchMock);
    await client.fetchUsageForExternalUser({
      externalUserId: "u1",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      includeRetail: true,
    });

    const builderUsage = urls.filter((url) => url.includes("/api/v1/apps/app_x/usage"));
    expect(builderUsage).toHaveLength(3);
    for (const url of builderUsage) {
      expect(new URL(url).searchParams.get("userId")).toBe("u1");
    }
  });
});
