/** @vitest-environment node */

import { describe, expect, it } from "vitest";

import { identityFromWebhookClaims } from "../../src/signer/webhook/index.js";

const SIGNER_DMZ_MAPPING = {
  claimClientId: "client_id",
  claimUsageSubject: "external_user_id",
  usageSubjectType: "external_user_id",
};

describe("identityFromWebhookClaims usage_subject fallback", () => {
  it("derives usage_subject from `sub` for Builder user-tokens that lack external_user_id", () => {
    // Shape minted by POST /api/v1/apps/{clientId}/users/{externalUserId}/token
    // (scope=sign:job): sub = app_user id, client_id = app_..., user_type = app_user,
    // no external_user_id claim.
    const identity = identityFromWebhookClaims(
      {
        iss: "https://issuer.example",
        client_id: "app_98575870d7ae33589a3f0660",
        sub: "appuser_01HZX",
        user_type: "app_user",
        scope: "sign:job",
      },
      SIGNER_DMZ_MAPPING,
    );

    expect(identity).toEqual({
      issuer: "https://issuer.example",
      client_id: "app_98575870d7ae33589a3f0660",
      usage_subject: "appuser_01HZX",
      usage_subject_type: "app_user",
    });
  });

  it("keeps using external_user_id when the token already carries it", () => {
    const identity = identityFromWebhookClaims(
      {
        iss: "https://issuer.example",
        client_id: "app_98575870d7ae33589a3f0660",
        sub: "appuser_01HZX",
        external_user_id: "ext-user-42",
        user_type: "external_user",
      },
      SIGNER_DMZ_MAPPING,
    );

    expect(identity).toEqual({
      issuer: "https://issuer.example",
      client_id: "app_98575870d7ae33589a3f0660",
      usage_subject: "ext-user-42",
      usage_subject_type: "external_user_id",
    });
  });

  it("labels the fallback subject app_user when the token has no user_type", () => {
    const identity = identityFromWebhookClaims(
      {
        iss: "https://issuer.example",
        client_id: "app_x",
        sub: "appuser_only",
      },
      SIGNER_DMZ_MAPPING,
    );

    expect(identity.usage_subject).toBe("appuser_only");
    expect(identity.usage_subject_type).toBe("app_user");
  });

  it("lets an explicit usage_subject_type claim override the fallback type", () => {
    const identity = identityFromWebhookClaims(
      {
        iss: "https://issuer.example",
        client_id: "app_x",
        sub: "appuser_only",
        usage_subject_type: "custom_subject",
      },
      SIGNER_DMZ_MAPPING,
    );

    expect(identity.usage_subject).toBe("appuser_only");
    expect(identity.usage_subject_type).toBe("custom_subject");
  });

  it("does not change behavior when the configured claim is already `sub`", () => {
    const identity = identityFromWebhookClaims(
      {
        iss: "https://issuer.example",
        client_id: "app_x",
        sub: "appuser_default",
      },
      // default mapping: claimUsageSubject = "sub", usageSubjectType = "external_user_id"
      {},
    );

    expect(identity.usage_subject).toBe("appuser_default");
    expect(identity.usage_subject_type).toBe("external_user_id");
  });

  it("still rejects tokens with neither the configured claim nor `sub` (forged/incomplete)", () => {
    expect(() =>
      identityFromWebhookClaims(
        {
          iss: "https://issuer.example",
          client_id: "app_x",
          scope: "sign:job",
        },
        SIGNER_DMZ_MAPPING,
      ),
    ).toThrow("JWT missing required identity claims");
  });

  it("still rejects tokens missing issuer even when sub is present", () => {
    expect(() =>
      identityFromWebhookClaims(
        {
          client_id: "app_x",
          sub: "appuser_only",
        },
        SIGNER_DMZ_MAPPING,
      ),
    ).toThrow("JWT missing required identity claims");
  });
});
