/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import {
  decodeJwtPayload,
  forwardDirectSignerRequest,
  identityFromJwtPayload,
  livepeerIdentityHeaders,
} from "../../src/signer/forward.js";

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8")
    .toString("base64url")
    .replaceAll("=", "");
  const body = Buffer.from(JSON.stringify(payload), "utf8")
    .toString("base64url")
    .replaceAll("=", "");
  return `${header}.${body}.sig`;
}

describe("forwardDirectSignerRequest", () => {
  it("maps JWT identity claims to X-Livepeer headers", () => {
    const payload = {
      iss: "https://pymthouse.example/api/v1/oidc",
      client_id: "app_pub",
      external_user_id: "user:123",
      external_user_id_type: "external_user_id",
    };
    const identity = identityFromJwtPayload(payload);
    expect(livepeerIdentityHeaders(identity)).toEqual({
      "X-Livepeer-Usage-Issuer": "https://pymthouse.example/api/v1/oidc",
      "X-Livepeer-Client-ID": "app_pub",
      "X-Livepeer-Usage-Subject": "user:123",
      "X-Livepeer-Usage-Subject-Type": "external_user_id",
    });
    expect(decodeJwtPayload(makeJwt(payload))).toMatchObject(payload);
  });

  it("forwards the request with Bearer auth and identity headers", async () => {
    const jwt = makeJwt({
      iss: "https://pymthouse.example/api/v1/oidc",
      client_id: "app_pub",
      external_user_id: "user:9",
      usage_subject_type: "external_user_id",
    });

    const seen: { url: string; headers: Headers; method: string; body: string }[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      seen.push({
        url: request.url,
        headers: request.headers,
        method: request.method,
        body: await request.text(),
      });
      return new Response("ok", { status: 200 });
    };

    const response = await forwardDirectSignerRequest({
      request: new Request("https://platform.example/api/signer/proxy/generate-live-payment?x=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      }),
      remoteSignerUrl: "https://signer.example/",
      jwt,
      proxyPathPrefix: "/api/signer/proxy",
      fetch: fetchImpl,
    });

    expect(response.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://signer.example/generate-live-payment?x=1");
    expect(seen[0].method).toBe("POST");
    expect(seen[0].headers.get("Authorization")).toBe(`Bearer ${jwt}`);
    expect(seen[0].headers.get("X-Livepeer-Client-ID")).toBe("app_pub");
    expect(seen[0].headers.get("X-Livepeer-Usage-Subject")).toBe("user:9");
    expect(seen[0].body).toBe(JSON.stringify({ hello: "world" }));
  });
});
