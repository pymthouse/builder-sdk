/** @vitest-environment node */

import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import type { RemoteSignerWebhookConfig } from "../../src/signer/webhook/authorize.js";
import {
  defaultSignerWebhookJwtAudience,
  readOidcRemoteSignerWebhookConfigFromEnv,
} from "../../src/signer/webhook/adapters/oidc/config.js";
import { startRemoteSignerWebhookServer } from "../../src/signer/webhook/server.js";

const WEBHOOK_SECRET = "test-secret";

function testConfig(): RemoteSignerWebhookConfig {
  return {
    webhookSecret: WEBHOOK_SECRET,
    endUserAuth: {
      kind: "custom",
      verify: async () => ({
        identity: {
          issuer: "https://issuer.example",
          client_id: "app_pub",
          usage_subject: "user-1",
          usage_subject_type: "external_user_id",
        },
        expiry: Math.trunc(Date.now() / 1000) + 60,
      }),
    },
  };
}

const servers: Server[] = [];

async function startTestServer(
  config: RemoteSignerWebhookConfig,
  maxBodyBytes?: number,
): Promise<string> {
  const server = startRemoteSignerWebhookServer({
    config,
    addr: "127.0.0.1",
    port: 0,
    maxBodyBytes,
  });
  servers.push(server);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe("startRemoteSignerWebhookServer body limits", () => {
  it("rejects oversized request bodies with 413", async () => {
    const baseUrl = await startTestServer(testConfig(), 64);

    const response = await fetch(`${baseUrl}/authorize`, {
      method: "POST",
      headers: { "x-webhook-secret": WEBHOOK_SECRET, "content-type": "application/json" },
      body: JSON.stringify({ headers: {}, filler: "x".repeat(2048) }),
    });

    expect(response.status).toBe(413);
  });

  it("authorizes a normal request body within the limit", async () => {
    const baseUrl = await startTestServer(testConfig());

    const response = await fetch(`${baseUrl}/authorize`, {
      method: "POST",
      headers: { "x-webhook-secret": WEBHOOK_SECRET, "content-type": "application/json" },
      body: JSON.stringify({ headers: {} }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { auth_id?: string };
    expect(payload.auth_id).toBe("app_pub:user-1");
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
      WEBHOOK_SECRET,
      JWT_ISSUER: "https://issuer.example/",
    } as NodeJS.ProcessEnv);

    expect(config.webhookSecret).toBe(WEBHOOK_SECRET);
    expect(config.endUserAuth.kind).toBe("composite");
  });
});
