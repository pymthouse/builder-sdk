import { describe, expect, it, vi } from "vitest";
import { PmtHouseError } from "../src/errors.js";
import {
  createSignerBootstrapService,
  type SignerIdentity,
  type SignerTokenIssuer,
} from "../src/signer/server.js";

describe("signer bootstrap beforeMint", () => {
  it("blocks mint when beforeMint rejects", async () => {
    const identity: SignerIdentity = {
      issuer: "https://issuer.example",
      clientId: "app_1",
      usageSubject: "user_1",
      usageSubjectType: "external_user_id",
    };
    const tokenIssuer: SignerTokenIssuer = {
      mintSignerToken: vi.fn(),
    };
    const service = createSignerBootstrapService({
      tokenIssuer,
      identityResolver: {
        resolveFromSubjectToken: vi.fn(async () => identity),
        resolveFromBearerToken: vi.fn(async () => identity),
      },
      accountingStore: {
        getBalance: vi.fn(async () => ({
          clientId: "app_1",
          usageSubject: "user_1",
          grantedWei: "0",
          consumedWei: "0",
          remainingWei: "0",
          updatedAt: new Date().toISOString(),
        })),
      },
      beforeMint: async () => {
        throw new PmtHouseError("blocked", { status: 402, code: "insufficient_balance" });
      },
    });

    await expect(
      service.bootstrap({ subjectToken: "login-token" }),
    ).rejects.toBeInstanceOf(PmtHouseError);
    expect(tokenIssuer.mintSignerToken).not.toHaveBeenCalled();
  });
});
