/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getBuilderApiV1BaseFromIssuerUrl,
  isPymthouseConfigured,
  readPymthouseEnv,
} from "../src/config.js";

describe("config", () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      "PYMTHOUSE_ISSUER_URL",
      "PYMTHOUSE_PUBLIC_CLIENT_ID",
      "PYMTHOUSE_M2M_CLIENT_ID",
      "PYMTHOUSE_M2M_CLIENT_SECRET",
    ]) {
      envBackup[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(envBackup)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("readPymthouseEnv returns null when incomplete", () => {
    delete process.env.PYMTHOUSE_ISSUER_URL;
    expect(readPymthouseEnv()).toBeNull();
    expect(isPymthouseConfigured()).toBe(false);
  });

  it("readPymthouseEnv strips trailing slash from issuer", () => {
    process.env.PYMTHOUSE_ISSUER_URL = "https://ph.example/api/v1/oidc/";
    process.env.PYMTHOUSE_PUBLIC_CLIENT_ID = "app_1";
    process.env.PYMTHOUSE_M2M_CLIENT_ID = "m2m_1";
    process.env.PYMTHOUSE_M2M_CLIENT_SECRET = "secret";
    expect(readPymthouseEnv()?.issuerUrl).toBe("https://ph.example/api/v1/oidc");
    expect(isPymthouseConfigured()).toBe(true);
  });

  it("getBuilderApiV1BaseFromIssuerUrl strips /oidc suffix", () => {
    expect(getBuilderApiV1BaseFromIssuerUrl("https://ph.example/api/v1/oidc")).toBe(
      "https://ph.example/api/v1",
    );
    expect(getBuilderApiV1BaseFromIssuerUrl("https://ph.example/api/v1/oidc/")).toBe(
      "https://ph.example/api/v1",
    );
  });
});
