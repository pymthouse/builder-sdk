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
          meteringMode: "hosted_ingest",
        },
        patterns: {},
      }),
    ) as unknown as FetchLike;

    const routing = await makeClient(fetchMock).getSignerRouting();
    expect(routing.routing.meteringMode).toBe("hosted_ingest");
  });
});
