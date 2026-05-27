import { describe, expect, it, vi } from "vitest";

describe("gateway server module", () => {
  it("throws when imported in a browser-like environment", async () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = {};
    vi.resetModules();
    await expect(import("../src/gateway/server.js")).rejects.toThrow(/server-only/i);
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });
});
