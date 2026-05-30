import { describe, expect, it, vi } from "vitest";
import {
  createSignerBootstrapService,
  createSignerProxyHandler,
  createSignedTicketIdempotencyKey,
  normalizeSignerIdentity,
  parseCreateSignedTicketEvent,
} from "../src/signer/server.js";
import type { SignerIdentity, SignerTokenIssuer } from "../src/signer/types.js";

describe("signer server helpers", () => {
  it("normalizes canonical signer identity claims", () => {
    expect(
      normalizeSignerIdentity({
        iss: " https://issuer.example ",
        client_id: " app_1 ",
        usage_subject: " user_1 ",
        usage_subject_type: "external_user_id",
      }),
    ).toEqual({
      issuer: "https://issuer.example",
      clientId: "app_1",
      usageSubject: "user_1",
      usageSubjectType: "external_user_id",
    });
  });

  it("parses signer Kafka usage events", () => {
    const event = parseCreateSignedTicketEvent({
      session_id: "session",
      request_id: "request",
      issuer: "https://issuer.example",
      client_id: "app_1",
      usage_subject: "user_1",
      usage_subject_type: "external_user_id",
      computed_fee: "123",
      pixels: 10,
      sequence_number: 2,
      current_time_unix: 1000,
    });

    expect(event.clientId).toBe("app_1");
    expect(event.computedFeeWei).toBe("123");
  });

  it("uses issuer client request id for idempotency", () => {
    const event = parseCreateSignedTicketEvent({
      session_id: "session",
      request_id: "request",
      issuer: "https://issuer.example",
      client_id: "app_1",
      usage_subject: "user_1",
      usage_subject_type: "external_user_id",
      sequence_number: 1,
    });
    const otherSeq = { ...event, sequenceNumber: 99 };
    expect(createSignedTicketIdempotencyKey(event)).toBe(
      createSignedTicketIdempotencyKey(otherSeq),
    );
  });

  it("proxies signer requests with a resolved bearer token", async () => {
    const seen: Request[] = [];
    const handler = createSignerProxyHandler({
      remoteSignerUrl: "https://signer.example",
      resolveAccessToken: async () => "signer-token",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        seen.push(request);
        return new Response("ok");
      },
    });

    const response = await handler(
      new Request("https://dashboard.example/api/signer/proxy/generate-live-payment", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(await response.text()).toBe("ok");
    expect(seen[0].url).toBe("https://signer.example/generate-live-payment");
    expect(seen[0].headers.get("Authorization")).toBe("Bearer signer-token");
  });

  it("derives bootstrap identity from subject token via resolver", async () => {
    const identity: SignerIdentity = {
      issuer: "https://issuer.example",
      clientId: "app_1",
      usageSubject: "user_1",
      usageSubjectType: "external_user_id",
    };
    const tokenIssuer: SignerTokenIssuer = {
      mintSignerToken: vi.fn(async () => ({
        accessToken: "signer-jwt",
        tokenType: "Bearer" as const,
        expiresIn: 300,
        expiresAt: new Date().toISOString(),
        scope: "sign:job",
      })),
    };
    const service = createSignerBootstrapService({
      tokenIssuer,
      identityResolver: {
        resolveFromSubjectToken: vi.fn(async () => identity),
        resolveFromBearerToken: vi.fn(async () => identity),
      },
    });

    const result = await service.bootstrap({
      subjectToken: "user-login-token",
      clientId: "app_1",
    });

    expect(result.identity).toEqual(identity);
    expect(tokenIssuer.mintSignerToken).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectToken: "user-login-token",
        identity,
      }),
    );
  });
});
