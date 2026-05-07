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

describe("PmtHouseClient.getUsage", () => {
  it("includes gatewayRequestId as a query param on the outgoing request", async () => {
    const captured: { url?: string } = {};
    const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      captured.url = typeof input === "string" ? input : (input as URL | Request).toString();
      return new Response(
        JSON.stringify({
          clientId: "app_x",
          period: { start: null, end: null },
          totals: { requestCount: 0, totalFeeWei: "0" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
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
});
