import { afterEach, describe, expect, it, vi } from "vitest";

describe("@pymthouse/builder-sdk/env server-only guard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("loads in Node (no window)", async () => {
    const env = await import("../src/env.js");
    expect(env.createPmtHouseClientFromEnv).toBeTypeOf("function");
    expect(env.getPymthouseBaseUrl).toBeTypeOf("function");
  });

  it("throws on import when globalThis.window is defined", async () => {
    vi.stubGlobal("window", {});
    vi.resetModules();
    await expect(import("../src/env.js")).rejects.toThrow(
      "server-only",
    );
  });
});
