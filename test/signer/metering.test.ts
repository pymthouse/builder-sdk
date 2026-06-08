/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { forwardWithOptionalMetering } from "../../src/signer/metering.js";

describe("forwardWithOptionalMetering", () => {
  it("strips usage and POSTs ingest when pymthouse_hosted", async () => {
    const ingestFetch = vi.fn(async () =>
      Response.json({ ingested: true, duplicate: false, source: "openmeter" }),
    );

    const upstreamBody = {
      ticket: "signed",
      usage: {
        request_id: "req-1",
        computed_fee_wei: "1000",
        computed_fee_usd_micros: "500",
      },
    };

    const response = await forwardWithOptionalMetering({
      config: {
        pymthouseIssuerUrl: "https://issuer.example/api/v1/oidc",
        pymthouseClientId: "app_x",
        pymthouseM2MClientId: "m2m_x",
        pymthouseM2MClientSecret: "secret",
        remoteSignerUrl: "http://signer.example",
        metering: { mode: "pymthouse_hosted" },
        authenticate: async () => ({}),
        resolveExternalUserId: async () => "user-1",
        fetch: ingestFetch,
      },
      publicClientId: "app_x",
      externalUserId: "user-1",
      forward: async () =>
        new Response(JSON.stringify(upstreamBody), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.usage).toBeUndefined();
    expect(ingestFetch).toHaveBeenCalled();
  });

  it("does not ingest when platform_ingest", async () => {
    const ingestFetch = vi.fn();
    const upstreamBody = {
      usage: {
        request_id: "req-1",
        computed_fee_wei: "1000",
        computed_fee_usd_micros: "500",
      },
    };

    const response = await forwardWithOptionalMetering({
      config: {
        pymthouseIssuerUrl: "https://issuer.example/api/v1/oidc",
        pymthouseClientId: "app_x",
        pymthouseM2MClientId: "m2m_x",
        pymthouseM2MClientSecret: "secret",
        remoteSignerUrl: "http://signer.example",
        metering: { mode: "platform_ingest" },
        authenticate: async () => ({}),
        resolveExternalUserId: async () => "user-1",
        fetch: ingestFetch,
      },
      publicClientId: "app_x",
      externalUserId: "user-1",
      forward: async () =>
        new Response(JSON.stringify(upstreamBody), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });

    expect(ingestFetch).not.toHaveBeenCalled();
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.usage).toBeDefined();
  });
});
