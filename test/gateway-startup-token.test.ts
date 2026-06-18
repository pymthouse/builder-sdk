import { describe, expect, it } from "vitest";
import {
  buildApiKeyGatewayStartupToken,
  encodeGatewayStartupToken,
} from "../src/gateway-startup-token.js";

describe("encodeGatewayStartupToken", () => {
  it("encodes standard base64 UTF-8 JSON", () => {
    const token = encodeGatewayStartupToken({
      signer: "https://signer.example",
      discovery: "https://discover.example/raw",
    });
    const decoded = JSON.parse(Buffer.from(token, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
    expect(decoded.signer).toBe("https://signer.example");
    expect(decoded.discovery).toBe("https://discover.example/raw");
  });
});

describe("buildApiKeyGatewayStartupToken", () => {
  it("builds Pattern A token without billing", () => {
    const token = buildApiKeyGatewayStartupToken({
      apiKey: "pmth_abc123",
      signerUrl: "https://signer.example",
      discoveryUrl: "https://discover.example/raw?serviceType=legacy",
    });
    const decoded = JSON.parse(Buffer.from(token, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
    expect(decoded.billing).toBeUndefined();
    expect(decoded.signer_headers).toEqual({
      Authorization: "Bearer pmth_abc123",
    });
  });

  it("builds Pattern B token with billing", () => {
    const token = buildApiKeyGatewayStartupToken({
      apiKey: "pmth_abc123",
      signerUrl: "https://signer.example",
      discoveryUrl: "https://discover.example/raw",
      billingUrl: "http://localhost:3001",
    });
    const decoded = JSON.parse(Buffer.from(token, "base64").toString("utf8")) as Record<
      string,
      unknown
    >;
    expect(decoded.billing).toBe("http://localhost:3001");
  });
});
