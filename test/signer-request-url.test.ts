import { describe, expect, it } from "vitest";
import { signerRequestUrl } from "../src/gateway/server/http-insecure.js";

describe("signerRequestUrl", () => {
  it("keeps /api/signer prefix when base includes it", () => {
    expect(
      signerRequestUrl("http://localhost:3000/api/signer", "sign-orchestrator-info"),
    ).toBe("http://localhost:3000/api/signer/sign-orchestrator-info");
  });

  it("uses origin root when base is host-only", () => {
    expect(signerRequestUrl("https://pymthouse.com", "generate-live-payment")).toBe(
      "https://pymthouse.com/generate-live-payment",
    );
  });

  it("uses origin root for pymthouse-style base with rewrites", () => {
    expect(
      signerRequestUrl("https://pymthouse.com/api/signer", "discover-orchestrators"),
    ).toBe("https://pymthouse.com/api/signer/discover-orchestrators");
  });
});
