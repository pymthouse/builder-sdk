/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import {
  computeSignerSessionExpiry,
  decodeJwtExp,
  isLikelyOidcJwt,
  isOpaqueSignerSessionToken,
  parseSignerSessionExchange,
  SIGNER_SESSION_TTL_MS,
} from "../src/tokens.js";

describe("tokens", () => {
  it("computeSignerSessionExpiry adds TTL to createdAt", () => {
    const created = new Date("2026-01-01T00:00:00.000Z");
    const exp = computeSignerSessionExpiry(created);
    expect(exp.getTime() - created.getTime()).toBe(SIGNER_SESSION_TTL_MS);
  });

  it("isLikelyOidcJwt detects JWT shape", () => {
    expect(isLikelyOidcJwt("eyJhbGciOiJIUzI1NiJ9.e30.sig")).toBe(true);
    expect(isLikelyOidcJwt("pmth_opaque")).toBe(false);
    expect(isOpaqueSignerSessionToken("pmth_opaque")).toBe(true);
  });

  it("decodeJwtExp reads exp without verifying signature", () => {
    let payload = Buffer.from(JSON.stringify({ exp: 1_700_000_000 }), "utf8")
      .toString("base64")
      .replaceAll("+", "-")
      .replaceAll("/", "_");
    while (payload.endsWith("=")) {
      payload = payload.slice(0, -1);
    }
    const jwt = `eyJhbGciOiJIUzI1NiJ9.${payload}.sig`;
    expect(decodeJwtExp(jwt)?.getTime()).toBe(1_700_000_000_000);
  });

  it("parseSignerSessionExchange rejects JWT access_token", () => {
    expect(() =>
      parseSignerSessionExchange({
        access_token: "eyJhbGciOiJIUzI1NiJ9.e30.sig",
        token_type: "Bearer",
        expires_in: 900,
        scope: "sign:job",
        issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
      }),
    ).toThrow(/opaque signer session/);
  });

  it("parseSignerSessionExchange normalizes opaque token", () => {
    const out = parseSignerSessionExchange({
      access_token: "pmth_testopaque",
      token_type: "Bearer",
      expires_in: 7776000,
      scope: "sign:job",
      issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
    });
    expect(out.accessToken).toBe("pmth_testopaque");
    expect(out.expiresIn).toBe(7776000);
  });

  it("parseSignerSessionExchange tolerates a missing issued_token_type", () => {
    const out = parseSignerSessionExchange({
      access_token: "pmth_no_issued_type",
      token_type: "Bearer",
      expires_in: 7776000,
      scope: "sign:job",
      // issued_token_type intentionally omitted: the documented gateway/opaque
      // exchange may not return it, and the parser must not hard-require it.
    });
    expect(out.accessToken).toBe("pmth_no_issued_type");
    expect(out.expiresIn).toBe(7776000);
    expect(out.scope).toBe("sign:job");
  });
});
