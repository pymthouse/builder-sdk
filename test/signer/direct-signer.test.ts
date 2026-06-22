/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import {
  assertDirectSignerBaseUrl,
  DIRECT_SIGNER_PATHS,
  signerEndpointUrl,
  signerUrlFromExchangeResponse,
} from "../../src/signer/direct-signer.js";
import { PmtHouseError } from "../../src/errors.js";

describe("direct signer helpers", () => {
  it("builds signer endpoint URLs from a DMZ base", () => {
    expect(
      signerEndpointUrl(
        "https://signer.example",
        DIRECT_SIGNER_PATHS.signOrchestratorInfo,
      ),
    ).toBe("https://signer.example/sign-orchestrator-info");
    expect(signerEndpointUrl("https://signer.example/", "/generate-live-payment")).toBe(
      "https://signer.example/generate-live-payment",
    );
  });

  it("reads signerUrl from exchange responses", () => {
    expect(signerUrlFromExchangeResponse({ signerUrl: " https://signer.example " })).toBe(
      "https://signer.example",
    );
    expect(signerUrlFromExchangeResponse({})).toBeUndefined();
  });

  it("rejects dashboard signer proxy paths", () => {
    expect(() =>
      assertDirectSignerBaseUrl(
        "https://dashboard.example.com/api/signer/sign-orchestrator-info",
      ),
    ).toThrow(PmtHouseError);
    expect(() =>
      assertDirectSignerBaseUrl(
        "https://dashboard.example.com/api/signer/some-other-route",
      ),
    ).toThrow(PmtHouseError);
    expect(() =>
      assertDirectSignerBaseUrl("https://pymthouse.example/api/signer"),
    ).toThrow(PmtHouseError);
    expect(() =>
      assertDirectSignerBaseUrl("https://pymthouse.example/api/signer/"),
    ).toThrow(PmtHouseError);
    expect(() => assertDirectSignerBaseUrl("not-a-url")).toThrow(PmtHouseError);
    expect(() => assertDirectSignerBaseUrl("https://signer.example")).not.toThrow();
    expect(() =>
      assertDirectSignerBaseUrl("https://signer.example/sign-orchestrator-info"),
    ).not.toThrow();
  });
});
