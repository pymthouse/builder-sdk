import { describe, expect, it } from "vitest";
import { extractBearerToken } from "../src/gateway/server/auth.js";
import { hashBearerToken } from "../src/gateway/server/session-store.js";
import { modelCapabilityQuery } from "../src/gateway/server/capabilities.js";

describe("gateway auth", () => {
  it("extracts bearer token", () => {
    const request = new Request("https://example.com", {
      headers: { Authorization: "Bearer test-token-123" },
    });
    expect(extractBearerToken(request)).toBe("test-token-123");
  });

  it("returns null without authorization", () => {
    const request = new Request("https://example.com");
    expect(extractBearerToken(request)).toBeNull();
  });

  it("accepts bearer scheme case-insensitively", () => {
    const request = new Request("https://example.com", {
      headers: { Authorization: "bearer   spaced-token" },
    });
    expect(extractBearerToken(request)).toBe("spaced-token");
  });

  it("hashes bearer tokens deterministically", () => {
    expect(hashBearerToken("abc")).toBe(hashBearerToken("abc"));
    expect(hashBearerToken("abc")).not.toBe(hashBearerToken("def"));
  });
});

describe("gateway capabilities", () => {
  it("builds lv2v discovery cap", () => {
    expect(modelCapabilityQuery("streamdiffusion-sdxl")).toBe(
      "live-video-to-video/streamdiffusion-sdxl",
    );
  });
});
