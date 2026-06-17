import { describe, expect, it } from "vitest";
import {
  AUTH0_WEBHOOK_IDENTITY_CLAIMS,
  createAuth0RemoteSignerWebhookConfig,
  readAuth0RemoteSignerWebhookConfigFromEnv,
} from "../src/signer/webhook/adapters/auth0/config.js";

describe("createAuth0RemoteSignerWebhookConfig", () => {
  it("applies Auth0 claim defaults", () => {
    const config = createAuth0RemoteSignerWebhookConfig({
      webhookSecret: "secret",
      jwtIssuer: "https://tenant.us.auth0.com/",
      jwtAudience: "livepeer",
    });

    expect(config.endUserAuth.kind).toBe("oidc");
    expect(config.webhookSecret).toBe("secret");
  });

  it("reads env with Auth0 defaults", () => {
    const config = readAuth0RemoteSignerWebhookConfigFromEnv({
      WEBHOOK_SECRET: "s",
      JWT_ISSUER: "https://tenant.us.auth0.com/",
      JWT_AUDIENCE: "livepeer",
    });

    expect(config.webhookSecret).toBe("s");
    expect(AUTH0_WEBHOOK_IDENTITY_CLAIMS.claimClientId).toBe("azp");
  });
});
