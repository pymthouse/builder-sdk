/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import {
  ingestSignedTicket,
  signerSnapshotToIngestPayload,
} from "../src/ingest.js";
import { resolveFetchInputUrl } from "./fetch-url.js";

describe("signerSnapshotToIngestPayload", () => {
  it("maps signer usage block to ingest body", () => {
    const payload = signerSnapshotToIngestPayload({
      externalUserId: "user-1",
      gatewayRequestId: "job-1",
      snapshot: {
        requestId: "req-1",
        computedFeeWei: "1000",
        computedFeeUsdMicros: 500n,
        pipeline: "live-video-to-video",
        modelId: "model-a",
      },
    });
    expect(payload).toEqual({
      requestId: "req-1",
      externalUserId: "user-1",
      networkFeeUsdMicros: "500",
      feeWei: "1000",
      pixels: undefined,
      pipeline: "live-video-to-video",
      modelId: "model-a",
      gatewayRequestId: "job-1",
      ethUsdPrice: undefined,
      ethUsdRoundId: undefined,
      ethUsdObservedAt: undefined,
    });
  });
});

describe("ingestSignedTicket", () => {
  it("POSTs ticket to Builder API", async () => {
    let calledUrl = "";
    let calledMethod = "";
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        calledUrl = resolveFetchInputUrl(input);
        calledMethod = init?.method ?? "";
        return Response.json({
          ingested: true,
          duplicate: false,
          source: "openmeter",
        });
      },
    );
    const result = await ingestSignedTicket({
      issuerUrl: "https://issuer.example/api/v1/oidc",
      publicClientId: "app_x",
      m2mClientId: "m2m_x",
      m2mClientSecret: "secret",
      ticket: {
        requestId: "req-1",
        externalUserId: "user-1",
        networkFeeUsdMicros: "500",
      },
      fetch: fetchMock,
    });
    expect(result.ingested).toBe(true);
    expect(calledUrl).toContain("/api/v1/apps/app_x/usage/signed-tickets");
    expect(calledMethod).toBe("POST");
  });
});
