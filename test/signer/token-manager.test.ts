/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";

import { createSignerTokenManager } from "../../src/signer/token-manager.js";
import { PmtHouseError } from "../../src/errors.js";

function makeJwt(clientId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8")
    .toString("base64url")
    .replaceAll("=", "");
  const body = Buffer.from(
    JSON.stringify({
      iss: "https://pymthouse.example/api/v1/oidc",
      client_id: clientId,
      external_user_id: "user:1",
    }),
    "utf8",
  )
    .toString("base64url")
    .replaceAll("=", "");
  return `${header}.${body}.sig`;
}

function tokenFixture(clientId: string, overrides: Partial<{
  expiresAt: number;
  refreshAt: number;
  balanceUsdMicros: string;
  lifetimeGrantedUsdMicros: string;
}> = {}) {
  const now = Date.now();
  return {
    jwt: makeJwt(clientId),
    expiresAt: overrides.expiresAt ?? now + 10_000,
    refreshAt: overrides.refreshAt ?? now + 8_000,
    balanceUsdMicros: overrides.balanceUsdMicros ?? "100",
    lifetimeGrantedUsdMicros: overrides.lifetimeGrantedUsdMicros ?? "1000",
  };
}

describe("createSignerTokenManager", () => {
  it("returns a cached token before the proactive refresh threshold", async () => {
    const mint = vi.fn(async () => tokenFixture("app_pub"));

    const manager = createSignerTokenManager({ mint });

    const first = await manager.getToken("app_pub", "user:1");
    const second = await manager.getToken("app_pub", "user:1");

    expect(first.jwt).toBe(makeJwt("app_pub"));
    expect(second).toBe(first);
    expect(mint).toHaveBeenCalledWith("app_pub", "user:1");
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("refreshes when the proactive refresh threshold is reached", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const mint = vi
      .fn()
      .mockResolvedValueOnce(tokenFixture("app_pub", { expiresAt: now + 10_000, refreshAt: now + 8_000 }))
      .mockResolvedValueOnce(tokenFixture("app_pub", {
        expiresAt: now + 20_000,
        refreshAt: now + 18_000,
        balanceUsdMicros: "90",
      }));

    const manager = createSignerTokenManager({ mint });

    await manager.getToken("app_pub", "user:1");
    vi.setSystemTime(now + 8_001);
    const refreshed = await manager.getToken("app_pub", "user:1");

    expect(refreshed.jwt).toBe(makeJwt("app_pub"));
    expect(mint).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("dedupes concurrent refreshes for the same user", async () => {
    let resolveMint!: (value: {
      jwt: string;
      expiresAt: number;
      refreshAt: number;
      balanceUsdMicros: string;
      lifetimeGrantedUsdMicros: string;
    }) => void;
    const mint = vi.fn(
      () =>
        new Promise<{
          jwt: string;
          expiresAt: number;
          refreshAt: number;
          balanceUsdMicros: string;
          lifetimeGrantedUsdMicros: string;
        }>((resolve) => {
          resolveMint = resolve;
        }),
    );

    const manager = createSignerTokenManager({ mint });
    manager.invalidate("app_pub", "user:1");

    const first = manager.getToken("app_pub", "user:1", { forceRefresh: true });
    const second = manager.getToken("app_pub", "user:1", { forceRefresh: true });

    resolveMint(tokenFixture("app_pub", { balanceUsdMicros: "50", lifetimeGrantedUsdMicros: "500" }));

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("invalidates cached tokens", async () => {
    const mint = vi.fn(async () => tokenFixture("app_pub"));

    const manager = createSignerTokenManager({ mint });

    await manager.getToken("app_pub", "user:1");
    manager.invalidate("app_pub", "user:1");
    await manager.getToken("app_pub", "user:1");

    expect(mint).toHaveBeenCalledTimes(2);
  });

  it("rejects minted JWTs whose client_id does not match the cache key", async () => {
    const mint = vi.fn(async () => tokenFixture("app_other"));

    const manager = createSignerTokenManager({ mint });

    await expect(manager.getToken("app_pub", "user:1")).rejects.toBeInstanceOf(PmtHouseError);
    expect(mint).toHaveBeenCalledWith("app_pub", "user:1");
    expect(manager.peek("app_pub", "user:1")).toBeUndefined();
  });
});
