/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import {
  authenticateWebhookCaller,
  authorizationFromWebhookPayload,
  createApiKeyEndUserVerifier,
  createFirstMatchEndUserVerifier,
  createOidcRemoteSignerWebhookConfig,
  handleRemoteSignerAuthorize,
  handleRemoteSignerRefreshJwks,
  identityFromWebhookClaims,
  insufficientBalanceError,
  routeRemoteSignerWebhookRequest,
  type EndUserAuthVerifyContext,
  type RemoteSignerWebhookConfig,
} from "../../src/signer/webhook/index.js";
import {
  defaultSignerWebhookJwtAudience,
  readOidcRemoteSignerWebhookConfigFromEnv,
} from "../../src/signer/webhook/adapters/oidc/config.js";

function customWebhookConfig(
  verify: (context: EndUserAuthVerifyContext) => Promise<{
    identity: {
      issuer: string;
      client_id: string;
      usage_subject: string;
      usage_subject_type: string;
    };
    expiry: number;
  }>,
  afterVerify?: RemoteSignerWebhookConfig["afterVerify"],
): RemoteSignerWebhookConfig {
  return {
    webhookSecret: "signer-secret",
    endUserAuth: {
      kind: "custom",
      verify,
    },
    afterVerify,
  };
}

const baseConfig = customWebhookConfig(async ({ authorization }) => {
  if (!authorization.includes("good-token")) {
    throw new Error("invalid token");
  }
  return {
    identity: {
      issuer: "https://auth.test",
      client_id: "app-1",
      usage_subject: "user-42",
      usage_subject_type: "external_user_id",
    },
    expiry: 4_102_444_800,
  };
});

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

  it("matches headers case-insensitively", () => {
    expect(
      authorizationFromWebhookPayload({
        headers: {
          authorization: ["Bearer lower-case-key"],
        },
      }),
    ).toBe("Bearer lower-case-key");
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
      auth_id: string;
      identity: { usage_subject: string; client_id: string };
    };
    expect(body.status).toBe(200);
    expect(body.auth_id).toBe("app-1:user-42");
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
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: number };
    expect(body.status).toBe(403);
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

  it("passes full verify context to custom verifier", async () => {
    let captured: EndUserAuthVerifyContext | undefined;
    const config = customWebhookConfig(async (context) => {
      captured = context;
      return {
        identity: {
          issuer: "https://auth.test",
          client_id: "app-1",
          usage_subject: "user-42",
          usage_subject_type: "external_user_id",
        },
        expiry: 4_102_444_800,
      };
    });

    const request = new Request("http://localhost/authorize", {
      method: "POST",
      headers: {
        Authorization: "Bearer signer-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        headers: { Authorization: ["Bearer good-token"] },
        state: { StateID: "sess-1" },
      }),
    });

    await handleRemoteSignerAuthorize(request, config);
    expect(captured?.authorization).toBe("Bearer good-token");
    expect(captured?.payload.state).toEqual({ StateID: "sess-1" });
    expect(captured?.request).toBeInstanceOf(Request);
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
    const body = (await response.json()) as { status: number; reason: string; code?: string };
    expect(body.status).toBe(403);
    expect(body.reason).toContain("out of balance");
    expect(body.code).toBeUndefined();
  });

  it("returns status 483 and code for insufficient balance", async () => {
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
        throw insufficientBalanceError();
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: number; reason: string; code: string };
    expect(body.status).toBe(483);
    expect(body.reason).toBe("insufficient balance");
    expect(body.code).toBe("insufficient_balance");
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

describe("routeRemoteSignerWebhookRequest", () => {
  it("routes /admin/refresh-jwks when using OIDC verifier", async () => {
    const config = createOidcRemoteSignerWebhookConfig({
      webhookSecret: "signer-secret",
      jwtIssuer: "https://auth.test",
      jwtAudience: "livepeer",
    });

    const request = new Request("http://localhost/admin/refresh-jwks", {
      method: "POST",
    });
    const response = await routeRemoteSignerWebhookRequest(request, config);
    expect(response).not.toBeNull();
    expect(response?.status).toBe(401);
  });
});

describe("handleRemoteSignerRefreshJwks", () => {
  it("requires webhook caller authentication", async () => {
    const request = new Request("http://localhost/admin/refresh-jwks", {
      method: "POST",
    });
    const response = await handleRemoteSignerRefreshJwks(request, {
      webhookSecret: "signer-secret",
      jwtIssuer: "https://auth.test",
    });
    expect(response.status).toBe(401);
  });
});

describe("authenticateWebhookCaller", () => {
  it("accepts Authorization Bearer webhook secret", () => {
    const request = new Request("http://localhost/authorize", {
      method: "POST",
      headers: { Authorization: "Bearer signer-secret" },
    });
    expect(authenticateWebhookCaller(request, "signer-secret")).toBe(true);
  });

  it("accepts x-api-key webhook secret", () => {
    const request = new Request("http://localhost/authorize", {
      method: "POST",
      headers: { "x-api-key": "signer-secret" },
    });
    expect(authenticateWebhookCaller(request, "signer-secret")).toBe(true);
  });

  it("accepts legacy x-webhook-secret header (Daydream pipelines)", () => {
    const request = new Request("http://localhost/authorize", {
      method: "POST",
      headers: { "x-webhook-secret": "signer-secret" },
    });
    expect(authenticateWebhookCaller(request, "signer-secret")).toBe(true);
  });

  it("rejects mismatched legacy x-webhook-secret", () => {
    const request = new Request("http://localhost/authorize", {
      method: "POST",
      headers: { "x-webhook-secret": "wrong-secret" },
    });
    expect(authenticateWebhookCaller(request, "signer-secret")).toBe(false);
  });

  it("rejects Bearer tokens that differ by one character", () => {
    const request = new Request("http://localhost/authorize", {
      method: "POST",
      headers: { Authorization: "Bearer signer-secret" },
    });
    expect(authenticateWebhookCaller(request, "signer-secre")).toBe(false);
  });

  it("rejects non-Bearer Authorization schemes", () => {
    const request = new Request("http://localhost/authorize", {
      method: "POST",
      headers: { Authorization: "Basic signer-secret" },
    });
    expect(authenticateWebhookCaller(request, "signer-secret")).toBe(false);
  });
});

describe("createApiKeyEndUserVerifier", () => {
  it("resolves sk_ keys to Clerk identity dimensions", async () => {
    const verifier = createApiKeyEndUserVerifier({
      issuer: "https://api.daydream.live",
      resolveApiKey: async (apiKey) => {
        if (apiKey === "sk_live_test") {
          return { userId: "user_clerk_123" };
        }
        return null;
      },
    });

    const verified = await verifier.verify({
      authorization: "Bearer sk_live_test",
      payload: { headers: { Authorization: ["Bearer sk_live_test"] } },
      request: new Request("http://localhost/authorize"),
    });

    expect(verified.identity).toEqual({
      issuer: "https://api.daydream.live",
      client_id: "daydream-scope",
      usage_subject: "user_clerk_123",
      usage_subject_type: "clerk_user_id",
    });
    expect(verified.expiry).toBeGreaterThan(Math.trunc(Date.now() / 1000));
  });

  it("rejects invalid api key prefix", async () => {
    const verifier = createApiKeyEndUserVerifier({
      issuer: "https://api.daydream.live",
      resolveApiKey: async () => ({ userId: "user-1" }),
    });

    await expect(
      verifier.verify({
        authorization: "Bearer lp_wrong_prefix",
        payload: {},
        request: new Request("http://localhost/authorize"),
      }),
    ).rejects.toThrow("invalid api key");
  });

  it("rejects unknown api key", async () => {
    const verifier = createApiKeyEndUserVerifier({
      issuer: "https://api.daydream.live",
      resolveApiKey: async () => null,
    });

    await expect(
      verifier.verify({
        authorization: "Bearer sk_unknown",
        payload: {},
        request: new Request("http://localhost/authorize"),
      }),
    ).rejects.toThrow("invalid api key");
  });

  it("reports kind 'api_key' so server logs are accurate", () => {
    const verifier = createApiKeyEndUserVerifier({
      issuer: "https://api.daydream.live",
      resolveApiKey: async () => null,
    });

    expect(verifier.kind).toBe("api_key");
  });
});

describe("createFirstMatchEndUserVerifier", () => {
  it("falls back to second verifier when first rejects", async () => {
    const verifier = createFirstMatchEndUserVerifier([
      createApiKeyEndUserVerifier({
        issuer: "https://api.daydream.live",
        resolveApiKey: async () => null,
      }),
      createApiKeyEndUserVerifier({
        issuer: "https://api.daydream.live",
        resolveApiKey: async (apiKey) =>
          apiKey === "sk_fallback" ? { userId: "user-fallback" } : null,
      }),
    ]);

    const verified = await verifier.verify({
      authorization: "Bearer sk_fallback",
      payload: {},
      request: new Request("http://localhost/authorize"),
    });

    expect(verified.identity.usage_subject).toBe("user-fallback");
  });

  it("uses first matching verifier in order", async () => {
    const verifier = createFirstMatchEndUserVerifier([
      createApiKeyEndUserVerifier({
        issuer: "https://api.daydream.live",
        resolveApiKey: async () => ({ userId: "user-primary" }),
      }),
      createApiKeyEndUserVerifier({
        issuer: "https://api.daydream.live",
        resolveApiKey: async () => ({ userId: "user-secondary" }),
      }),
    ]);

    const verified = await verifier.verify({
      authorization: "Bearer sk_test",
      payload: {},
      request: new Request("http://localhost/authorize"),
    });

    expect(verified.identity.usage_subject).toBe("user-primary");
  });

  it("reports kind 'composite' so server logs are accurate", () => {
    const verifier = createFirstMatchEndUserVerifier([
      createApiKeyEndUserVerifier({
        issuer: "https://api.daydream.live",
        resolveApiKey: async () => null,
      }),
    ]);

    expect(verifier.kind).toBe("composite");
  });
});

describe("defaultSignerWebhookJwtAudience", () => {
  it("strips trailing slashes so the default matches minted signer JWT audiences", () => {
    expect(defaultSignerWebhookJwtAudience("https://issuer.example/")).toBe(
      "https://issuer.example",
    );
    expect(defaultSignerWebhookJwtAudience("https://issuer.example///")).toBe(
      "https://issuer.example",
    );
  });

  it("defaults the env-derived webhook audience to the slash-stripped issuer", () => {
    const config = readOidcRemoteSignerWebhookConfigFromEnv({
      WEBHOOK_SECRET: "signer-secret",
      JWT_ISSUER: "https://issuer.example/",
    });

    expect(config.webhookSecret).toBe("signer-secret");
    expect(config.endUserAuth.kind).toBe("composite");
  });
});
