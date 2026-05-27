import { describe, expect, it, vi } from "vitest";

import { PmtHouseGatewayClient } from "../src/gateway/browser.js";

describe("PmtHouseGatewayClient", () => {
  it("starts a job through the proxy", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        job: { jobId: "abc", capability: "text-reversal", status: "running" },
        proxy: {
          controlUrl: "/pymthouse/gateway/jobs/abc/control",
          eventsUrl: "/pymthouse/gateway/jobs/abc/events",
          stopUrl: "/pymthouse/gateway/jobs/abc/stop",
          statusUrl: "/pymthouse/gateway/jobs/abc/status",
        },
      }),
    );

    const client = new PmtHouseGatewayClient({
      basePath: "/pymthouse/gateway",
      accessToken: "pmth_test",
      fetch: fetchImpl,
    });

    const started = await client.startJob({ capability: "text-reversal" });
    expect(started.job.jobId).toBe("abc");
    expect(fetchImpl).toHaveBeenCalledWith(
      "/pymthouse/gateway/jobs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer pmth_test",
        }),
      }),
    );
  });
});
