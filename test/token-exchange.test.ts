import { describe, expect, it } from "vitest";
import { tokenEndpointResponseToExchange } from "../src/oauth-map.js";

describe("tokenEndpointResponseToExchange", () => {
  it("accepts RFC 8693 access_token issued_token_type", () => {
    const tr = {
      access_token: "at",
      token_type: "bearer" as const,
      expires_in: 3600,
      scope: "sign:job",
      issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
    };
    const out = tokenEndpointResponseToExchange(tr);
    expect(out.issued_token_type).toBe("urn:ietf:params:oauth:token-type:access_token");
    expect(out.token_type).toBe("Bearer");
  });

  it("accepts remote signer issued_token_type", () => {
    const tr = {
      access_token: "pmth_x",
      token_type: "bearer" as const,
      expires_in: 86400,
      scope: "sign:job",
      issued_token_type: "urn:pmth:token-type:remote-signer-session",
    };
    const out = tokenEndpointResponseToExchange(tr);
    expect(out.access_token).toBe("pmth_x");
  });

  it("rejects unknown issued_token_type", () => {
    const tr = {
      access_token: "x",
      token_type: "bearer" as const,
      expires_in: 1,
      scope: "",
      issued_token_type: "urn:unknown:foo",
    };
    expect(() => tokenEndpointResponseToExchange(tr)).toThrow();
  });
});
