import { describe, expect, it } from "vitest";
import {
  readGatewayConfigForRequest,
  requestOriginFromRequest,
  resolveGatewaySignerUrl,
} from "../src/gateway/server/config.js";

describe("gateway config", () => {
  it("uses request origin for signer when GATEWAY_SIGNER_FROM_REQUEST_ORIGIN=1", () => {
    const env = {
      GATEWAY_ENABLED: "1",
      GATEWAY_SIGNER_FROM_REQUEST_ORIGIN: "1",
      PYMTHOUSE_SIGNER_URL: "http://localhost:3001/api/signer",
    };
    const request = new Request("http://localhost:3000/api/gateway/sessions");
    expect(resolveGatewaySignerUrl(env, request)).toBe("http://localhost:3000/api/signer");
  });

  it("uses upstream signer when same-origin mode is off", () => {
    const env = {
      GATEWAY_SIGNER_FROM_REQUEST_ORIGIN: "0",
      PYMTHOUSE_SIGNER_URL: "https://pymthouse.com/api/signer",
    };
    const request = new Request("http://localhost:3000/api/gateway/sessions");
    expect(resolveGatewaySignerUrl(env, request)).toBe("https://pymthouse.com/api/signer");
  });

  it("readGatewayConfigForRequest preserves discovery settings", () => {
    const env = {
      GATEWAY_ENABLED: "1",
      GATEWAY_SIGNER_FROM_REQUEST_ORIGIN: "1",
      PYMTHOUSE_SIGNER_URL: "https://pymthouse.com/api/signer",
      LIVEPEER_DISCOVERY_SERVICE_URL: "https://discovery.example/v1/discovery/raw",
    };
    const request = new Request("http://localhost:3000/api/gateway/sessions", {
      headers: { host: "localhost:3000" },
    });
    const config = readGatewayConfigForRequest(request, env);
    expect(config).not.toBeNull();
    expect(config?.signerUrl).toBe("http://localhost:3000/api/signer");
    expect(config?.discoveryUrl).toBe(env.LIVEPEER_DISCOVERY_SERVICE_URL);
  });

  it("requestOriginFromRequest honors x-forwarded-host", () => {
    const request = new Request("http://127.0.0.1:3000/api/gateway/sessions", {
      headers: {
        "x-forwarded-host": "dashboard.example.com",
        "x-forwarded-proto": "https",
      },
    });
    expect(requestOriginFromRequest(request)).toBe("https://dashboard.example.com");
  });
});
