import { describe, expect, it, vi } from "vitest";
import {
  createJwtClaimsIdentityResolver,
  identityFromAccessTokenClaims,
} from "../src/signer/identity-policy.js";
import { PmtHouseError } from "../src/errors.js";
import type { JWTAccessTokenClaims } from "oauth4webapi";

vi.mock("../src/verify.js", () => ({
  verifyJwt: vi.fn(async () => ({
    iss: "https://issuer.example",
    client_id: "app_1",
    usage_subject: "user_1",
    usage_subject_type: "external_user_id",
    sub: "ignored-when-usage-subject-present",
  })),
}));

describe("identity policy", () => {
  it("maps JWT claims to signer identity", () => {
    const claims = {
      iss: "https://issuer.example",
      client_id: "app_1",
      usage_subject: "user_1",
      usage_subject_type: "external_user_id",
      sub: "user_1",
      aud: "https://issuer.example",
      exp: 9999999999,
      iat: 1,
      jti: "jti",
    } satisfies JWTAccessTokenClaims;
    const identity = identityFromAccessTokenClaims(claims, {
      issuerUrl: "https://issuer.example",
    });
    expect(identity.clientId).toBe("app_1");
    expect(identity.usageSubject).toBe("user_1");
  });

  it("rejects clientId hint mismatch", async () => {
    const resolver = createJwtClaimsIdentityResolver({
      issuerUrl: "https://issuer.example",
      audience: "https://issuer.example",
    });
    await expect(
      resolver.resolveFromSubjectToken("token", { clientId: "app_other" }),
    ).rejects.toBeInstanceOf(PmtHouseError);
  });

  it("resolves identity from subject token", async () => {
    const resolver = createJwtClaimsIdentityResolver({
      issuerUrl: "https://issuer.example",
      audience: "https://issuer.example",
    });
    const identity = await resolver.resolveFromSubjectToken("token", {
      clientId: "app_1",
    });
    expect(identity.usageSubject).toBe("user_1");
  });
});
