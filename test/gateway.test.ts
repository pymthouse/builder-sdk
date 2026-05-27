import { describe, expect, it } from "vitest";

import { buildCapabilities, capabilitiesToQuery, CapabilityId } from "../src/gateway/capabilities.js";
import { encodeGatewayToken, parseGatewayToken } from "../src/gateway/token-browser.js";
import { joinSignerEndpoint, resolveTranscoderHttpUrl } from "../src/gateway/http.js";
import { jobProxyPaths, normalizeBasePath } from "../src/gateway/job-session.js";

describe("gateway token", () => {
  it("round-trips encode and parse", () => {
    const token = encodeGatewayToken("https://billing.example.com", "jwt-token", "https://discover");
    const parsed = parseGatewayToken(token);
    expect(parsed.billing).toBe("https://billing.example.com");
    expect(parsed.billing_access_token).toBe("jwt-token");
    expect(parsed.discovery).toBe("https://discover");
  });
});

describe("gateway capabilities", () => {
  it("builds BYOC capability query values", () => {
    const caps = buildCapabilities(CapabilityId.BYOC, "text-reversal");
    expect(capabilitiesToQuery(caps)).toEqual(["byoc/text-reversal"]);
  });
});

describe("gateway http helpers", () => {
  it("joins signer endpoints preserving base path", () => {
    expect(joinSignerEndpoint("https://example.com/api/signer", "/sign-byoc-job")).toBe(
      "https://example.com/api/signer/sign-byoc-job",
    );
  });

  it("resolves transcoder-relative paths", () => {
    expect(resolveTranscoderHttpUrl("https://orch:8935", "/ai/stream/start")).toBe(
      "https://orch:8935/ai/stream/start",
    );
  });
});

describe("gateway proxy paths", () => {
  it("normalizes base path and builds job URLs", () => {
    const base = normalizeBasePath("pymthouse/gateway");
    expect(base).toBe("/pymthouse/gateway");
    const paths = jobProxyPaths(base, "job-123");
    expect(paths.eventsUrl).toBe("/pymthouse/gateway/jobs/job-123/events");
    expect(paths.wsUrl).toBe("/pymthouse/gateway/ws/job-123");
  });
});
