/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import { forwardToSigner } from "../../src/signer/proxy.js";

function createAuthCapturingFetch(): {
  fetch: typeof fetch;
  getSeenAuth: () => string | null;
} {
  let seenAuth: string | null = null;
  const fetchImpl: typeof fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    seenAuth = headers.get("Authorization");
    return new Response("{}", { status: 200 });
  };
  return { fetch: fetchImpl, getSeenAuth: () => seenAuth };
}

describe("forwardToSigner authorization", () => {
  it("passes explicit authorization through unchanged (non-Bearer schemes)", async () => {
    const cases = [
      "Basic dXNlcjpwYXNz",
      "Token abc123",
      "Bearer already-prefixed",
      "Digest username=\"user\"",
    ];

    for (const authorization of cases) {
      const { fetch: fetchImpl, getSeenAuth } = createAuthCapturingFetch();

      await forwardToSigner({
        baseUrl: "http://127.0.0.1:8080",
        path: "/status",
        method: "GET",
        subject: "probe",
        authorization,
        forwardJwt: true,
        getDmzToken: async () => {
          throw new Error("should not mint DMZ token when authorization is set");
        },
        fetch: fetchImpl,
      });

      expect(getSeenAuth()).toBe(authorization);
    }
  });

  it("mints Bearer DMZ JWT when authorization is omitted", async () => {
    const { fetch: fetchImpl, getSeenAuth } = createAuthCapturingFetch();

    await forwardToSigner({
      baseUrl: "http://127.0.0.1:8080",
      path: "/status",
      method: "GET",
      subject: "probe",
      getDmzToken: async () => "dmz-jwt-token",
      fetch: fetchImpl,
    });

    expect(getSeenAuth()).toBe("Bearer dmz-jwt-token");
  });
});
