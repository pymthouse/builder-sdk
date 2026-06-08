/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import {
  authenticateWebhookCaller,
  authorizationFromWebhookPayload,
  handleRemoteSignerAuthorize,
  handleRemoteSignerRefreshJwks,
  identityFromWebhookClaims,
} from "../../src/signer/webhook/index.js";

const baseConfig = {
  webhookSecret: "signer-secret",
  jwtIssuer: "https://auth.test",
  jwtAudience: "livepeer",
  verifyEndUserToken: async (authorization: string) => {
    if (!authorization.includes("good-token")) {
      throw new Error("invalid token");
    }
    return {
      claims: {
        iss: "https://auth.test",
        client_id: "app-1",
        sub: "user-42",
        usage_subject_type: "external_user_id",
        exp: 4_102_444_800,
      },
      expiry: 4_102_444_800,
    };
  },
};

describe("identityFromWebhookClaims", () => {
  it("maps claims with azp fallback for Auth0", () => {
    const identity = identityFromWebhookClaims(
      {
        iss: "https://tenant.us.auth0.com/",
        azp: "public-client",
        sub: "auth0|user",
      },
      {
        claimClientId: "azp",
        claimUsageSubject: "sub",
        usageSubjectType: "auth0_user_id",
      },
    );
    expect(identity).toEqual({
      issuer: "https://tenant.us.auth0.com/",
      client_id: "public-client",
      usage_subject: "auth0|user",
      usage_subject_type: "auth0_user_id",
    });
  });
});

describe("authorizationFromWebhookPayload", () => {
  it("reads Authorization from go-livepeer headers map", () => {
    expect(
      authorizationFromWebhookPayload({
        headers: {
          Authorization: ["Bearer good-token"],
          "X-Request-Id": ["abc"],
        },
      }),
    ).toBe("Bearer good-token");
  });

  it("falls back to legacy authorization field", () => {
    expect(
      authorizationFromWebhookPayload({
        authorization: "Bearer legacy",
      }),
    ).toBe("Bearer legacy");
  });
});

describe("handleRemoteSignerAuthorize", () => {
  it("returns identity for a valid end-user token", async () => {
    const request = new Request("http://localhost/authorize", {
      method: "POST",
      headers: {
        Authorization: "Bearer signer-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        authorization: "Bearer good-token",
      }),
    });

    const response = await handleRemoteSignerAuthorize(request, baseConfig);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: number;
      identity: { usage_subject: string; client_id: string };
    };
    expect(body.status).toBe(200);
    expect(body.identity.usage_subject).toBe("user-42");
    expect(body.identity.client_id).toBe("app-1");
  });

  it("rejects missing authorization in webhook payload", async () => {
    const request = new Request("http://localhost/authorize", {
      method: "POST",
      headers: {
        Authorization: "Bearer signer-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const response = await handleRemoteSignerAuthorize(request, baseConfig);
    expect(response.status).toBe(400);
  });

  it("accepts authorization from headers-only go-livepeer payload", async () => {
    const request = new Request("http://localhost/authorize", {
      method: "POST",
      headers: {
        Authorization: "Bearer signer-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        headers: {
          Authorization: ["Bearer good-token"],
        },
        state: { StateID: "sess-1" },
      }),
    });

    const response = await handleRemoteSignerAuthorize(request, baseConfig);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: number };
    expect(body.status).toBe(200);
  });

  it("runs afterVerify gating and returns policy status", async () => {
    const request = new Request("http://localhost/authorize", {
      method: "POST",
      headers: {
        Authorization: "Bearer signer-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        headers: { Authorization: ["Bearer good-token"] },
      }),
    });

    const response = await handleRemoteSignerAuthorize(request, {
      ...baseConfig,
      afterVerify: async () => {
        throw new Error("out of balance");
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: number; reason: string };
    expect(body.status).toBe(403);
    expect(body.reason).toContain("out of balance");
  });

  it("rejects invalid end-user token with status 403 in body", async () => {
    const request = new Request("http://localhost/authorize", {
      method: "POST",
      headers: {
        Authorization: "Bearer signer-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        authorization: "Bearer bad-token",
      }),
    });

    const response = await handleRemoteSignerAuthorize(request, baseConfig);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: number; reason: string };
    expect(body.status).toBe(403);
    expect(body.reason).toContain("invalid token");
  });

  it("rejects unsigned webhook caller", async () => {
    const request = new Request("http://localhost/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authorization: "Bearer good-token",
      }),
    });

    expect(authenticateWebhookCaller(request, "signer-secret")).toBe(false);
    const response = await handleRemoteSignerAuthorize(request, baseConfig);
    expect(response.status).toBe(401);
  });
});

describe("handleRemoteSignerRefreshJwks", () => {
  it("requires webhook caller authentication", async () => {
    const request = new Request("http://localhost/admin/refresh-jwks", {
      method: "POST",
    });
    const response = await handleRemoteSignerRefreshJwks(request, baseConfig);
    expect(response.status).toBe(401);
  });
});
