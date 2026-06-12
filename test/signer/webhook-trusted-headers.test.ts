/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import {
  createSignerDmzRemoteSignerWebhookConfig,
  handleRemoteSignerAuthorize,
  identityFromTrustedHeaders,
} from "../../src/signer/webhook/index.js";

const ISSUER = "http://localhost:3001/api/v1/oidc";

describe("identityFromTrustedHeaders", () => {
  it("maps Apache DMZ X-Livepeer headers to usage identity", () => {
    const identity = identityFromTrustedHeaders(
      {
        "X-Livepeer-Usage-Issuer": [ISSUER],
        "X-Livepeer-Client-ID": ["app_abc"],
        "X-Livepeer-Usage-Subject": ["user-42"],
        "X-Livepeer-Usage-Subject-Type": ["external_user_id"],
      },
      { expectedIssuer: ISSUER },
    );
    expect(identity).toEqual({
      issuer: ISSUER,
      client_id: "app_abc",
      usage_subject: "user-42",
      usage_subject_type: "external_user_id",
    });
  });
});

describe("createSignerDmzRemoteSignerWebhookConfig", () => {
  it("authorizes from trusted headers without Authorization in webhook payload", async () => {
    const config = createSignerDmzRemoteSignerWebhookConfig({
      webhookSecret: "signer-secret",
      jwtIssuer: ISSUER,
      jwtAudience: ISSUER,
      allowInsecureHttp: true,
    });

    const request = new Request("http://localhost/webhooks/remote-signer", {
      method: "POST",
      headers: {
        "x-api-key": "signer-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        headers: {
          "X-Livepeer-Usage-Issuer": [ISSUER],
          "X-Livepeer-Client-ID": ["app_abc"],
          "X-Livepeer-Usage-Subject": ["user-42"],
          "X-Livepeer-Usage-Subject-Type": ["external_user_id"],
        },
        state: { StateID: "sess-1" },
      }),
    });

    const response = await handleRemoteSignerAuthorize(request, config);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: number;
      auth_id: string;
      identity: { client_id: string };
    };
    expect(body.status).toBe(200);
    expect(body.auth_id).toBe("app_abc:user-42");
    expect(body.identity.client_id).toBe("app_abc");
  });
});
