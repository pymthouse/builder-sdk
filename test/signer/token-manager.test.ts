/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";

import { createSignerTokenManager } from "../../src/signer/token-manager.js";

describe("createSignerTokenManager", () => {
  it("returns a cached token before the proactive refresh threshold", async () => {
    const mint = vi.fn(async () => ({
      jwt: "jwt-1",
      expiresAt: Date.now() + 10_000,
      refreshAt: Date.now() + 8_000,
      balanceUsdMicros: "100",
      lifetimeGrantedUsdMicros: "1000",
    }));

    const manager = createSignerTokenManager({ mint });

    const first = await manager.getToken("app_pub", "user:1");
    const second = await manager.getToken("app_pub", "user:1");

    expect(first.jwt).toBe("jwt-1");
    expect(second).toBe(first);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("refreshes when the proactive refresh threshold is reached", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const mint = vi
      .fn()
      .mockResolvedValueOnce({
        jwt: "jwt-1",
        expiresAt: now + 10_000,
        refreshAt: now + 8_000,
        balanceUsdMicros: "100",
        lifetimeGrantedUsdMicros: "1000",
      })
      .mockResolvedValueOnce({
        jwt: "jwt-2",
        expiresAt: now + 20_000,
        refreshAt: now + 18_000,
        balanceUsdMicros: "90",
        lifetimeGrantedUsdMicros: "1000",
      });

    const manager = createSignerTokenManager({ mint });

    await manager.getToken("app_pub", "user:1");
    vi.setSystemTime(now + 8_001);
    const refreshed = await manager.getToken("app_pub", "user:1");

    expect(refreshed.jwt).toBe("jwt-2");
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

    resolveMint({
      jwt: "jwt-shared",
      expiresAt: Date.now() + 10_000,
      refreshAt: Date.now() + 8_000,
      balanceUsdMicros: "50",
      lifetimeGrantedUsdMicros: "500",
    });

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("invalidates cached tokens", async () => {
    const mint = vi.fn(async () => ({
      jwt: "jwt-1",
      expiresAt: Date.now() + 10_000,
      refreshAt: Date.now() + 8_000,
      balanceUsdMicros: "100",
      lifetimeGrantedUsdMicros: "1000",
    }));

    const manager = createSignerTokenManager({ mint });

    await manager.getToken("app_pub", "user:1");
    manager.invalidate("app_pub", "user:1");
    await manager.getToken("app_pub", "user:1");

    expect(mint).toHaveBeenCalledTimes(2);
  });
});
